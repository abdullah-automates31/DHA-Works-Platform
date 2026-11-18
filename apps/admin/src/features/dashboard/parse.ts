// Turns the JSON from admin_dashboard(p_range) (migrations 0040 and 0063) into typed values. A reply that does not look
// right becomes zeros and empty lists, so the dashboard can never crash or show unchecked data.
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const int = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const text = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const date = (v: unknown): string | null => {
  const t = text(v);
  return t && !Number.isNaN(Date.parse(t)) ? t : null;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AttentionKind = 'unsafe' | 'report' | 'worker' | 'resident' | 'cancellation' | 'stuck' | 'suspended_active';
const KINDS: AttentionKind[] = ['unsafe', 'report', 'worker', 'resident', 'cancellation', 'stuck', 'suspended_active'];
export type Priority = 'urgent' | 'high' | 'normal' | 'low';
const PRIORITIES: Priority[] = ['urgent', 'high', 'normal', 'low'];

export type Attention = {
  id: string;
  kind: AttentionKind;
  title: string;
  detail: string;
  since: string;
  ref: string;
  person: string;
  status: string;
  priority: Priority;
};

export type ActivityKind = 'registered' | 'verified' | 'job' | 'cancellation' | 'report' | 'account';
const ACTIVITY_KINDS: ActivityKind[] = ['registered', 'verified', 'job', 'cancellation', 'report', 'account'];
export type ActivityLink = 'worker' | 'resident' | 'job' | 'report' | 'user';
const LINKS: ActivityLink[] = ['worker', 'resident', 'job', 'report', 'user'];
export type Activity = { kind: ActivityKind; link: ActivityLink; linkId: string; text: string; ref: string; at: string };

export type Stages = {
  open: number;
  scheduled: number;
  in_progress: number;
  completed: number;
  cash_collected: number;
  disputed: number;
  cancelled: number;
  expired: number;
};
export type Period = {
  jobsPosted: number;
  jobsCompleted: number;
  workersRegistered: number;
  residentsRegistered: number;
  reportsFiled: number;
  reportsResolved: number;
};
export type Dashboard = {
  workers: { count: number; oldestSince: string | null };
  residents: { count: number; oldestSince: string | null };
  reports: { count: number; unsafe: number; high: number };
  jobsToday: { count: number; inProgress: number };
  stages: Stages;
  period: Period;
  attention: Attention[];
  attentionTotal: number;
  activity: Activity[];
};

export const ATTENTION_MAX = 15;
export const ACTIVITY_MAX = 20;

/** Older replies (0040) have no priority: unsafe was first, everything else equal. */
function defaultPriority(kind: AttentionKind): Priority {
  if (kind === 'unsafe') return 'urgent';
  if (kind === 'suspended_active') return 'high';
  if (kind === 'worker' || kind === 'resident') return 'low';
  return 'normal';
}

export function parseDashboard(json: unknown): Dashboard {
  const o = obj(json);
  const w = obj(o.workers_pending);
  const r = obj(o.residents_pending);
  const rep = obj(o.reports_open);
  const jt = obj(o.jobs_today);
  const st = obj(o.stages);
  const pe = obj(o.period);

  const attention: Attention[] = [];
  for (const raw of Array.isArray(o.attention) ? (o.attention as unknown[]) : []) {
    const a = obj(raw);
    const kind = KINDS.find((k) => k === a.kind);
    const id = text(a.id);
    const title = text(a.title);
    const since = date(a.since);
    if (!kind || !id || !title || !since) continue;
    const priority = PRIORITIES.find((p) => p === a.priority) ?? defaultPriority(kind);
    attention.push({ id, kind, title, detail: text(a.detail) ?? '', since, ref: text(a.ref) ?? '', person: text(a.person) ?? '', status: text(a.status) ?? '', priority });
  }

  const activity: Activity[] = [];
  for (const raw of Array.isArray(o.activity) ? (o.activity as unknown[]) : []) {
    const a = obj(raw);
    const kind = ACTIVITY_KINDS.find((k) => k === a.kind);
    const link = LINKS.find((l) => l === a.link);
    const linkId = text(a.link_id);
    const t = text(a.text);
    const at = date(a.at);
    if (!kind || !link || !linkId || !t || !at) continue;
    activity.push({ kind, link, linkId, text: t, ref: text(a.ref) ?? '', at });
  }

  const shown = attention.slice(0, ATTENTION_MAX);
  return {
    workers: { count: int(w.count), oldestSince: date(w.oldest_since) },
    residents: { count: int(r.count), oldestSince: date(r.oldest_since) },
    reports: { count: int(rep.count), unsafe: int(rep.unsafe), high: int(rep.high) },
    jobsToday: { count: int(jt.count), inProgress: int(jt.in_progress) },
    stages: {
      open: int(st.open),
      scheduled: int(st.scheduled),
      in_progress: int(st.in_progress),
      completed: int(st.completed),
      cash_collected: int(st.cash_collected),
      disputed: int(st.disputed),
      cancelled: int(st.cancelled),
      expired: int(st.expired),
    },
    period: {
      jobsPosted: int(pe.jobs_posted),
      jobsCompleted: int(pe.jobs_completed),
      workersRegistered: int(pe.workers_registered),
      residentsRegistered: int(pe.residents_registered),
      reportsFiled: int(pe.reports_filed),
      reportsResolved: int(pe.reports_resolved),
    },
    attention: shown,
    attentionTotal: Math.max(int(o.attention_total), shown.length),
    activity: activity.slice(0, ACTIVITY_MAX),
  };
}

export const isUuidText = (v: string): boolean => UUID.test(v);
