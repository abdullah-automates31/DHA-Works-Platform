import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/AuthForm';
import { DetailSkeleton, SkeletonGroup } from '@/components/Skeleton';
import { StatusChip } from '@/components/MyJobParts';
import { ChevronLeftIcon } from '@/components/icons';
import { BottomBar, FieldError, NumberField, Pill } from '@/components/onboarding';
import { CASH_REASONS, checkCash, isMoreThanQuote, recordCash, type CashMode } from '@/features/cash/rules';
import { formatRupees } from '@/features/home/format';
import { statusHref } from '@/features/job/routes';
import { jobKind } from '@/features/myjobs/rules';
import { useJobStatus } from '@/features/myjobs/useJobStatus';
import { amountDigits } from '@/features/quote/rules';
import { t } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { colors, fontFamily } from '@/theme';

// W13 Record cash (worker/screens/w-cash.dc.html): the amount agreed in the quote, then the amount the worker
// actually collected. Different from the quote needs a reason. record_cash_worker stores it and closes the job as
// cash_collected (worker-only cash, 9 Nov); the customer is then asked to rate.
export default function RecordCashScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, reload } = useJobStatus(id ?? '');
  const [mode, setMode] = useState<CashMode>('full');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace(statusHref(id ?? '')));
  const ready = state.status === 'ready' ? state : null;
  const job = ready?.job ?? null;
  const kind = job ? jobKind(job) : null;
  const agreed = ready?.extras.cashDue ?? job?.myQuoteTotal ?? 0;
  const alreadyRecorded = ready !== null && ready.extras.cashAmount !== null;
  const canRecord = kind === 'completed' && !alreadyRecorded;

  const input = { mode, amount, reason };
  const checked = checkCash(input, agreed);
  const more = isMoreThanQuote(input, agreed);
  const differs = mode === 'different' && amountDigits(amount) !== '' && Number(amountDigits(amount)) !== agreed;

  async function submit() {
    if (busy || !job) return;
    setTried(true);
    if (!checked.ok) return;
    setError(null);
    setBusy(true);
    const result = await recordCash(
      { recordCash: (jobId, value, why) => supabase.rpc('record_cash_worker', { p_job_id: jobId, p_amount: value, p_reason: why ?? undefined }) },
      job.id,
      checked.amount,
      checked.reason,
    );
    setBusy(false);
    if (!result.ok) {
      setError(t(result.key));
      void reload();
      return;
    }
    router.dismissTo(statusHref(job.id)); // pops back to the status screen already in the stack (no second copy)
  }

  const failed = state.status === 'error';

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={goBack} style={styles.back}>
          <ChevronLeftIcon size={22} color={colors.greenDark} />
        </Pressable>
        <Text style={styles.topTitle}>{t('cash.title')}</Text>
        <View style={{ width: 44 }} />
      </View>

      {state.status === 'loading' ? (
        <SkeletonGroup>
          <DetailSkeleton />
        </SkeletonGroup>
      ) : null}

      {state.status === 'unavailable' || failed ? (
        <Message title={failed ? t('job.loadFailedTitle') : t('job.unavailableTitle')} body={failed ? t('job.loadFailedBody') : t('job.unavailableBody')}>
          <PrimaryButton label={failed ? t('common.retry') : t('myjobs.backToMyJobs')} onPress={() => (failed ? void reload() : router.replace('/my-jobs'))} showArrow={false} />
        </Message>
      ) : null}

      {ready && job && !canRecord ? (
        <Message
          title={alreadyRecorded ? t('cash.recordedTitle') : t('cash.notReadyTitle')}
          body={alreadyRecorded ? t('cash.recordedBody', { amount: formatRupees(ready.extras.cashAmount ?? 0) }) : t('cash.notReadyBody')}
        >
          <PrimaryButton label={t('cash.backToJob')} onPress={() => router.replace(statusHref(job.id))} showArrow={false} />
        </Message>
      ) : null}

      {ready && job && canRecord ? (
        <>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <StatusChip kind="completed" />
                <Text style={styles.code}>{job.code}</Text>
              </View>
              <Text style={styles.jobTitle}>{job.title}</Text>
            </View>

            <View style={styles.agreed}>
              <Text style={styles.agreedLabel}>{t('cash.agreed')}</Text>
              <Text style={styles.agreedAmount}>{formatRupees(agreed)}</Text>
            </View>

            <Text style={styles.label}>{t('cash.collected')}</Text>
            <View style={styles.seg}>
              {(['full', 'different'] as const).map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: mode === value }}
                  onPress={() => {
                    setMode(value);
                    setTried(false);
                    setError(null);
                  }}
                  style={[styles.segButton, mode === value && styles.segOn]}
                >
                  <Text style={[styles.segText, mode === value && { color: '#fff' }]}>{t(value === 'full' ? 'cash.full' : 'cash.different')}</Text>
                </Pressable>
              ))}
            </View>

            <View style={mode === 'full' ? styles.disabled : undefined} pointerEvents={mode === 'full' ? 'none' : 'auto'}>
              <NumberField
                label={t('cash.amount')}
                prefix="Rs"
                value={mode === 'full' ? String(agreed) : amount}
                onChangeText={(text) => setAmount(amountDigits(text))}
                editable={mode === 'different'}
                error={tried && !checked.ok && checked.missing === 'amount'}
                placeholder="0"
              />
            </View>
            {tried && !checked.ok && checked.missing === 'amount' ? <FieldError>{t('cash.errors.amount')}</FieldError> : null}

            {differs ? (
              <View style={{ gap: 8 }}>
                <Text style={styles.label}>{t('cash.why')}</Text>
                <View style={styles.pills}>
                  {CASH_REASONS.map((value) => (
                    <Pill key={value} label={value} on={reason === value} onPress={() => setReason(reason === value ? null : value)} />
                  ))}
                </View>
                {tried && !checked.ok && checked.missing === 'reason' ? <FieldError>{t('cash.errors.reason')}</FieldError> : null}
              </View>
            ) : null}

            <View style={styles.warning}>
              <Text style={styles.warningText}>{t(more ? 'cash.warningMore' : 'cash.warning')}</Text>
            </View>

            {error ? <FieldError>{error}</FieldError> : null}
          </ScrollView>

          <BottomBar hideArrow label={t('cash.confirm')} onPress={() => void submit()} loading={busy} />
        </>
      ) : null}
    </KeyboardAvoidingView>
  );
}

