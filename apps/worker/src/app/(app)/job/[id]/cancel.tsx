import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/AuthForm';
import { DetailSkeleton, SkeletonGroup } from '@/components/Skeleton';
import { StatusChip } from '@/components/MyJobParts';
import { ChevronLeftIcon } from '@/components/icons';
import { BottomBar, FieldError, Pill } from '@/components/onboarding';
import { DETAILS_MAX, WORKER_REASONS, requestCancellation, type WorkerReason } from '@/features/cancel/rules';
import { statusHref } from '@/features/job/routes';
import { canRequestCancellation, jobKind } from '@/features/myjobs/rules';
import { useJobStatus } from '@/features/myjobs/useJobStatus';
import { t } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { colors, fontFamily } from '@/theme';

// W18 Request cancellation. There is no approved design for this screen (docs/OPEN-QUESTIONS.md): it follows the
// design language of the other worker screens. After a quote is accepted the worker cannot cancel alone; DHA staff
// decide, and the job stays active until they do.
export default function RequestCancellationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, reload } = useJobStatus(id ?? '');
  const [reason, setReason] = useState<WorkerReason | null>(null);
  const [details, setDetails] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace(statusHref(id ?? '')));
  const ready = state.status === 'ready' ? state : null;
  const job = ready?.job ?? null;
  const kind = job ? jobKind(job) : null;
  const allowed = job !== null && kind !== null && canRequestCancellation(kind, job.cancellationPending);
  const failed = state.status === 'error';

  async function submit() {
    if (busy || !job) return;
    setTried(true);
    if (!reason) return;
    setError(null);
    setBusy(true);
    const result = await requestCancellation(
      {
        request: (jobId, code, text) => supabase.rpc('request_cancellation', { p_job_id: jobId, p_reason_code: code, p_details: text ?? undefined }),
        withdraw: (requestId) => supabase.rpc('withdraw_cancellation_request', { p_request_id: requestId }),
      },
      job.id,
      reason,
      details,
    );
    setBusy(false);
    if (!result.ok) {
      setError(t(result.key));
      void reload();
      return;
    }
    router.dismissTo(statusHref(job.id)); // pops back to the status screen already in the stack (no second copy)
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior="padding">
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={goBack} style={styles.back}>
          <ChevronLeftIcon size={22} color={colors.greenDark} />
        </Pressable>
        <Text style={styles.topTitle}>{t('cancel.title')}</Text>
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

      {ready && job && !allowed ? (
        <Message title={job.cancellationPending ? t('cancel.pendingTitle') : t('cancel.notAllowedTitle')} body={job.cancellationPending ? t('cancel.pendingBody') : t('cancel.notAllowedBody')}>
          <PrimaryButton label={t('cash.backToJob')} onPress={() => router.replace(statusHref(job.id))} showArrow={false} />
        </Message>
      ) : null}

      {ready && job && kind && allowed ? (
        <>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <StatusChip kind={kind} />
                <Text style={styles.code}>{job.code}</Text>
              </View>
              <Text style={styles.jobTitle}>{job.title}</Text>
            </View>

            <View style={styles.note}>
              <Text style={styles.noteHead}>{t('cancel.noteHead')}</Text>
              <Text style={styles.noteBody}>{t('cancel.noteBody')}</Text>
            </View>

            <Text style={styles.label}>{t('cancel.why')}</Text>
            <View style={styles.pills}>
              {WORKER_REASONS.map((value) => (
                <Pill key={value} label={t(`cancel.reasons.${value}`)} on={reason === value} onPress={() => setReason(reason === value ? null : value)} />
              ))}
            </View>
            {tried && !reason ? <FieldError>{t('cancel.errors.reason')}</FieldError> : null}

            <Text style={styles.label}>{t('cancel.details')}</Text>
            <TextInput
              accessibilityLabel={t('cancel.details')}
              value={details}
              onChangeText={(text) => setDetails(text.slice(0, DETAILS_MAX))}
              placeholder={t('cancel.detailsPlaceholder')}
              placeholderTextColor="#8A978F"
              multiline
              textAlignVertical="top"
              style={styles.input}
            />

            {error ? <FieldError>{error}</FieldError> : null}
          </ScrollView>

          <BottomBar hideArrow label={t('cancel.send')} onPress={() => void submit()} loading={busy} />
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
  note: { backgroundColor: colors.mint, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16, gap: 4 },
  noteHead: { fontFamily: fontFamily.extrabold, fontSize: 15, color: colors.ink },
  noteBody: { fontFamily: fontFamily.regular, fontSize: 13, lineHeight: 20, color: colors.ink },
  label: { fontFamily: fontFamily.bold, fontSize: 12, color: colors.muted },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: { minHeight: 96, borderRadius: 14, backgroundColor: '#fff', padding: 14, fontFamily: fontFamily.semibold, fontSize: 15, color: colors.ink },
  message: { margin: 20, backgroundColor: colors.mint, borderRadius: 18, padding: 16, gap: 10 },
  messageTitle: { fontFamily: fontFamily.extrabold, fontSize: 16, color: colors.greenDark },
  messageBody: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 19, color: colors.muted },
});
