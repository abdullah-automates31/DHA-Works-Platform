import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { supabase } from '@/lib/supabase';

import { parsePaymentDetail, type PaymentDetail } from './rules';

export type PaymentDetailState = { status: 'loading' } | { status: 'error' } | { status: 'missing' } | { status: 'ready'; detail: PaymentDetail };

// One payment in full (my_payment_detail, migration 0081): how it was paid, when, what DHA decided, and which dues it paid.
// Reloads each time the screen comes to the front (DHA may have decided it meanwhile).
export function usePaymentDetail(id: string) {
  const [state, setState] = useState<PaymentDetailState>({ status: 'loading' });

  const reload = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_payment_detail', { p_payment: id });
    if (error) {
      // a payment that is not this worker's (or does not exist) is a plain refusal; anything else is a failed load
      setState((current) => (error.message.includes('not found') ? { status: 'missing' } : current.status === 'ready' ? current : { status: 'error' }));
      return;
    }
    const detail = parsePaymentDetail(data);
    setState((current) => (detail ? { status: 'ready', detail } : current.status === 'ready' ? current : { status: 'error' }));
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return { state, reload };
}
