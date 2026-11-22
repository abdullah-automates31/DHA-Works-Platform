import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

import { parseSearch, searchText, type DuesPayment, type DueRow } from './rules';

export type SearchState = { status: 'idle' } | { status: 'loading' } | { status: 'error' } | { status: 'ready'; dues: DueRow[]; payments: DuesPayment[] };

const WAIT_MS = 300;

type Answer = { query: string; found: { dues: DueRow[]; payments: DuesPayment[] } | null };

// Searches all of the worker's dues and payments in the database (search_my_dues, migration 0079), not only the cards on
// screen, so an old payment can be found too. It waits a moment after the last key so each letter is not a request, and an
// answer for words that are no longer in the box is never shown: the state is the last answer together with the words it
// was for, and it only counts when those are the words now typed.
export function useDuesSearch(raw: string): SearchState {
  const query = searchText(raw);
  const [answer, setAnswer] = useState<Answer | null>(null);

  useEffect(() => {
    if (query === '') return;
    let current = true;
    const timer = setTimeout(() => {
      void supabase.rpc('search_my_dues', { p_query: query }).then(({ data, error }) => {
        if (current) setAnswer({ query, found: error ? null : parseSearch(data) });
      });
    }, WAIT_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query]);

  if (query === '') return { status: 'idle' };
  if (!answer || answer.query !== query) return { status: 'loading' };
  return answer.found ? { status: 'ready', ...answer.found } : { status: 'error' };
}
