import { createClient } from '@supabase/supabase-js';

// Load environment variables. If not defined, fallback to empty strings.
// The user will configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in their .env file.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface Incident {
  id: string;
  disaster: string; // Key, e.g. "화재"
  location: string;
  status: 'active' | 'closed';
  declared_at: number;
  declared_by: string;
  mode: string; // '훈련' | '감지기' | '실제'
  scope: string; // 'drill' | 'confirm' | 'all'
  drill_emp_nos?: string | null; // 훈련 승격 시 선택 대원 emp_no (콤마 구분)
  shift?: string; // 'day' | 'night' — 화재만 지휘관이 발령 시 수동 선택, 나머지 재난은 항상 'day'
  variant?: string | null; // 상황 확정 태그(예: 'K급주방'|'가스구역'|'배터리') — null이면 미확정(공통만 표시)
  tts_call_enabled?: boolean; // 발령 시 "TTS 전화 사용" 체크박스 — false면 무응답자 전화 에스컬레이션 안 함 (기본 true)
}

// 훈련 발령 시 참여인원을 특정 대원으로 제한한 경우(drill_emp_nos), 그 인원만 알람·임무 대상.
// 실제 상황(훈련이 아님)이거나 선택 인원 제한이 없으면(drill_emp_nos 없음) 전원 대상.
// 화재는 mode가 "훈련/감지기"·"훈련/전체"처럼 복합 문자열이라 startsWith로 판정
// (notify-incident 엣지함수의 isTraining 판정 방식과 동일하게 맞춤).
export function isIncidentParticipant(incident: Pick<Incident, 'mode' | 'drill_emp_nos'>, empNo: string): boolean {
  if (!incident.mode.startsWith('훈련')) return true;
  if (!incident.drill_emp_nos) return true;
  return incident.drill_emp_nos.split(',').includes(empNo);
}

export interface Responder {
  incident_id: string;
  emp_no: string;
  name: string;
  team: string;
  role: string;
  status: '미응답' | '출동중' | '현장' | '복귀';
  updated_at: number;
}

export interface MemberTask {
  id: string; // incident_id + emp_no + task_idx
  incident_id: string;
  emp_no: string;
  role: string;
  task_idx: number;
  label: string;
  done: boolean;
  done_by?: string | null; // DB 컬럼 추가 필요: ALTER TABLE member_tasks ADD COLUMN IF NOT EXISTS done_by TEXT;
  updated_at: number | null;
  variant?: string | null; // 발령 시 disaster_tasks.variant를 그대로 복사 — null이면 공통(항상 표시)
}

export interface DisasterRole {
  id: number;
  disaster: string;
  shift: string; // 'day' | 'night' | 'bms' — disa_app 화재 야간·상황실 데이터와 배지 충돌 방지용 구분자
  group_name: string | null;
  role: string;
  badge: string;
  bc: string | null;
  disaster_tasks?: DisasterTask[];
}

export interface DisasterTask {
  id: number;
  role_id: number;
  task_idx: number;
  label: string;
  variant?: string | null; // null이면 공통 임무, 값이 있으면 그 상황(variant)이 확정됐을 때만 표시
}

export interface EmployeeDB {
  emp_no: string;
  name: string;
  team: string;
  role: string;
  is_commander: boolean;
  email?: string;
  phone?: string;
  // duty_matrix(재난 임무 매트릭스) 연동용 필드 — 아직 자동배정 엔진과는 연결되지 않은 조회 전용 데이터.
  dept_code?: string | null;
  shift_group?: 'A' | 'B' | 'C' | 'D' | null;
}

export interface DutyMatrixRow {
  id: number;
  disaster: string;
  controller: string | null;
  shift: '주간' | '야간';
  division: string;
  badge: string;
  dept_code: string | null;
}

