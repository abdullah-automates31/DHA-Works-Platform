// Decides where a signed-in worker may be, from their profile. Pure and unit tested.
// Screens that do not exist yet are temporary stand-ins (see docs/OPEN-QUESTIONS.md).

export type ProfileSnapshot = {
  role: 'resident' | 'worker' | 'admin';
  verification_status: 'incomplete' | 'pending' | 'approved' | 'needs_changes' | 'visit_hq' | 'rejected';
  account_status: 'active' | 'suspended';
  full_name: string | null;
  phone: string | null;
  cnic: string | null;
  gender: string | null;
  date_of_birth: string | null;
  /** What staff wrote with their last decision (changes needed, visit HQ, rejected). */
  verification_reason?: string | null;
};

export type AppRoute =
  | '/about'
  | '/documents'
  | '/references'
  | '/work'
  | '/status'
  | '/areas'
  | '/home'
  | '/open-jobs'
  | '/my-jobs'
  | '/profile'
  | '/notifications'
  | '/help'
  | '/report'
  | '/my-reports'
  | '/introduction';

export type StatusKind = 'wrong_role' | 'suspended' | 'pending' | 'visit_hq' | 'rejected';

/** All five W02 fields are present (the rules for them live in the form and the database). */
export function identityComplete(p: ProfileSnapshot): boolean {
  return Boolean(p.full_name && p.phone && p.cnic && p.gender && p.date_of_birth);
}

/** Which message the temporary status screen shows, or null when the account has a real destination. */
export function statusKind(p: ProfileSnapshot | null): StatusKind | null {
  if (!p) return null;
  if (p.role !== 'worker') return 'wrong_role';
  if (p.account_status === 'suspended') return 'suspended';
  switch (p.verification_status) {
    case 'pending':
      return 'pending';
    case 'visit_hq':
      return 'visit_hq';
    case 'rejected':
      return 'rejected';
    default:
      return null;
  }
}

/**
 * When DHA staff asked for changes, what to fix in the words staff wrote (an empty text when they wrote none);
 * null when no changes were asked for. The sign-up screens show it as a banner until the application is sent again.
 */
export function changesNeededReason(p: Pick<ProfileSnapshot, 'verification_status' | 'verification_reason'> | null): string | null {
  if (!p || p.verification_status !== 'needs_changes') return null;
  return (p.verification_reason ?? '').trim();
}

/** Routes the worker may be on, the first being where they are sent. */
/** `areaCount` = phases the worker chose; an approved worker with none must choose areas first (W05). */
export function allowedRoutes(p: ProfileSnapshot | null, areaCount = 0): AppRoute[] {
  if (!p) return ['/about'];
  if (statusKind(p) !== null) return ['/status'];
  if (p.verification_status === 'approved') {
    return areaCount === 0 ? ['/areas'] : ['/home', '/open-jobs', '/my-jobs', '/profile', '/notifications', '/areas', '/help', '/report', '/my-reports', '/introduction'];
  }
  // incomplete or needs_changes: identity first; once it is complete, the documents step and those after it.
  return identityComplete(p) ? ['/documents', '/references', '/work', '/about'] : ['/about'];
}

/**
 * True when the path is one of the allowed routes. A job screen is /job/<id>: it belongs to the signed-in worker app
 * (anyone allowed on Open jobs), and nothing else is matched loosely.
 */
export function isRouteAllowed(pathname: string, allowed: readonly AppRoute[]): boolean {
  if (allowed.includes(pathname as AppRoute)) return true;
  return pathname.startsWith('/job/') && pathname.length > '/job/'.length && allowed.includes('/open-jobs');
}
