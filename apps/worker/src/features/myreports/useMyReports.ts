import { useLiveRefresh } from '@/features/live/useLiveRefresh';
import { mergeById } from '@/lib/paging';
import { supabase } from '@/lib/supabase';
import { usePaged, type Paged } from '@/lib/usePaged';

import { parseMyReports, type MyReport } from './rules';

type ReportsState = { reports: MyReport[]; hasMore: boolean; consumed: number };
export type MyReportsData = Paged<ReportsState>;

export const PAGE = 20;
const MAX_PAGE = 50; // the database never returns more than 50 rows at once

async function fetchPage(from: number, count: number): Promise<ReportsState | null> {
  // my_reports() returns only the signed-in person's own reports, newest first, with a plain status (migration 0053).
  const { data, error } = await supabase.rpc('my_reports', { p_limit: Math.min(count, MAX_PAGE), p_offset: from });
  if (error) return null;
  const page = parseMyReports(data);
  if (!page) return null;
  return { reports: page.reports, consumed: page.reports.length, hasMore: from + page.reports.length < page.total };
}

export function useMyReports() {
  const paged = usePaged<ReportsState>({
    pageSize: PAGE,
    first: (count) => fetchPage(0, count),
    more: async (current) => {
      const page = await fetchPage(current.consumed, PAGE);
      if (!page) return null;
      return { reports: mergeById(current.reports, page.reports), hasMore: page.hasMore, consumed: current.consumed + page.consumed };
    },
  });
  const { reload } = paged;
  // DHA's notices are written in the same transaction as the status change, so a new notice means a report moved.
  useLiveRefresh(() => void reload());
  return paged;
}