// Database helper functions
export const db = {
  // 1. Declare active incident
  async declareIncident(disaster: string, mode: string, location: string, scope: string, declaredBy: string, drillEmpNos: string | null = null, shift: string = 'day', ttsCallEnabled: boolean = true) {
    const incidentId = `inc_${Date.now()}`;
    const incident: Incident = {
      id: incidentId,
      disaster,
      location,
      status: 'active',
      declared_at: Date.now(),
      declared_by: declaredBy,
      mode,
      scope,
      drill_emp_nos: drillEmpNos,
      shift,
      tts_call_enabled: ttsCallEnabled,
    };

    // Close any previous incidents just in case
    await supabase
      .from('incidents')
      .update({ status: 'closed' })
      .eq('status', 'active');

    // Insert new active incident
    const { error } = await supabase
      .from('incidents')
      .insert(incident);

    if (error) throw error;
    return incident;
  },

  // 2. Escalate incident mode
  async escalateIncident(incidentId: string, toMode: string, toScope: string, drillEmpNos?: string | null, ttsCallEnabled?: boolean) {
    const update: Record<string, any> = { mode: toMode, scope: toScope };
    if (drillEmpNos !== undefined) update.drill_emp_nos = drillEmpNos;
    if (ttsCallEnabled !== undefined) update.tts_call_enabled = ttsCallEnabled;
    const { error } = await supabase
      .from('incidents')
      .update(update)
      .eq('id', incidentId);

    if (error) throw error;
  },

  // 2-b. 상황 확정(variant) 설정 — null이면 공통으로 되돌림(오조작 복구)
  async setIncidentVariant(incidentId: string, variant: string | null) {
    const { error } = await supabase
      .from('incidents')
      .update({ variant })
      .eq('id', incidentId);

    if (error) throw error;
  },

  // 3. Close incident
  async closeIncident(incidentId: string) {
    const { error } = await supabase
      .from('incidents')
      .update({ status: 'closed' })
      .eq('id', incidentId);

    if (error) throw error;
  },

  // 4. Update responder status
  async setResponderStatus(incidentId: string, empNo: string, name: string, team: string, role: string, status: Responder['status']) {
    const responder: Responder = {
      incident_id: incidentId,
      emp_no: empNo,
      name,
      team,
      role,
      status,
      updated_at: Date.now(),
    };

    const { error } = await supabase
      .from('responders')
      .upsert(responder, { onConflict: 'incident_id,emp_no' });

    if (error) throw error;
  },

  // 5. Bulk insert tasks for an incident
  async initializeMemberTasks(tasks: Omit<MemberTask, 'updated_at' | 'done_by'>[]) {
    const { error } = await supabase
      .from('member_tasks')
      .insert(tasks);

    if (error) throw error;
  },

  // 6. Toggle task status
  async toggleTaskDone(taskId: string, done: boolean, doneBy: string | null = null) {
    const { error } = await supabase
      .from('member_tasks')
      .update({ done, done_by: done ? doneBy : null, updated_at: Date.now() })
      .eq('id', taskId);

    if (error) {
      // done_by 컬럼이 아직 DB에 없는 경우 → 컬럼 없이 재시도
      if (error.message?.includes('done_by')) {
        const { error: e2 } = await supabase
          .from('member_tasks')
          .update({ done, updated_at: Date.now() })
          .eq('id', taskId);
        if (e2) throw e2;
        return;
      }
      throw error;
    }
  },

  // 7. Fetch disaster roles + tasks from DB (replaces local disasters.ts members)
  // shift: 화재만 지휘관이 발령 시 'day'/'night' 선택 가능, 나머지 재난은 항상 'day' 고정
  async getDisasterRolesWithTasks(disasterKey: string, shift: string = 'day') {
    const { data, error } = await supabase
      .from('disaster_roles')
      .select('*, disaster_tasks(*)')
      .eq('disaster', disasterKey)
      .eq('shift', shift)
      .order('id');
    if (error) throw error;
    return (data ?? []) as (DisasterRole & { disaster_tasks: DisasterTask[] })[];
  },

  // 8. Fetch all employees from DB
  async getEmployees(): Promise<EmployeeDB[]> {
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .order('emp_no');
    if (error) throw error;
    return (data ?? []) as EmployeeDB[];
  },

  // 9. FCM 푸시 토큰 저장 (upsert — 동일 토큰이면 갱신)
  async saveFcmToken(empNo: string, token: string): Promise<void> {
    const { error } = await supabase
      .from('push_subscriptions')
      .upsert(
        { emp_no: empNo, fcm_token: token, updated_at: Date.now() },
        { onConflict: 'fcm_token' }
      );
    if (error) throw error;
  },

  // 9-b. 재난 알림 확인(앱을 열어봄) 기록 — TTS 전화 에스컬레이션의 "확인" 판정 기준.
  // mode도 같이 저장하고 매번 갱신(ignoreDuplicates 없음) — 감지기동작 단계에서 확인했다고
  // 전체화재로 승격된 뒤에도 "확인됨"으로 착각해 전화가 안 가는 걸 막기 위함. 에스컬레이션
  // 쪽에서 "현재 mode와 일치하는 확인 기록만" 인정하도록 조회함. 실패해도 앱 동작엔 영향 없게 에러 삼킴.
  async ackIncident(incidentId: string, empNo: string, mode: string): Promise<void> {
    try {
      await supabase
        .from('incident_acks')
        .upsert(
          { incident_id: incidentId, emp_no: empNo, mode, acked_at: Date.now() },
          { onConflict: 'incident_id,emp_no' }
        );
    } catch (e) {
      console.warn('[ackIncident] 실패:', e);
    }
  },

  // 11. Set training participants (pre-populate responders with 미응답)
  async setTrainingParticipants(
    incidentId: string,
    selectedEmps: EmployeeDB[],
    currentResponders: Responder[]
  ): Promise<void> {
    const currentEmpNos = new Set(currentResponders.map(r => r.emp_no));
    const selectedEmpNos = new Set(selectedEmps.map(e => e.emp_no));

    // Insert new (not already in responders) — emp_no/name 비어있는 ghost 항목 제외
    const toAdd = selectedEmps.filter(e => e.emp_no && e.name && !currentEmpNos.has(e.emp_no));
    if (toAdd.length > 0) {
      const { error } = await supabase.from('responders').upsert(
        toAdd.map(e => ({
          incident_id: incidentId,
          emp_no: e.emp_no,
          name: e.name,
          team: e.team,
          role: e.role,
          status: '미응답' as const,
          updated_at: Date.now(),
        })),
        { onConflict: 'incident_id,emp_no' }
      );
      if (error) throw error;
    }

    // Remove deselected that haven't responded yet
    const toRemove = currentResponders.filter(
      r => !selectedEmpNos.has(r.emp_no) && r.status === '미응답'
    );
    for (const r of toRemove) {
      await supabase
        .from('responders')
        .delete()
        .eq('incident_id', incidentId)
        .eq('emp_no', r.emp_no);
    }
  },

  // 12. FCM 푸시 직접 호출 (pg_net 트리거 백업 — 앱에서 직접 Edge Function 호출)
  async sendIncidentPush(
    record: Incident,
    type: 'INSERT' | 'UPDATE',
    oldRecord: Incident | null = null,
    drillEmpNos: string | null = null
  ): Promise<void> {
    try {
      const body: any = { type, record, old_record: oldRecord };
      if (drillEmpNos !== null) body.drill_emp_nos = drillEmpNos;
      const { error } = await supabase.functions.invoke('notify-incident', { body });
      if (error) console.warn('[FCM Push] Edge Function 호출 오류:', error);
    } catch (e) {
      console.warn('[FCM Push] 호출 실패:', e);
    }
  },

  // 재난·배지로 emp_no 목록 조회 (조장 자동 카운트 등 같은 배지 팀원 찾기용)
  async getEmployeeNosByBadge(disaster: string, badge: string, shift: string = 'day'): Promise<string[]> {
    const { data, error } = await supabase
      .from('employee_disaster_badges')
      .select('emp_no')
      .eq('disaster', disaster)
      .eq('badge', badge)
      .eq('shift', shift);
    if (error) throw error;
    return (data ?? []).map(row => row.emp_no as string);
  },

  // 10. Fetch an employee's badge for a specific disaster (+shift, 기본 주간)
  async getEmployeeBadge(empNo: string, disaster: string, shift: string = 'day'): Promise<string | null> {
    const { data, error } = await supabase
      .from('employee_disaster_badges')
      .select('badge')
      .eq('emp_no', empNo)
      .eq('disaster', disaster)
      .eq('shift', shift)
      .maybeSingle();
    if (error) throw error;
    return data?.badge ?? null;
  },

  // ── 인원 관리 CRUD ────────────────────────────────────────────
  async addEmployee(emp: EmployeeDB): Promise<void> {
    const { error } = await supabase.from('employees').insert(emp);
    if (error) throw error;
  },

  async updateEmployee(empNo: string, updates: Partial<EmployeeDB>): Promise<void> {
    const { error } = await supabase.from('employees').update(updates).eq('emp_no', empNo);
    if (error) throw error;
  },

  async deleteEmployee(empNo: string): Promise<void> {
    const { error } = await supabase.from('employees').delete().eq('emp_no', empNo);
    if (error) throw error;
  },

  async getEmployeeAllBadges(empNo: string): Promise<Record<string, string>> {
    const { data, error } = await supabase
      .from('employee_disaster_badges')
      .select('disaster, shift, badge')
      .eq('emp_no', empNo);
    if (error) throw error;
    const map: Record<string, string> = {};
    for (const row of data ?? []) map[`${row.disaster}|${row.shift}`] = row.badge;
    return map;
  },

  // shift: 'day' | 'night' — 2026-07-08부터 모든 재난에 주/야 구분 배정 지원
  async upsertEmployeeBadge(empNo: string, disaster: string, badge: string, shift: string = 'day'): Promise<void> {
    const { error } = await supabase
      .from('employee_disaster_badges')
      .upsert({ emp_no: empNo, disaster, shift, badge }, { onConflict: 'emp_no,disaster,shift' });
    if (error) throw error;
  },

  async deleteEmployeeBadge(empNo: string, disaster: string, shift: string = 'day'): Promise<void> {
    const { error } = await supabase
      .from('employee_disaster_badges')
      .delete()
      .eq('emp_no', empNo)
      .eq('disaster', disaster)
      .eq('shift', shift);
    if (error) throw error;
  },

  // 직원목록 탭: 전 직원 × 전 재난 × 주/야 배지 배정 현황 일괄 조회 (emp_no -> "disaster|shift" -> badge)
  async getAllEmployeeBadges(): Promise<Record<string, Record<string, string>>> {
    const { data, error } = await supabase
      .from('employee_disaster_badges')
      .select('emp_no, disaster, shift, badge');
    if (error) throw error;
    const map: Record<string, Record<string, string>> = {};
    for (const row of data ?? []) {
      (map[row.emp_no] ??= {})[`${row.disaster}|${row.shift}`] = row.badge;
    }
    return map;
  },

  // 재난편제표: 특정 재난·근무의 배지별 배정 인원(emp_no) 전체 조회 — 배지 관리 화면 전용
  async getEmployeeBadgesByDisaster(disaster: string, shift: string = 'day'): Promise<Record<string, string[]>> {
    const { data, error } = await supabase
      .from('employee_disaster_badges')
      .select('emp_no, badge')
      .eq('disaster', disaster)
      .eq('shift', shift);
    if (error) throw error;
    const map: Record<string, string[]> = {};
    for (const row of data ?? []) (map[row.badge] ??= []).push(row.emp_no);
    return map;
  },

  // ── 종료 재난 이력 조회 ──────────────────────────────────────
  async getClosedIncidents(): Promise<Incident[]> {
    const { data, error } = await supabase
      .from('incidents')
      .select('*')
      .eq('status', 'closed')
      .order('declared_at', { ascending: false })
      .limit(30);
    if (error) throw error;
    return (data ?? []) as Incident[];
  },

  async getIncidentResponders(incidentId: string): Promise<Responder[]> {
    const { data, error } = await supabase
      .from('responders')
      .select('*')
      .eq('incident_id', incidentId);
    if (error) throw error;
    return (data ?? []) as Responder[];
  },

  async getIncidentTasks(incidentId: string): Promise<MemberTask[]> {
    const { data, error } = await supabase
      .from('member_tasks')
      .select('*')
      .eq('incident_id', incidentId);
    if (error) throw error;
    return (data ?? []) as MemberTask[];
  },

  // ── 재난 임무 매트릭스(duty_matrix) — 조회 전용, 아직 자동배정 엔진과 미연동 ──
  async getDutyMatrix(): Promise<DutyMatrixRow[]> {
    const { data, error } = await supabase
      .from('duty_matrix')
      .select('*')
      .order('id');
    if (error) throw error;
    return (data ?? []) as DutyMatrixRow[];
  },

  async getAllDisasterBadgeOptions(): Promise<Record<string, string[]>> {
    const { data, error } = await supabase
      .from('disaster_roles')
      .select('disaster, badge')
      .eq('shift', 'day')
      .order('id');
    if (error) throw error;
    const map: Record<string, string[]> = {};
    for (const row of data ?? []) {
      if (!map[row.disaster]) map[row.disaster] = [];
      if (!map[row.disaster].includes(row.badge)) map[row.disaster].push(row.badge);
    }
    return map;
  },
};
