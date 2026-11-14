// Users list and person page (migration 0042).
import { arr, int, isUuid, num, nums, obj, page, str, strs } from '../../lib/json.ts';

export type UserRow = {
  id: string; name: string; phone: string | null; accountStatus: string; openReports: number; categories: string | null; phases: number[];
  ratingAvg: number | null; ratingCount: number; jobsCount: number;
};

export function parseUsers(json: unknown) {
  return page<UserRow>(json, (r) => {
    if (!isUuid(r.id)) return null;
    return {
      id: r.id, name: str(r.full_name) ?? 'No name', phone: str(r.phone), accountStatus: str(r.account_status) ?? 'active', openReports: int(r.open_reports),
      categories: str(r.categories), phases: nums(r.phases), ratingAvg: num(r.rating_avg), ratingCount: int(r.rating_count), jobsCount: int(r.jobs_count),
    };
  });
}

export type UserCounts = { workers: number; residents: number };
export function parseUserCounts(json: unknown): UserCounts {
  const o = obj(json) ?? {};
  return { workers: int(o.workers), residents: int(o.residents) };
}

export type UserDoc = { type: string; path: string };
export type UserJob = { id: string; code: string; title: string; status: string; otherName: string | null; quoteTotal: number | null };
export type UserDetail = {
  id: string; role: 'worker' | 'resident'; name: string; phone: string | null; email: string | null; cnicMasked: string | null; createdAt: string; avatarPath: string | null;
  accountStatus: string; suspendedAt: string | null; suspendedUntil: string | null; suspensionReason: string | null; verifiedAt: string | null; openReports: number; pastSuspensions: number;
  documents: UserDoc[];
  notes: { id: string; note: string; createdAt: string; authorName: string }[];
  worker: { experienceYears: number | null; about: string | null; ratingAvg: number | null; ratingCount: number; jobsDone: number } | null;
  categories: string[]; phases: number[];
  addresses: { label: string | null; phase: number; lane: string; plotNo: string; floor: string | null }[];
  jobsCount: number;
  recentJobs: UserJob[];
};

export function parseUserDetail(json: unknown): UserDetail | null {
  const o = obj(json);
  if (!o || !isUuid(o.id) || (o.role !== 'worker' && o.role !== 'resident')) return null;
  const w = obj(o.worker);
  return {
    id: o.id, role: o.role, name: str(o.full_name) ?? 'No name', phone: str(o.phone), email: str(o.email), cnicMasked: str(o.cnic_masked),
    createdAt: str(o.created_at) ?? new Date(0).toISOString(), avatarPath: str(o.avatar_path), accountStatus: str(o.account_status) ?? 'active',
    suspendedAt: str(o.suspended_at), suspendedUntil: str(o.suspended_until), suspensionReason: str(o.suspension_reason), verifiedAt: str(o.verified_at), openReports: int(o.open_reports), pastSuspensions: int(o.past_suspensions),
    documents: arr(o.documents).flatMap((raw) => {
      const d = obj(raw);
      return d && str(d.type) && str(d.path) ? [{ type: d.type as string, path: d.path as string }] : [];
    }),
    notes: arr(o.notes).flatMap((raw) => {
      const n = obj(raw);
      return n && isUuid(n.id) && str(n.note) ? [{ id: n.id, note: n.note as string, createdAt: str(n.created_at) ?? '', authorName: str(n.author_name) ?? 'Staff' }] : [];
    }),
    worker: w ? { experienceYears: num(w.experience_years), about: str(w.about), ratingAvg: num(w.rating_avg), ratingCount: int(w.rating_count), jobsDone: int(w.jobs_done) } : null,
    categories: strs(o.categories), phases: nums(o.phases),
    addresses: arr(o.addresses).flatMap((raw) => {
      const a = obj(raw);
      return a && num(a.phase) !== null ? [{ label: str(a.label), phase: num(a.phase) as number, lane: str(a.lane) ?? '', plotNo: str(a.plot_no) ?? '', floor: str(a.floor) }] : [];
    }),
    jobsCount: int(o.jobs_count),
    recentJobs: arr(o.recent_jobs).flatMap((raw) => {
      const j = obj(raw);
      return j && isUuid(j.id) ? [{ id: j.id, code: str(j.code) ?? '', title: str(j.title) ?? '', status: str(j.status) ?? '', otherName: str(j.other_name), quoteTotal: num(j.quote_total) }] : [];
    }),
  };
}
