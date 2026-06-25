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
}

export interface DisasterRole {
  id: number;
  disaster: string;
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
}

export interface EmployeeDB {
  emp_no: string;
  name: string;
  team: string;
  role: string;
  is_commander: boolean;
  email?: string;
  phone?: string;
}

// Database helper functions
export const db = {
  // 1. Declare active incident
  async declareIncident(disaster: string, mode: string, location: string, scope: string, declaredBy: string) {
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
  async escalateIncident(incidentId: string, toMode: string, toScope: string, drillEmpNos?: string | null) {
    const update: Record<string, any> = { mode: toMode, scope: toScope };
    if (drillEmpNos !== undefined) update.drill_emp_nos = drillEmpNos;
    const { error } = await supabase
      .from('incidents')
      .update(update)
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
  async getDisasterRolesWithTasks(disasterKey: string) {
    const { data, error } = await supabase
      .from('disaster_roles')
      .select('*, disaster_tasks(*)')
      .eq('disaster', disasterKey)
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

  // 11. Set training participants (pre-populate responders with 미응답)
  async setTrainingParticipants(
    incidentId: string,
    selectedEmps: EmployeeDB[],
    currentResponders: Responder[]
  ): Promise<void> {
    const currentEmpNos = new Set(currentResponders.map(r => r.emp_no));
    const selectedEmpNos = new Set(selectedEmps.map(e => e.emp_no));

    // Insert new (not already in responders)
    const toAdd = selectedEmps.filter(e => !currentEmpNos.has(e.emp_no));
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

  // 10. Fetch an employee's badge for a specific disaster
  async getEmployeeBadge(empNo: string, disaster: string): Promise<string | null> {
    const { data, error } = await supabase
      .from('employee_disaster_badges')
      .select('badge')
      .eq('emp_no', empNo)
      .eq('disaster', disaster)
      .maybeSingle();
    if (error) throw error;
    return data?.badge ?? null;
  },
};
