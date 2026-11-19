// Settings and staff accounts (migration 0042).
import { arr, bool, int, isUuid, num, obj, str } from '../../lib/json.ts';

export type Category = { id: number; name: string; subtitle: string | null; active: boolean; workers: number };
export type Settings = {
  categories: Category[]; phases: { phase: number; active: boolean }[];
  helplineNumber: string; helplineEnabled: boolean; reportWindowDays: number; reviewWindowDays: number;
};

export function parseSettings(json: unknown): Settings | null {
  const o = obj(json);
  if (!o) return null;
  return {
    categories: arr(o.categories).flatMap((raw) => {
      const c = obj(raw);
      return c && typeof c.id === 'number' && str(c.name) ? [{ id: c.id, name: c.name as string, subtitle: str(c.subtitle), active: bool(c.active), workers: int(c.workers) }] : [];
    }),
    phases: arr(o.phases).flatMap((raw) => {
      const p = obj(raw);
      return p && typeof p.phase === 'number' ? [{ phase: p.phase, active: bool(p.active) }] : [];
    }),
    helplineNumber: str(o.helpline_number) ?? '',
    helplineEnabled: bool(o.helpline_enabled),
    reportWindowDays: int(o.report_window_days) || 7,
    reviewWindowDays: int(o.review_window_days) || 7,
  };
}

export type Staff = {
  admins: { id: string; name: string; email: string | null; createdAt: string; accountStatus: string; isMe: boolean }[];
  invites: { id: string; email: string; createdAt: string; expiresAt: string; expired: boolean }[];
};

export function parseStaff(json: unknown): Staff {
  const o = obj(json);
  return {
    admins: arr(o?.admins).flatMap((raw) => {
      const a = obj(raw);
      return a && isUuid(a.id) ? [{ id: a.id, name: str(a.name) ?? 'Staff member', email: str(a.email), createdAt: str(a.created_at) ?? '', accountStatus: str(a.account_status) ?? 'active', isMe: bool(a.is_me) }] : [];
    }),
    invites: arr(o?.invites).flatMap((raw) => {
      const i = obj(raw);
      return i && isUuid(i.id) && str(i.email) ? [{ id: i.id, email: i.email as string, createdAt: str(i.created_at) ?? '', expiresAt: str(i.expires_at) ?? '', expired: bool(i.expired) }] : [];
    }),
  };
}

// ---- Rules (migration 0064: admin_rules_get) ----
export type Rule = { key: string; label: string; value: number; def: number; min: number; max: number; integer: boolean; changedAt: string | null; changedBy: string | null };
export type RuleGroup = 'jobs' | 'workers';
export type Rules = Record<RuleGroup, Rule[]>;

function parseRuleList(v: unknown): Rule[] {
  return arr(v).flatMap((raw) => {
    const r = obj(raw);
    const value = num(r?.value);
    const def = num(r?.default);
    const min = num(r?.min);
    const max = num(r?.max);
    if (!r || !str(r.key) || !str(r.label) || value === null || def === null || min === null || max === null) return [];
    return [{ key: r.key as string, label: r.label as string, value, def, min, max, integer: bool(r.integer), changedAt: str(r.changed_at), changedBy: str(r.changed_by) }];
  });
}

export function parseRules(json: unknown): Rules | null {
  const o = obj(json);
  if (!o) return null;
  const jobs = parseRuleList(o.jobs);
  const workers = parseRuleList(o.workers);
  return jobs.length === 0 && workers.length === 0 ? null : { jobs, workers };
}

// ---- Staff activity (admin_staff_activity) ----
export type StaffActivity = { lastSignInAt: string | null; activeSessions: number; lastActiveAt: string | null; lastIp: string | null };

export function parseStaffActivity(json: unknown): Record<string, StaffActivity> {
  const out: Record<string, StaffActivity> = {};
  for (const raw of arr(json)) {
    const a = obj(raw);
    if (a && isUuid(a.id)) out[a.id] = { lastSignInAt: str(a.last_sign_in_at), activeSessions: int(a.active_sessions), lastActiveAt: str(a.last_active_at), lastIp: str(a.last_ip) };
  }
  return out;
}

// ---- Audit log (admin_audit_list) ----
export type AuditRow = { id: number; at: string; actorId: string | null; actor: string | null; action: string; table: string | null; record: string | null; old: Record<string, unknown> | null; new: Record<string, unknown> | null; reason: string | null };
export type Audit = { total: number; rows: AuditRow[]; actions: string[]; admins: { id: string; name: string }[] };

export function parseAudit(json: unknown): Audit {
  const o = obj(json);
  return {
    total: int(o?.total),
    rows: arr(o?.rows).flatMap((raw) => {
      const r = obj(raw);
      const id = num(r?.id);
      if (!r || id === null || !str(r.at) || Number.isNaN(Date.parse(r.at as string)) || !str(r.action)) return [];
      return [{ id, at: r.at as string, actorId: isUuid(r.actor_id) ? r.actor_id : null, actor: str(r.actor), action: r.action as string, table: str(r.table), record: str(r.record), old: obj(r.old), new: obj(r.new), reason: str(r.reason) }];
    }),
    actions: arr(o?.actions).filter((x): x is string => typeof x === 'string'),
    admins: arr(o?.admins).flatMap((raw) => {
      const a = obj(raw);
      return a && isUuid(a.id) ? [{ id: a.id, name: str(a.name) ?? 'Staff member' }] : [];
    }),
  };
}

// ---- System status (admin_system_status) ----
export type SystemStatus = {
  databaseBytes: number;
  storage: { bucket: string; objects: number; bytes: number }[];
  push: { waiting24h: number; lastSentAt: string | null };
  activeAdmins: number;
  cron: { name: string; lastRunAt: string | null; status: string | null }[] | null;
};

export function parseSystemStatus(json: unknown): SystemStatus | null {
  const o = obj(json);
  if (!o) return null;
  const push = obj(o.push);
  return {
    databaseBytes: int(o.database_bytes),
    storage: arr(o.storage).flatMap((raw) => {
      const b = obj(raw);
      return b && str(b.bucket) ? [{ bucket: b.bucket as string, objects: int(b.objects), bytes: int(b.bytes) }] : [];
    }),
    push: { waiting24h: int(push?.waiting_24h), lastSentAt: str(push?.last_sent_at) },
    activeAdmins: int(o.active_admins),
    cron: Array.isArray(o.cron)
      ? arr(o.cron).flatMap((raw) => {
          const c = obj(raw);
          return c && str(c.name) ? [{ name: c.name as string, lastRunAt: str(c.last_run_at), status: str(c.status) }] : [];
        })
      : null,
  };
}
