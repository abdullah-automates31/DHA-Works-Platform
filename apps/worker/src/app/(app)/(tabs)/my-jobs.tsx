import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/AuthForm';
import { LoadMoreFooter } from '@/components/LoadMoreFooter';
import { JobCardSkeleton, SkeletonGroup } from '@/components/Skeleton';
import { MyJobCard } from '@/components/MyJobParts';
import { cashHref, quoteHref, statusHref } from '@/features/job/routes';
import { inTab, jobKind, type MyJobsTab } from '@/features/myjobs/rules';
import { useMyJobs } from '@/features/myjobs/useMyJobs';
import { t } from '@/i18n';
import { nearEnd } from '@/lib/paging';
import { colors, fontFamily } from '@/theme';

const TABS: { key: MyJobsTab; label: 'myjobs.tabActive' | 'myjobs.tabCompleted' | 'myjobs.tabAll' }[] = [
  { key: 'active', label: 'myjobs.tabActive' },
  { key: 'completed', label: 'myjobs.tabCompleted' },
  { key: 'all', label: 'myjobs.tabAll' },
];

// W11 My jobs: every job the worker engaged with, from worker_jobs (live). Active / Completed / All.
// The resident's name, phone and plot appear only on jobs the worker won (the database sends nothing earlier).
export default function MyJobsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, refresh, refreshing, loadMore, loadingMore, moreFailed } = useMyJobs();
  const [tab, setTab] = useState<MyJobsTab>('active');
  // Stable between renders so the memoised cards are not redrawn when a page loads or the tab changes back.
  // `data` is only the trigger (a new load means a new "now"), it is not read inside
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [data]);
  const openJob = useCallback((id: string) => router.push(statusHref(id)), [router]);
  const quoteJob = useCallback((id: string) => router.push(quoteHref(id)), [router]);
  const cashJob = useCallback((id: string) => router.push(cashHref(id)), [router]);

  const jobs = data.status === 'ready' ? data.jobs.filter((j) => inTab(jobKind(j), tab)) : [];

  return (
    <View style={styles.root}>
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.title}>{t('myjobs.title')}</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        scrollEventThrottle={200}
        onScroll={(event) => {
          if (nearEnd(event.nativeEvent)) void loadMore();
        }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.green} />}
      >
        <View style={styles.seg} accessibilityRole="tablist">
          {TABS.map(({ key, label }) => (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === key }}
              onPress={() => setTab(key)}
              style={[styles.segButton, tab === key && styles.segOn]}
            >
              <Text style={[styles.segText, tab === key && { color: '#fff' }]}>{t(label)}</Text>
            </Pressable>
          ))}
        </View>

        {data.status === 'loading' ? (
          <SkeletonGroup style={{ gap: 12 }}>
            <JobCardSkeleton />
            <JobCardSkeleton />
            <JobCardSkeleton />
          </SkeletonGroup>
        ) : null}

        {data.status === 'error' ? (
          <View style={styles.message}>
            <Text style={styles.messageTitle}>{t('myjobs.errorTitle')}</Text>
            <Text style={styles.messageBody}>{t('myjobs.errorBody')}</Text>
            <PrimaryButton label={t('common.retry')} onPress={() => void refresh()} showArrow={false} />
          </View>
        ) : null}

        {data.status === 'ready' && jobs.length === 0 ? (
          <View style={styles.message}>
            <Text style={styles.messageTitle}>{t(tab === 'completed' ? 'myjobs.emptyCompletedTitle' : 'myjobs.emptyTitle')}</Text>
            <Text style={styles.messageBody}>{t(tab === 'completed' ? 'myjobs.emptyCompletedBody' : 'myjobs.emptyBody')}</Text>
          </View>
        ) : null}

        {/* Every job the worker engaged with opens its status screen (W12); a rejected quote is a plain record. */}
        {jobs.map((job, index) => (
          <MyJobCard key={job.id} job={job} index={index} now={now} onOpen={openJob} onQuote={quoteJob} onCash={cashJob} />
        ))}

        {data.status === 'ready' ? (
          <LoadMoreFooter hasMore={data.hasMore} loading={loadingMore} failed={moreFailed} onLoad={() => void loadMore()} skeleton={<JobCardSkeleton />} />
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  top: { paddingHorizontal: 20, paddingBottom: 10 },
  title: { fontFamily: fontFamily.extrabold, fontSize: 28, lineHeight: 34, letterSpacing: -0.28, color: colors.ink },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, gap: 12 },
  seg: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 14, padding: 4, gap: 4 },
  segButton: { flex: 1, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.green },
  segText: { fontFamily: fontFamily.bold, fontSize: 13, color: colors.muted },
  message: { backgroundColor: colors.mint, borderRadius: 18, padding: 16, gap: 8, marginTop: 4 },
  messageTitle: { fontFamily: fontFamily.extrabold, fontSize: 15, color: colors.greenDark },
  messageBody: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 19, color: colors.muted },
});
