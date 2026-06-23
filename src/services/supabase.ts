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
  async escalateIncident(incidentId: string, toMode: string, toScope: string) {
    const { error } = await supabase
      .from('incidents')
      .update({ mode: toMode, scope: toScope })
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
  async initializeMemberTasks(tasks: Omit<MemberTask, 'updated_at'>[]) {
    const { error } = await supabase
      .from('member_tasks')
      .insert(tasks);

    if (error) throw error;
  },

  // 6. Toggle task status
  async toggleTaskDone(taskId: string, done: boolean) {
    const { error } = await supabase
      .from('member_tasks')
      .update({ done, updated_at: Date.now() })
      .eq('id', taskId);

    if (error) throw error;
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

  // 9. Fetch an employee's badge for a specific disaster
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
