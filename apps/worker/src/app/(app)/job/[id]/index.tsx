import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/AuthForm';
import { DetailSkeleton, SkeletonGroup } from '@/components/Skeleton';
import { InfoCard, PhotoRow, ResidentCard, VoiceMessage } from '@/components/JobDetailParts';
import { StatusChip } from '@/components/MyJobParts';
import { BoltIcon, ChevronLeftIcon } from '@/components/icons';
import { BottomBar } from '@/components/onboarding';
import { timeAgo } from '@/features/feed/format';
import { jobChip, postedText } from '@/features/job/detail';
import { quoteHref, statusHref } from '@/features/job/routes';
import { recordJobView, useJob } from '@/features/job/useJob';
import { t } from '@/i18n';
import { colors, fontFamily } from '@/theme';

// W08 Job detail. Shows only what a worker may see before acceptance (photos, description, voice note, a
// verified-resident card with the phase). "Accept this job" opens the price form; sending it locks the job to the
// worker (claim-and-lock, accept_job). Jobs that are gone, expired or taken show a clear message.
export default function JobDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const fromStatus = from === 'status'; // W08b: opened from the job status screen
  const { state, reload } = useJob(id ?? '');

  const job = state.status === 'ready' ? state.job : null;
  const standing = job?.standing;

  // One view per worker is counted for jobs the worker has not engaged with yet; failures are silent.
  useEffect(() => {
    if (id && standing === 'none') void recordJobView(id);
  }, [id, standing]);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace(fromStatus ? statusHref(id ?? '') : '/open-jobs'));
  const openQuote = (jobId: string) => router.push(quoteHref(jobId));


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
          <PrimaryButton label={t('job.backToJobs')} onPress={() => router.replace('/open-jobs')} showArrow={false} />
        </Message>
      ) : null}

      {state.status === 'error' ? (
        <Message title={t('job.loadFailedTitle')} body={t('job.loadFailedBody')}>
          <PrimaryButton label={t('common.retry')} onPress={() => void reload()} showArrow={false} />
        </Message>
      ) : null}

      {job ? (
        <>
          <ScrollView contentContainerStyle={[styles.content, { paddingBottom: job.standing === 'closed' && !fromStatus ? 32 : 112 }]}>
            <View style={styles.chipRow}>
              {fromStatus && job.kind ? <StatusChip kind={job.kind} /> : <Chip kind={jobChip(job.urgency, job.postedAt)} />}
              <Text style={styles.posted}>{postedText(timeAgo(job.postedAt))}</Text>
            </View>
            <Text style={styles.title}>{job.title}</Text>
            <View style={styles.tags}>
              {job.categoryName ? <Tag>{job.categoryName}</Tag> : null}
              <Tag>{t('feed.where', { phase: job.phase, lane: job.lane })}</Tag>
            </View>

            <PhotoRow photos={job.photos} />
            {job.description ? <InfoCard title={t('job.customerSays')}>{job.description}</InfoCard> : null}
            {job.hasVoiceNote ? <VoiceMessage uri={job.voiceUrl} /> : null}

            <ResidentCard jobId={job.id} phase={job.phase} contact={job.contact} />

            {job.standing === 'closed' && !fromStatus ? (
              <View style={styles.closed}>
                <Text style={styles.closedTitle}>{t('job.closedTitle')}</Text>
                <Text style={styles.closedBody}>{t('job.closedBody')}</Text>
              </View>
            ) : null}
          </ScrollView>

          {fromStatus ? (
            // W08b: "Accept this job" only for a job still open to this worker.
            job.standing === 'interested' ? (
              <BottomBar
                hideArrow
                label={t('job.acceptJob')}
                onPress={() => openQuote(job.id)}
                secondary={{ label: t('job.backToStatus'), onPress: goBack }}
              />
            ) : (
              <BottomBar hideArrow soft label={t('job.backToStatus')} onPress={goBack} />
            )
          ) : job.standing !== 'closed' ? (
            <BottomBar
              hideArrow
              label={job.standing === 'quoted' ? t('job.quoteSent') : t('job.acceptJob')}
              onPress={() => openQuote(job.id)}
              disabled={job.standing === 'quoted'}
            />
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function Chip({ kind }: { kind: 'urgent' | 'new' | 'open' }) {
  if (kind === 'urgent') {
    const red = colors.chip.declined;
    return (
      <View style={[styles.chip, { backgroundColor: red.bg, flexDirection: 'row', gap: 4 }]}>
        <BoltIcon size={13} color={red.fg} strokeWidth={2.6} />
        <Text style={[styles.chipText, { color: red.fg }]}>{t('job.chipUrgent')}</Text>
      </View>
    );
  }
  const isNew = kind === 'new';
  return (
    <View style={[styles.chip, { backgroundColor: isNew ? colors.gold : colors.mint }]}>
      <Text style={[styles.chipText, { color: colors.greenDark }]}>{isNew ? t('job.chipNew') : t('job.chipOpen')}</Text>
    </View>
  );
}

function Tag({ children }: { children: string }) {
  return (
    <View style={styles.tag}>
      <Text style={styles.tagText}>{children}</Text>
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
  content: { paddingHorizontal: 20, paddingTop: 4, gap: 12 },
  chipRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chip: { height: 26, paddingHorizontal: 10, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontFamily: fontFamily.bold, fontSize: 12 },
  posted: { fontFamily: fontFamily.bold, fontSize: 12, color: colors.muted },
  title: { fontFamily: fontFamily.extrabold, fontSize: 24, lineHeight: 28, letterSpacing: -0.24, color: colors.ink },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { height: 26, paddingHorizontal: 10, borderRadius: 13, backgroundColor: colors.mint, justifyContent: 'center' },
  tagText: { fontFamily: fontFamily.bold, fontSize: 12, color: colors.greenDark },
  message: { margin: 20, backgroundColor: colors.mint, borderRadius: 18, padding: 16, gap: 10 },
  messageTitle: { fontFamily: fontFamily.extrabold, fontSize: 16, color: colors.greenDark },
  messageBody: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 19, color: colors.muted },
  closed: { backgroundColor: colors.mint, borderRadius: 18, padding: 14, gap: 4 },
  closedTitle: { fontFamily: fontFamily.extrabold, fontSize: 14, color: colors.greenDark },
  closedBody: { fontFamily: fontFamily.semibold, fontSize: 12, lineHeight: 18, color: colors.muted },
});
