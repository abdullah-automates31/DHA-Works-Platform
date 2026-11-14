import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/AuthForm';
import { LoadMoreFooter } from '@/components/LoadMoreFooter';
import { NoticeListSkeleton, SkeletonGroup } from '@/components/Skeleton';
import { ChevronLeftIcon } from '@/components/icons';
import { datesLine, describeReport, kindLabel, stepOf, type MyReport } from '@/features/myreports/rules';
import { useMyReports } from '@/features/myreports/useMyReports';
import { t } from '@/i18n';
import { nearEnd } from '@/lib/paging';
import { colors, fontFamily } from '@/theme';

// My reports: the reports this worker filed, each with where it stands (Submitted, Under review, Resolved), when it was
// sent and last changed. DHA's notices say the same things as push messages; this screen is where to look afterwards.
// It never shows who the report was about or what DHA decided, only whether action was taken.
export default function MyReportsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, reload, loadMore, loadingMore, moreFailed } = useMyReports();
  const [pulling, setPulling] = useState(false);
  const pull = useCallback(async () => {
    setPulling(true);
    try {
      await reload();
    } finally {
      setPulling(false);
    }
  }, [reload]);
  const now = new Date();
  const reports = data.status === 'ready' ? data.reports : [];

  return (
    <View style={styles.root}>
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/help'))} style={styles.back}>
          <ChevronLeftIcon size={22} color={colors.greenDark} />
        </Pressable>
        <Text style={styles.topTitle}>{t('myReports.title')}</Text>
        <View style={{ width: 44 }} />
      </View>

      {data.status === 'loading' ? (
        <SkeletonGroup style={{ paddingHorizontal: 20 }}>
          <NoticeListSkeleton />
        </SkeletonGroup>
      ) : null}

      {data.status === 'error' ? (
        <View style={styles.message}>
          <Text style={styles.messageTitle}>{t('myReports.errorTitle')}</Text>
          <Text style={styles.messageBody}>{t('myReports.errorBody')}</Text>
          <PrimaryButton label={t('common.retry')} onPress={() => void reload()} showArrow={false} />
        </View>
      ) : null}

      {data.status === 'ready' ? (
        <ScrollView
          contentContainerStyle={styles.content}
          scrollEventThrottle={200}
          onScroll={(event) => {
            if (nearEnd(event.nativeEvent)) void loadMore();
          }}
          refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void pull()} tintColor={colors.green} />}>
          {reports.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>{t('myReports.emptyTitle')}</Text>
              <Text style={styles.emptyBody}>{t('myReports.emptyBody')}</Text>
            </View>
          ) : (
            <Text style={styles.note}>{t('myReports.note')}</Text>
          )}
          {reports.map((report) => (
            <ReportCard key={report.id} report={report} now={now} />
          ))}
          <LoadMoreFooter hasMore={data.hasMore} loading={loadingMore} failed={moreFailed} onLoad={() => void loadMore()} skeleton={<NoticeListSkeleton rows={2} />} />
        </ScrollView>
      ) : null}
    </View>
  );
}

function ReportCard({ report, now }: { report: MyReport; now: Date }) {
  const view = describeReport(report);
  const chip = colors.chip[view.tone];
  const step = stepOf(report.status);
  const steps = [t('myReports.stepSubmitted'), t('myReports.stepReview'), t('myReports.stepResolved')];
  const about = report.jobTitle ? t('myReports.aboutJob', { job: report.jobTitle }) : '';
  const dates = datesLine(report, now);
  return (
    <View
      accessible
      accessibilityLabel={`${kindLabel(report.kind)}. ${view.label}. ${view.hint}. ${dates}`}
      style={styles.card}>
      <View style={styles.cardHead}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.kind}>{kindLabel(report.kind)}</Text>
          {about ? <Text style={styles.sub}>{about}</Text> : null}
          <Text style={styles.code}>{report.code}</Text>
        </View>
        <View style={[styles.chip, { backgroundColor: chip.bg }]}>
          <Text style={[styles.chipText, { color: chip.fg }]}>{view.label}</Text>
        </View>
      </View>
      <View style={styles.steps} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {steps.map((label, index) => {
          const reached = index + 1 <= step;
          return (
            <View key={label} style={styles.step}>
              <View style={[styles.bar, reached && { backgroundColor: colors.green }]} />
              <Text style={[styles.stepLabel, reached && { color: colors.greenDark }]}>{label}</Text>
            </View>
          );
        })}
      </View>
      <Text style={styles.hint}>{view.hint}</Text>
      {report.details ? <Text style={styles.details}>{report.details}</Text> : null}
      <Text style={styles.dates}>{dates}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 12 },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  topTitle: { flex: 1, textAlign: 'center', fontFamily: fontFamily.extrabold, fontSize: 18, color: colors.ink },
  content: { paddingHorizontal: 20, paddingTop: 2, paddingBottom: 32, gap: 12 },
  note: { fontFamily: fontFamily.semibold, fontSize: 12.5, lineHeight: 18, color: colors.muted },
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 16, gap: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  kind: { fontFamily: fontFamily.extrabold, fontSize: 15, color: colors.ink },
  sub: { fontFamily: fontFamily.semibold, fontSize: 12.5, color: colors.muted },
  code: { fontFamily: fontFamily.semibold, fontSize: 11.5, color: colors.muted },
  chip: { borderRadius: 13, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { fontFamily: fontFamily.extrabold, fontSize: 11.5 },
  steps: { flexDirection: 'row', gap: 6 },
  step: { flex: 1, gap: 4 },
  bar: { height: 5, borderRadius: 3, backgroundColor: '#E2ECE6' },
  stepLabel: { fontFamily: fontFamily.semibold, fontSize: 10.5, color: colors.muted },
  hint: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 19, color: colors.ink },
  details: { fontFamily: fontFamily.regular, fontSize: 12.5, lineHeight: 18, color: colors.muted },
  dates: { fontFamily: fontFamily.semibold, fontSize: 11.5, color: colors.muted },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 48 },
  emptyTitle: { fontFamily: fontFamily.extrabold, fontSize: 16, color: colors.ink },
  emptyBody: { fontFamily: fontFamily.semibold, fontSize: 13, color: colors.muted, textAlign: 'center' },
  message: { margin: 20, backgroundColor: colors.mint, borderRadius: 18, padding: 16, gap: 10 },
  messageTitle: { fontFamily: fontFamily.extrabold, fontSize: 16, color: colors.greenDark },
  messageBody: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 19, color: colors.muted },
});
