// A fetch that gives up. The portal's calls to Supabase (database, auth, storage) used the default fetch, which waits
// as long as the network lets it, so a stuck call could hold a page open for minutes. This one stops after a limit and
// the page shows its normal "try again" fault page instead.

export const DB_TIMEOUT_MS = 15_000;

/** The same as fetch, but every request is cancelled after `ms` (and still honours a signal the caller passes in). */
export function timeoutFetch(ms: number = DB_TIMEOUT_MS, base: typeof fetch = fetch): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const limit = AbortSignal.timeout(ms);
    const signal = init?.signal && typeof AbortSignal.any === 'function' ? AbortSignal.any([init.signal, limit]) : (init?.signal ?? limit);
    return base(input, { ...init, signal });
  }) as typeof fetch;
}
