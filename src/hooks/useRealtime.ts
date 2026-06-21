import { useEffect, useState } from 'react';
import { supabase, type Incident, type Responder, type MemberTask } from '../services/supabase';

export function useRealtime() {
  const [activeIncident, setActiveIncident] = useState<Incident | null>(null);
  const [responders, setResponders] = useState<Responder[]>([]);
  const [tasks, setTasks] = useState<MemberTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 1. Fetch active incident initially
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

    // Subscribe to incidents changes
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
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(incidentChannel);
    };
  }, []);

  useEffect(() => {
    if (!activeIncident) {
      setResponders([]);
      setTasks([]);
      return;
    }

    // Fetch initial responders and tasks
    const fetchRespondersAndTasks = async () => {
      const [respRes, tasksRes] = await Promise.all([
        supabase.from('responders').select('*').eq('incident_id', activeIncident.id),
        supabase.from('member_tasks').select('*').eq('incident_id', activeIncident.id),
      ]);

      if (respRes.data) setResponders(respRes.data as Responder[]);
      if (tasksRes.data) setTasks(tasksRes.data as MemberTask[]);
    };

    fetchRespondersAndTasks();

    // Subscribe to responders and tasks for this incident
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
            setResponders((prev) =>
              prev.map((r) => (r.emp_no === nr.emp_no ? nr : r))
            );
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
            setTasks((prev) =>
              prev.map((t) => (t.id === nt.id ? nt : t))
            );
          } else if (payload.eventType === 'DELETE') {
            const ot = payload.old as MemberTask;
            setTasks((prev) => prev.filter((t) => t.id !== ot.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(dataChannel);
    };
  }, [activeIncident]);

  return { activeIncident, responders, tasks, loading };
}
