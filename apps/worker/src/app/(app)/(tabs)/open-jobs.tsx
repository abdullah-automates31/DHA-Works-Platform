import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type ViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/AuthForm';
import { FeedCardSkeleton, SkeletonGroup } from '@/components/Skeleton';
import { DistanceMenu } from '@/components/DistanceMenu';
import { FeedJobCard } from '@/components/FeedJobCard';
import { ChevronDownIcon, PinIcon } from '@/components/icons';
import { LoadMoreFooter } from '@/components/LoadMoreFooter';
import { DEFAULT_RADIUS, arrange, chooseOrigin, distanceLabel, radiusLabel, type FeedSort } from '@/features/feed/distance';
import { feedSubtitle } from '@/features/feed/format';
import { useFeed } from '@/features/feed/useFeed';
import { useWorkerLocation } from '@/features/feed/useWorkerLocation';
import { jobHref } from '@/features/job/routes';
import { t } from '@/i18n';
import { nearEnd } from '@/lib/paging';
import { useMyProfile } from '@/lib/profile';
import { colors, fontFamily } from '@/theme';

// W07 Open jobs: the worker's matching feed (trade + DHA phase). "Newest" keeps the server order (urgent first, then newest);
// "Nearest" sorts by the estimated distance to each job's phase; "Within X km" hides jobs farther away than that
// (features/feed/distance.ts). Pull down to refresh; the list also reloads each time the tab is shown.
export default function OpenJobsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state } = useMyProfile();
  const profileAreas = state.status === 'ready' ? state.areas : null;
  const areas = useMemo(() => profileAreas ?? [], [profileAreas]);
  const { data, refresh, refreshing, loadMore, loadingMore, moreFailed } = useFeed(areas.join(','));
  // `now` and the press handler stay the same between renders, so cards that did not change are not redrawn when a
  // page loads or the pull spinner flips. `now` moves on when the list itself is reloaded.
  // `data` is only the trigger (a new load means a new "now"), it is not read inside
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [data]);
  const [sort, setSort] = useState<FeedSort>('newest');
  const [radius, setRadius] = useState<number | null>(DEFAULT_RADIUS);
  const [sheet, setSheet] = useState(false); // the distance dropdown is open
  const [menuTop, setMenuTop] = useState(0);
  const rootRef = useRef<ViewInstance>(null);
  const pillRef = useRef<ViewInstance>(null);
  // open the dropdown right under the distance button: measure the button against the screen, then show it
  const toggleMenu = () => {
    if (sheet) {
      setSheet(false);
      return;
    }
    pillRef.current?.measureInWindow((_x, y, _w, h) => {
      rootRef.current?.measureInWindow((_rx, rootY) => {
        setMenuTop(y - rootY + h + 6);
        setSheet(true);
      });
    });
  };
  const location = useWorkerLocation(true);
  const origin = useMemo(() => chooseOrigin(location.point, areas), [location.point, areas]);
  // the filter and the sort work on the loaded rows, so while either needs the whole feed, pull the remaining pages in
  // (the feed is capped at a few dozen open jobs per worker)
  const needsAll = sort === 'nearest' || radius !== null;
  useEffect(() => {
    if (needsAll && data.status === 'ready' && data.hasMore && !loadingMore && !moreFailed) void loadMore();
  }, [needsAll, data, loadingMore, moreFailed, loadMore]);
  const rows = useMemo(() => (data.status === 'ready' ? arrange(data.jobs, { sort, radius, origin }) : []), [data, sort, radius, origin]);
  const openJob = useCallback((id: string) => router.push(jobHref(id)), [router]);

  const subtitle = data.status === 'ready' ? feedSubtitle(data.trades, areas) : '';

  return (
    <View ref={rootRef} collapsable={false} style={styles.root}>
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.title}>{t('feed.title')}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        <View style={styles.controls}>
          <View style={styles.segment} accessibilityRole="tablist">
            {(['newest', 'nearest'] as const).map((key) => {
              const on = sort === key;
              return (
                <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setSort(key)} style={[styles.segItem, on && styles.segOn]}>
                  <Text style={[styles.segText, on && { color: '#fff' }]}>{t(key === 'newest' ? 'feed.newest' : 'feed.nearest')}</Text>
                </Pressable>
              );
            })}
          </View>
          <View ref={pillRef} collapsable={false}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: sheet }} accessibilityLabel={radiusLabel(radius)} onPress={toggleMenu} style={styles.radius}>
              <PinIcon size={16} color={colors.greenDark} />
              <Text style={styles.radiusText}>{radiusLabel(radius)}</Text>
              <View style={sheet ? { transform: [{ rotate: '180deg' }] } : undefined}>
                <ChevronDownIcon size={16} color={colors.greenDark} />
              </View>
            </Pressable>
          </View>
        </View>
        {location.denied ? <Text style={styles.hint}>{t('feed.locationOff')}</Text> : null}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        scrollEventThrottle={200}
        onScroll={(event) => {
          if (nearEnd(event.nativeEvent)) void loadMore();
        }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.green} />}
      >
        {data.status === 'loading' ? (
          <SkeletonGroup style={{ gap: 12 }}>
            <FeedCardSkeleton />
            <FeedCardSkeleton />
            <FeedCardSkeleton />
          </SkeletonGroup>
        ) : null}

        {data.status === 'error' ? (
          <View style={styles.message}>
            <Text style={styles.messageTitle}>{t('feed.errorTitle')}</Text>
            <Text style={styles.messageBody}>{t('feed.errorBody')}</Text>
            <PrimaryButton label={t('common.retry')} onPress={() => void refresh()} showArrow={false} />
          </View>
        ) : null}

        {data.status === 'ready' && data.jobs.length === 0 ? (
          <View style={styles.message}>
            <Text style={styles.messageTitle}>{t('feed.emptyTitle')}</Text>
            <Text style={styles.messageBody}>{t('feed.emptyBody')}</Text>
          </View>
        ) : null}

        {data.status === 'ready' && data.jobs.length > 0 && rows.length === 0 && !data.hasMore ? (
          <View style={styles.message}>
            <Text style={styles.messageTitle}>{t('feed.noneInRange')}</Text>
            <Text style={styles.messageBody}>{t('feed.noneInRangeBody')}</Text>
          </View>
        ) : null}

        {rows.map(({ job, km }) => (
          <FeedJobCard key={job.id} job={job} now={now} onPress={openJob} distance={distanceLabel(km)} />
        ))}

        {data.status === 'ready' && data.jobs.length > 0 ? (
          <LoadMoreFooter hasMore={data.hasMore} loading={loadingMore} failed={moreFailed} onLoad={() => void loadMore()} skeleton={<FeedCardSkeleton />} />
        ) : null}
      </ScrollView>

      {/* tap anywhere outside the dropdown to close it; it sits above the list and below the header */}
      {sheet ? <Pressable accessibilityLabel={t('common.cancel')} onPress={() => setSheet(false)} style={styles.backdrop} /> : null}
      {sheet ? (
        <View style={[styles.menuHolder, { top: menuTop }]}>
          <DistanceMenu
            radius={radius}
            onPick={(r) => {
              setRadius(r);
              setSheet(false);
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  top: { paddingHorizontal: 20, paddingBottom: 8, zIndex: 10, elevation: 10 },
  backdrop: { ...StyleSheet.absoluteFill, zIndex: 5, elevation: 5 },
  menuHolder: { position: 'absolute', right: 20, zIndex: 20, elevation: 20 },
  title: { fontFamily: fontFamily.extrabold, fontSize: 28, lineHeight: 34, letterSpacing: -0.28, color: colors.ink },
  subtitle: { fontFamily: fontFamily.bold, fontSize: 12, color: colors.muted, marginTop: 2 },
  // wraps: on a phone with large text the sort switch and the distance pill no longer fit on one line, and the pill ran off the screen
  controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 10, rowGap: 8, marginTop: 12 },
  segment: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 20, padding: 4 },
  segItem: { height: 36, paddingHorizontal: 18, borderRadius: 16, justifyContent: 'center' },
  segOn: { backgroundColor: colors.green },
  segText: { fontFamily: fontFamily.extrabold, fontSize: 13, color: colors.ink },
  radius: { height: 44, paddingHorizontal: 14, borderRadius: 22, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', gap: 6 },
  radiusText: { fontFamily: fontFamily.bold, fontSize: 13, color: colors.ink },
  hint: { fontFamily: fontFamily.semibold, fontSize: 11, color: colors.muted, marginTop: 6 },
  content: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 24, gap: 12 },
  message: { backgroundColor: colors.mint, borderRadius: 18, padding: 16, gap: 8, marginTop: 8 },
  messageTitle: { fontFamily: fontFamily.extrabold, fontSize: 15, color: colors.greenDark },
  messageBody: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 19, color: colors.muted },
});
