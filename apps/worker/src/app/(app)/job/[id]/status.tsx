import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/AuthForm';
import { DetailSkeleton, SkeletonGroup } from '@/components/Skeleton';
import { Avatar, StatusChip, TimelineCard, whoLine } from '@/components/MyJobParts';
import { ChevronLeftIcon, ChevronRightIcon, PhoneIcon, UserIcon } from '@/components/icons';
import { BottomBar, FieldError } from '@/components/onboarding';
import { formatRupees } from '@/features/home/format';
import { withdrawCancellation } from '@/features/cancel/rules';
import { cancelHref, cashHref, changeQuoteHref, jobDetailsHref, quoteHref, reportHref } from '@/features/job/routes';
import { visitText } from '@/features/quote/visit';
import { pickImage } from '@/features/documents/pick';
import { buildBillPath, completeJob, startJob, type ActionClient, type Bill } from '@/features/myjobs/actions';
import { canReport, canRequestCancellation, dialable, jobKind, noteFor, primaryAction, timeline, type JobKind } from '@/features/myjobs/rules';
import { useJobStatus } from '@/features/myjobs/useJobStatus';
import { t } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { colors, fontFamily } from '@/theme';

// W12 Job status (worker/screens/w-status.dc.html): the job, a note for the current stage, the timeline and the
// next action. Start job and Mark complete call start_job and complete_job; a material bill photo is uploaded first
// when the accepted quote had materials. The resident's contact details are shown only on a job the worker won.
export default function JobStatusScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, reload } = useJobStatus(id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userId = session?.user.id ?? '';

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/my-jobs'));

  const client: ActionClient = {
    startJob: (jobId) => supabase.rpc('start_job', { p_job_id: jobId }),
    completeJob: (jobId, billPath) => supabase.rpc('complete_job', { p_job_id: jobId, p_bill_path: billPath ?? undefined }),
    uploadBill: async (bytes, mime, extension) => {
      const path = buildBillPath(userId, extension, Date.now(), Math.random().toString(16).slice(2, 10));
      const { error: uploadError } = await supabase.storage.from('job-media').upload(path, bytes, { contentType: mime, upsert: false });
      return { path: uploadError ? null : path, error: uploadError };
    },
    deleteBill: (path) => supabase.storage.from('job-media').remove([path]),
  };

  async function run(action: () => Promise<{ ok: true } | { ok: false; key: Parameters<typeof t>[0] }>, after?: () => void) {
    if (busy) return;
    setError(null);
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setError(t(result.key));
      void reload(); // the job may have changed (for example it was cancelled): show the real state
      return;
    }
    await reload();
    after?.();
  }

  function confirmStart(jobId: string) {
    Alert.alert(t('myjobs.startConfirmTitle'), t('myjobs.startConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('myjobs.startJob'), onPress: () => void run(() => startJob(client, jobId)) },
    ]);
  }

  async function takeBill(source: 'camera' | 'library'): Promise<Bill | null> {
    const picked = await pickImage(source, { kind: 'evidence' });
    if (picked.status === 'ok') return { bytes: picked.file.bytes, mime: picked.file.mime };
    if (picked.status === 'denied') setError(t('documents.errors.permission'));
    else if (picked.status === 'error') setError(t('documents.errors.pickFailed'));
    return null;
  }

  function finish(jobId: string, materials: number) {
    const complete = (bill: Bill | null) =>
      void run(() => completeJob(client, { jobId, materials, bill }), () => router.push(cashHref(jobId)));
    if (materials > 0) {
      // The accepted quote had materials: the bill photo is required before the job can be completed.
      Alert.alert(t('myjobs.billTitle'), t('myjobs.billBody'), [
        { text: t('documents.menu.takePhoto'), onPress: () => void takeBill('camera').then((bill) => bill && complete(bill)) },
        { text: t('documents.menu.chooseLibrary'), onPress: () => void takeBill('library').then((bill) => bill && complete(bill)) },
        { text: t('documents.menu.cancel'), style: 'cancel' },
      ]);
      return;
    }
    Alert.alert(t('myjobs.completeConfirmTitle'), t('myjobs.completeConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('myjobs.markComplete'), onPress: () => complete(null) },
    ]);
  }

  const ready = state.status === 'ready' ? state : null;
  const job = ready?.job ?? null;
  const kind: JobKind | null = job ? jobKind(job) : null;
  const canChangeQuote = kind === 'quoted' && ready?.extras.quoteStatus === 'sent' && ready.extras.quoteRevision === 0;
  const action = kind && job ? primaryAction(kind, job.cashRecorded === true, canChangeQuote) : null;
  const now = new Date();
  const visitLine = ready && (kind === 'quoted' || kind === 'scheduled') ? visitText(ready.extras.visitStart, ready.extras.visitEnd, now) : '';
  const phone = job && ['scheduled', 'in_progress'].includes(kind ?? '') ? dialable(job.residentPhone) : null;

  function confirmWithdraw(requestId: string) {
    Alert.alert(t('myjobs.withdrawConfirmTitle'), t('myjobs.withdrawConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('myjobs.withdraw'),
        onPress: () =>
          void run(() =>
            withdrawCancellation(
              {
                request: async () => ({ error: null }),
                withdraw: (rid) => supabase.rpc('withdraw_cancellation_request', { p_request_id: rid }),
              },
              requestId,
            ),
          ),
      },
    ]);
  }

  function onMain() {
    if (!job || !kind || !ready) return;
    switch (action) {
      case 'create_quote':
        router.push(quoteHref(job.id));
        break;
      case 'change_quote':
        router.push(changeQuoteHref(job.id));
        break;
      case 'start':
        confirmStart(job.id);
        break;
      case 'complete':
        finish(job.id, ready.extras.materials);
        break;
      case 'record_cash':
        router.push(cashHref(job.id));
        break;
      case 'find_jobs':
        router.navigate('/open-jobs');
        break;
      case 'help':
        router.push('/help');
        break;
      default:
        router.navigate('/my-jobs');
    }
  }

  const label =
    action === 'create_quote' ? t('myjobs.createQuote')
    : action === 'waiting' ? t('myjobs.waiting')
    : action === 'change_quote' ? t('myjobs.changeQuote')
    : action === 'start' ? t('myjobs.startJob')
    : action === 'complete' ? t('myjobs.markComplete')
    : action === 'record_cash' ? t('myjobs.recordCash')
    : action === 'find_jobs' ? t('myjobs.findJobs')
    : action === 'help' ? t('myjobs.contactSupport')
    : t('myjobs.backToMyJobs');
  const soft = action === 'waiting' || action === 'back' || action === 'help';

  return (
    <View style={styles.root}>
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={goBack} style={styles.back}>
          <ChevronLeftIcon size={22} color={colors.greenDark} />
        </Pressable>
        <Text style={styles.topTitle} numberOfLines={1}>
          {job ? t('job.title', { code: job.code }) : ''}
        </Text>
        <View style={{ width: 44 }} />
      </View>

      {state.status === 'loading' ? (
        <SkeletonGroup>
          <DetailSkeleton />
        </SkeletonGroup>
      ) : null}

      {state.status === 'unavailable' ? (
        <Message title={t('job.unavailableTitle')} body={t('job.unavailableBody')}>
          <PrimaryButton label={t('myjobs.backToMyJobs')} onPress={() => router.replace('/my-jobs')} showArrow={false} />
        </Message>
      ) : null}

      {state.status === 'error' ? (
        <Message title={t('job.loadFailedTitle')} body={t('job.loadFailedBody')}>
          <PrimaryButton label={t('common.retry')} onPress={() => void reload()} showArrow={false} />
        </Message>
      ) : null}

      {ready && job && kind ? (
        <>
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <StatusChip kind={kind} />
                <Text style={styles.price}>
                  {job.myQuoteTotal !== null && kind !== 'not_chosen' ? formatRupees(job.myQuoteTotal) : kind === 'interested' ? t('myjobs.noQuoteYet') : ''}
                </Text>
              </View>
              <Pressable accessibilityRole="link" onPress={() => router.push(jobDetailsHref(job.id))} style={styles.titleRow}>
                <Text style={styles.title} numberOfLines={2}>
                  {job.title}
                </Text>
                <View style={styles.detailsLink}>
                  <Text style={styles.detailsText}>{t('myjobs.jobDetails')}</Text>
                  <ChevronRightIcon size={16} color={colors.green} />
                </View>
              </Pressable>
              <View style={styles.who}>
                {job.residentName ? (
                  <Avatar name={job.residentName} />
                ) : (
                  <View style={styles.genericAvatar}>
                    <UserIcon size={18} color="#5C4300" />
                  </View>
                )}
                <Text style={styles.whoText} numberOfLines={1}>
                  {whoLine(job)}
                </Text>
                {phone ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={t('myjobs.call')} onPress={() => void Linking.openURL(`tel:${phone}`)} style={styles.call}>
                    <PhoneIcon size={18} color={colors.greenDark} />
                    <Text style={styles.callText}>{t('myjobs.call')}</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            <View style={[styles.note, (kind === 'cancelled' || kind === 'disputed' || kind === 'expired') && { backgroundColor: colors.chip.declined.bg }]}>
              <Text style={styles.noteHead}>{noteFor(job, kind, now).headline}</Text>
              <Text style={styles.noteBody}>{noteFor(job, kind, now).body}</Text>
              {visitLine ? <Text style={styles.noteHead}>{t('visit.yours', { when: visitLine })}</Text> : null}
              {kind === 'in_progress' && ready.extras.materials > 0 ? <Text style={styles.noteBody}>{t('myjobs.billNeeded')}</Text> : null}
            </View>

            <TimelineCard
              steps={timeline({
                kind,
                interestAt: ready.extras.interestAt,
                quoteAt: ready.extras.quoteAt,
                quoteTotal: ready.extras.quoteTotal,
                scheduledStart: job.scheduledStart,
                scheduledEnd: job.scheduledEnd,
                startedAt: job.startedAt,
                completedAt: job.completedAt,
                cashAmount: ready.extras.cashAmount,
              })}
            />

            {job.cancellationPending ? (
              <View style={[styles.note, { backgroundColor: colors.chip.wait.bg }]}>
                <Text style={styles.noteHead}>{t('myjobs.cancelPendingTitle')}</Text>
                <Text style={styles.noteBody}>{t('myjobs.cancelPendingBody')}</Text>
                {ready.extras.cancelRequestId ? (
                  <Pressable accessibilityRole="button" onPress={() => confirmWithdraw(ready.extras.cancelRequestId ?? '')} disabled={busy} style={styles.withdraw}>
                    <Text style={styles.withdrawText}>{t('myjobs.withdraw')}</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {canReport(kind) ? (
              <View style={styles.reportRow}>
                <Pressable accessibilityRole="button" onPress={() => router.push(reportHref(job.id))} style={[styles.reportBtn, styles.outline]}>
                  <Text style={[styles.reportText, { color: colors.green }]}>{t('myjobs.reportProblem')}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => router.push(reportHref(job.id, 'unsafe'))} style={[styles.reportBtn, { backgroundColor: colors.chip.declined.bg }]}>
                  <Text style={[styles.reportText, { color: colors.chip.declined.fg }]}>{t('myjobs.feelUnsafe')}</Text>
                </Pressable>
              </View>
            ) : null}

            {canRequestCancellation(kind, job.cancellationPending) ? (
              <Pressable accessibilityRole="button" onPress={() => router.push(cancelHref(job.id))} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnText}>{t('myjobs.requestCancellation')}</Text>
              </Pressable>
            ) : null}

            {error ? <FieldError>{error}</FieldError> : null}
          </ScrollView>

          <BottomBar hideArrow soft={soft} label={label} onPress={onMain} loading={busy} disabled={action === 'waiting'} />
        </>
      ) : null}
    </View>
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
  price: { fontFamily: fontFamily.extrabold, fontSize: 13, color: colors.green },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { flex: 1, fontFamily: fontFamily.extrabold, fontSize: 18, color: colors.ink },
  detailsLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  detailsText: { fontFamily: fontFamily.bold, fontSize: 12, color: colors.green },
  genericAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F6E7B4', alignItems: 'center', justifyContent: 'center' },
  who: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  whoText: { flex: 1, fontFamily: fontFamily.bold, fontSize: 13, color: colors.ink },
  call: { height: 44, paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.mint, flexDirection: 'row', alignItems: 'center', gap: 6 },
  callText: { fontFamily: fontFamily.extrabold, fontSize: 14, color: colors.greenDark },
  note: { backgroundColor: colors.mint, borderRadius: 20, paddingVertical: 14, paddingHorizontal: 16, gap: 4 },
  noteHead: { fontFamily: fontFamily.extrabold, fontSize: 15, color: colors.ink },
  noteBody: { fontFamily: fontFamily.regular, fontSize: 13, lineHeight: 20, color: colors.ink },
  reportRow: { flexDirection: 'row', gap: 8 },
  // minHeight, not height: on a large system font "Report a problem" wraps to two lines and must not be clipped.
  reportBtn: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, paddingVertical: 8 },
  outline: { borderWidth: 2, borderColor: colors.green },
  reportText: { fontFamily: fontFamily.extrabold, fontSize: 13, textAlign: 'center' },
  withdraw: { alignSelf: 'flex-start', height: 44, paddingHorizontal: 14, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  withdrawText: { fontFamily: fontFamily.extrabold, fontSize: 13, color: colors.greenDark },
  cancelBtn: { height: 48, borderRadius: 14, borderWidth: 1.5, borderColor: colors.chip.declined.fg, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontFamily: fontFamily.extrabold, fontSize: 14, color: colors.chip.declined.fg },
  message: { margin: 20, backgroundColor: colors.mint, borderRadius: 18, padding: 16, gap: 10 },
  messageTitle: { fontFamily: fontFamily.extrabold, fontSize: 16, color: colors.greenDark },
  messageBody: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 19, color: colors.muted },
});
