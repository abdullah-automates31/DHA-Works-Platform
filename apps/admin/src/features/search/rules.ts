// Global search (the box in the sidebar of every page). It reads through the same admin_*_list functions the list screens use,
// so who may search and what a search can see stay exactly as on those screens; this file only holds the pure rules.
import { buildHref, searchText } from '../../lib/format.ts';

/** Fewest characters that start a search (a single letter would match almost everything). */
export const MIN_QUERY = 2;
/** Rows shown per group on the results page; "See all" opens the full list screen with the same search. */
export const PER_GROUP = 5;

/** The search words from the address: trimmed, at most 80 characters, control characters dropped. */
export function queryFrom(value: unknown): string {
  return searchText(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

export type SearchState = 'empty' | 'short' | 'ready';

export function searchState(q: string): SearchState {
  if (q === '') return 'empty';
  return q.length < MIN_QUERY ? 'short' : 'ready';
}

/** "See all N" links to the list screens, with the search kept. Reports use the "all" tab so resolved cases are found too. */
export const seeAllHref = {
  workers: (q: string) => buildHref('/users', { q }),
  residents: (q: string) => buildHref('/users', { role: 'resident', q }),
  jobs: (q: string) => buildHref('/jobs', { q }),
  reports: (q: string) => buildHref('/reports', { tab: 'all', q }),
};

export function moreText(total: number, shown: number): string | null {
  return total > shown ? `See all ${total}` : null;
}
