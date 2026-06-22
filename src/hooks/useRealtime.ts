import { useEffect, useState } from 'react';
import { supabase, type Incident, type Responder, type MemberTask, type DisasterRole } from '../services/supabase';

export function useRealtime() {
  const [activeIncident, setActiveIncident] = useState<Incident | null>(null);
  const [responders, setResponders] = useState<Responder[]>([]);
  const [tasks, setTasks] = useState<MemberTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [disasterRoles, setDisasterRoles] = useState<DisasterRole[]>([]);

  useEffect(() => {
    const fetchActiveIncident = async () => {
      try {
        const { data, error } = await supabase
          .from('incidents')
          .select('*')
          .eq('status', 'active')
          .maybeSingle();
        if (error) throw error;
        setActiveIncident(data);
      } catch (err) {
        console.error('Error fetching active incident:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchActiveIncident();

    const incidentChannel = supabase
      .channel('incidents-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'incidents' },
        (payload) => {
          const newDoc = payload.new as Incident;
          if (newDoc && newDoc.status === 'active') {
            setActiveIncident(newDoc);
          } else {
            setActiveIncident(null);
            setResponders([]);
            setTasks([]);
            setDisasterRoles([]);
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(incidentChannel); };
  }, []);

  useEffect(() => {
    if (!activeIncident) {
      setResponders([]);
      setTasks([]);
      setDisasterRoles([]);
      return;
    }

    const fetchAll = async () => {
      const [respRes, tasksRes, rolesRes] = await Promise.all([
        supabase.from('responders').select('*').eq('incident_id', activeIncident.id),
        supabase.from('member_tasks').select('*').eq('incident_id', activeIncident.id),
        supabase.from('disaster_roles').select('*').eq('disaster', activeIncident.disaster).order('id'),
      ]);
      if (respRes.data) setResponders(respRes.data as Responder[]);
      if (tasksRes.data) setTasks(tasksRes.data as MemberTask[]);
      if (rolesRes.data) setDisasterRoles(rolesRes.data as DisasterRole[]);
    };

    fetchAll();

    const dataChannel = supabase
      .channel(`incident-data-${activeIncident.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'responders', filter: `incident_id=eq.${activeIncident.id}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const nr = payload.new as Responder;
            setResponders((prev) => [...prev.filter((r) => r.emp_no !== nr.emp_no), nr]);
          } else if (payload.eventType === 'UPDATE') {
            const nr = payload.new as Responder;
            setResponders((prev) => prev.map((r) => (r.emp_no === nr.emp_no ? nr : r)));
          } else if (payload.eventType === 'DELETE') {
            const or = payload.old as Responder;
            setResponders((prev) => prev.filter((r) => r.emp_no !== or.emp_no));
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'member_tasks', filter: `incident_id=eq.${activeIncident.id}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const nt = payload.new as MemberTask;
            setTasks((prev) => [...prev.filter((t) => t.id !== nt.id), nt]);
          } else if (payload.eventType === 'UPDATE') {
            const nt = payload.new as MemberTask;
            setTasks((prev) => prev.map((t) => (t.id === nt.id ? nt : t)));
          } else if (payload.eventType === 'DELETE') {
            const ot = payload.old as MemberTask;
            setTasks((prev) => prev.filter((t) => t.id !== ot.id));
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(dataChannel); };
  }, [activeIncident]);

  return { activeIncident, responders, tasks, loading, disasterRoles };
}
