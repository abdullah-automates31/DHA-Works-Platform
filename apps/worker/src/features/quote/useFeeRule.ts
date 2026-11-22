import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

import { NO_FEE, parseFeeRule, type FeeRule } from './fee';

// The DHA fee rule (app_settings dha_fee_percent / dha_fee_min; two config rows every signed-in user may read). Kept for the
// session so the price form does not wait for it each time. Until it loads, or when staff have not switched the fee on, it is
// "no fee" and the form shows no breakdown.
let cached: FeeRule | null = null;

export function useFeeRule(): FeeRule {
  const [rule, setRule] = useState<FeeRule>(cached ?? NO_FEE);
  useEffect(() => {
    let live = true;
    void (async () => {
      const { data, error } = await supabase.from('app_settings').select('key, value').in('key', ['dha_fee_percent', 'dha_fee_min']);
      if (!live || error) return;
      cached = parseFeeRule(data);
      setRule(cached);
    })();
    return () => {
      live = false;
    };
  }, []);
  return rule;
}