function Message({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <View style={styles.message}>
      <Text style={styles.messageTitle}>{title}</Text>
      <Text style={styles.messageBody}>{body}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 12 },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  topTitle: { flex: 1, textAlign: 'center', fontFamily: fontFamily.extrabold, fontSize: 18, color: colors.ink },
  content: { paddingHorizontal: 20, paddingTop: 2, paddingBottom: 24, gap: 12 },
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 16, gap: 10 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  code: { fontFamily: fontFamily.bold, fontSize: 12, color: colors.muted },
  jobTitle: { fontFamily: fontFamily.extrabold, fontSize: 18, color: colors.ink },
  agreed: { backgroundColor: colors.mint, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  agreedLabel: { fontFamily: fontFamily.bold, fontSize: 13, color: colors.greenDark },
  agreedAmount: { fontFamily: fontFamily.extrabold, fontSize: 20, color: colors.greenDark },
  label: { fontFamily: fontFamily.bold, fontSize: 12, color: colors.muted },
  seg: { height: 52, flexDirection: 'row', backgroundColor: '#fff', borderRadius: 14, padding: 4, gap: 4 },
  segButton: { flex: 1, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.green },
  segText: { fontFamily: fontFamily.bold, fontSize: 13, color: colors.muted },
  disabled: { opacity: 0.6 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  warning: { backgroundColor: colors.chip.declined.bg, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 },
  warningText: { fontFamily: fontFamily.semibold, fontSize: 12, lineHeight: 18, color: colors.chip.declined.fg },
  message: { margin: 20, backgroundColor: colors.mint, borderRadius: 18, padding: 16, gap: 10 },
  messageTitle: { fontFamily: fontFamily.extrabold, fontSize: 16, color: colors.greenDark },
  messageBody: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 19, color: colors.muted },
});
