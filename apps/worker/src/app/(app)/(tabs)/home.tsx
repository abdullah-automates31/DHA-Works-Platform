import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ArrowRightIcon, BellIcon, ClockSmallIcon } from '@/components/icons';
import { JobCardSkeleton, SkeletonGroup } from '@/components/Skeleton';
import { ProgressBar } from '@/components/MyJobParts';
import { ProfilePhoto } from '@/components/ProfilePhoto';
import {
  firstName,
  formatHomeDate,
  formatRupees,
  formatTodayHeading,
  initialsOf,
  newJobsText,
  shortName,
  timeWindow,
} from '@/features/home/format';
import { useHome, type TodayJob } from '@/features/home/useHome';
import { statusHref } from '@/features/job/routes';
import { jobKind } from '@/features/myjobs/rules';
import { t } from '@/i18n';
import { useMyProfile } from '@/lib/profile';
import { colors, fontFamily } from '@/theme';

// W06 Home. Differences from the mock, by decision (docs/UI-UX.md section 8, docs/DECISIONS.md):
// a resident's name appears only on jobs this worker already won; "Call, then quote" is gone; there is no Requests tab.
export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state } = useMyProfile();
  const { data, refresh } = useHome();
  // The date heading is renewed each time Home comes back to the front, so it never shows yesterday after midnight.
  const [now, setNow] = useState(() => new Date());
  useFocusEffect(
    useCallback(() => {
      setNow(new Date());
    }, []),
  );
  const [pulling, setPulling] = useState(false);
  const pull = useCallback(async () => {
    setPulling(true);
    try {
      await refresh();
    } finally {
      setPulling(false);
    }
  }, [refresh]);
  const profile = state.status === 'ready' ? state.profile : null;
  const name = firstName(profile?.full_name);

  return (
    <View style={styles.root}>
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        {/* The photo opens the Profile tab (Shariq, 26 Nov: it looks tappable, so it must be). */}
        <Pressable accessibilityRole="button" accessibilityLabel={t('home.openProfile')} onPress={() => router.navigate('/profile')} hitSlop={8}>
          <ProfilePhoto size={44} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.date}>{formatHomeDate(now)}</Text>
          <Text style={styles.greeting} numberOfLines={1}>
            {name ? t('home.salam', { name }) : t('home.salamPlain')}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('home.notifications')}
          onPress={() => router.push('/notifications')}
          style={styles.bell}
        >
          <BellIcon size={22} color={colors.greenDark} />
          {data.status === 'ready' && data.unread ? <View style={styles.dot} /> : null}
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void pull()} tintColor={colors.green} />}
      >
        {data.status === 'loading' ? (
          <SkeletonGroup style={{ gap: 12 }}>
            <JobCardSkeleton />
            <JobCardSkeleton />
          </SkeletonGroup>
        ) : null}
        {data.status === 'error' ? <Text style={styles.error}>{t('home.loadFailed')}</Text> : null}

        {data.status === 'ready' ? (
          <>
            {data.newJobs > 0 ? (
              <Pressable accessibilityRole="button" onPress={() => router.navigate('/open-jobs')} style={styles.banner}>
                <Text style={styles.bannerCount}>{data.newJobsMore ? `${data.newJobs}+` : data.newJobs}</Text>
                <Text style={styles.bannerText}>{newJobsText(data.newJobs).replace(/^\d+ /, '')}</Text>
                <View style={styles.bannerLink}>
                  <Text style={styles.bannerLinkText}>{t('home.seeJobs')}</Text>
                  <ArrowRightIcon size={18} color={colors.greenDark} />
                </View>
              </Pressable>
            ) : null}

            <View style={styles.headingRow}>
              <Text style={styles.heading}>{formatTodayHeading(now)}</Text>
              <Pressable accessibilityRole="button" onPress={() => router.navigate('/my-jobs')} hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}>
                <Text style={styles.allJobs}>{t('home.allJobs')}</Text>
              </Pressable>
            </View>

            {data.today.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>{t('home.noneToday')}</Text>
              </View>
            ) : (
              data.today.map((job, index) => <JobCard key={job.id} job={job} tint={index % 2 === 0 ? 'y' : 'b'} onPress={() => router.push(statusHref(job.id))} />)
            )}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function JobCard({ job, tint, onPress }: { job: TodayJob; tint: 'y' | 'b'; onPress: () => void }) {
  const chip = job.status === 'in_progress' ? colors.chip.inProgress : colors.chip.scheduled;
  const label = job.status === 'in_progress' ? t('home.inProgress') : t('home.scheduled');
  const place = t('home.where', { phase: job.phase, lane: job.lane });
  const who = job.residentName ? `${shortName(job.residentName)} · ${place}` : place;
  const avatar = tint === 'y' ? { bg: '#F6E7B4', fg: '#5C4300' } : { bg: '#D6E6F7', fg: '#17406B' };
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={job.title} onPress={onPress} style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.time}>
          <ClockSmallIcon size={18} color={colors.muted} />
          <Text style={styles.timeText}>{timeWindow(job.scheduledStart, job.scheduledEnd)}</Text>
        </View>
        <View style={[styles.chip, { backgroundColor: chip.bg }]}>
          <Text style={[styles.chipText, { color: chip.fg }]}>{label}</Text>
        </View>
      </View>
      <Text style={styles.jobTitle}>{job.title}</Text>
      <View style={styles.who}>
        <View style={[styles.avatar, { backgroundColor: avatar.bg }]}>
          <Text style={[styles.avatarText, { color: avatar.fg }]}>{initialsOf(job.residentName)}</Text>
        </View>
        <Text style={styles.whoText} numberOfLines={1}>
          {who}
        </Text>
        <Text style={styles.price}>{formatRupees(job.total)}</Text>
      </View>
      <ProgressBar kind={jobKind({ status: job.status, isMine: true, myQuoteStatus: 'accepted' })} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 8 },
  date: { fontFamily: fontFamily.bold, fontSize: 12, color: colors.muted },
  greeting: { fontFamily: fontFamily.extrabold, fontSize: 30, lineHeight: 36, letterSpacing: -0.3, color: colors.ink, marginTop: 2 },
  bell: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 10, right: 11, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.gold },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, gap: 12 },
  error: { fontFamily: fontFamily.semibold, fontSize: 13, color: colors.chip.declined.fg },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FBEFC6', borderRadius: 20, paddingVertical: 14, paddingHorizontal: 16 },
  bannerCount: { fontFamily: fontFamily.extrabold, fontSize: 28, lineHeight: 30, color: '#3F2F00' },
  bannerText: { flex: 1, fontFamily: fontFamily.bold, fontSize: 14, lineHeight: 18, color: '#3F2F00' },
  bannerLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bannerLinkText: { fontFamily: fontFamily.bold, fontSize: 12, color: colors.greenDark },
  headingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  heading: { fontFamily: fontFamily.extrabold, fontSize: 15, color: colors.ink },
  allJobs: { fontFamily: fontFamily.bold, fontSize: 12, color: colors.green },
  empty: { backgroundColor: colors.mint, borderRadius: 18, padding: 16 },
  emptyText: { fontFamily: fontFamily.semibold, fontSize: 13, color: colors.greenDark },
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 14, gap: 8 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  time: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timeText: { fontFamily: fontFamily.bold, fontSize: 12, color: colors.muted },
  chip: { height: 26, paddingHorizontal: 10, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontFamily: fontFamily.bold, fontSize: 12 },
  jobTitle: { fontFamily: fontFamily.extrabold, fontSize: 16, color: colors.ink },
  who: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fontFamily.extrabold, fontSize: 11 },
  whoText: { flex: 1, fontFamily: fontFamily.bold, fontSize: 13, color: colors.ink },
  price: { fontFamily: fontFamily.extrabold, fontSize: 14, color: colors.green },
});
