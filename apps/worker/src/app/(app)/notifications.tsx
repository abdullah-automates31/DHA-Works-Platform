import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/AuthForm';
import { LoadMoreFooter } from '@/components/LoadMoreFooter';
import { NoticeListSkeleton, SkeletonGroup } from '@/components/Skeleton';
import { BellIcon, CheckIcon, ChevronLeftIcon } from '@/components/icons';
import { jobHref, statusHref } from '@/features/job/routes';
import { ago, describe, groupNotices, opensDetail, unreadIds, type Notice, type NoticeIcon } from '@/features/notifications/rules';
import { useNotifications } from '@/features/notifications/useNotifications';
import { t } from '@/i18n';
import { nearEnd } from '@/lib/paging';
import { colors, fontFamily } from '@/theme';

// W15 Notifications (worker/screens/w-notifs.dc.html): Today and Earlier, unread rows marked with a dot, a "Mark all
// read" link. Tapping a row marks it read and opens the job. The "New booking request" type of the mock is gone with
// direct requests. New notifications arrive live (Realtime) and the list reloads when the screen is shown.
export default function NotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, reload, markRead, clearAll, loadMore, loadingMore, moreFailed } = useNotifications();
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
  const notices = data.status === 'ready' ? data.notices : [];
  const unread = unreadIds(notices);
  const groups = groupNotices(notices, now);

  function confirmClear() {
    Alert.alert(t('notices.clearConfirmTitle'), t('notices.clearConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('notices.clearAll'),
        style: 'destructive',
        onPress: () => {
          void clearAll().then((ok) => {
            if (!ok) Alert.alert(t('notices.clearFailed'));
          });
        },
      },
    ]);
  }

  function open(n: Notice) {
    if (n.readAt === null) void markRead([n.id]);
    const view = describe(n, now);
    if (view.opensReports) router.push('/my-reports');
    else if (n.jobId && view.opensJob) router.push(opensDetail(n) ? jobHref(n.jobId) : statusHref(n.jobId));
  }

  return (
    <View style={styles.root}>
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))} style={styles.back}>
          <ChevronLeftIcon size={22} color={colors.greenDark} />
        </Pressable>
        <Text style={styles.topTitle}>{t('notices.title')}</Text>
        <Pressable accessibilityRole="button" disabled={unread.length === 0} onPress={() => void markRead()} style={styles.markAll}>
          <Text style={[styles.markAllText, unread.length === 0 && { color: colors.muted }]}>{unread.length === 0 ? t('notices.allRead') : t('notices.markAll')}</Text>
        </Pressable>
      </View>
      {notices.length > 0 ? (
        <View style={styles.clearRow}>
          <Pressable accessibilityRole="button" onPress={confirmClear} style={styles.markAll}>
            <Text style={[styles.markAllText, { color: colors.chip.declined.fg }]}>{t('notices.clearAll')}</Text>
          </Pressable>
        </View>
      ) : null}

      {data.status === 'loading' ? (
        <SkeletonGroup style={{ paddingHorizontal: 20 }}>
          <NoticeListSkeleton />
        </SkeletonGroup>
      ) : null}

      {data.status === 'error' ? (
        <View style={styles.message}>
          <Text style={styles.messageTitle}>{t('notices.errorTitle')}</Text>
          <Text style={styles.messageBody}>{t('notices.errorBody')}</Text>
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
          {groups.length === 0 ? (
            <View style={styles.empty}>
              <BellIcon size={28} color={colors.green} />
              <Text style={styles.emptyTitle}>{t('notices.emptyTitle')}</Text>
              <Text style={styles.emptyBody}>{t('notices.emptyBody')}</Text>
            </View>
          ) : null}
          {groups.map((group) => (
            <View key={group.key} style={{ gap: 8 }}>
              <Text style={styles.groupLabel}>{t(group.key === 'today' ? 'notices.today' : 'notices.earlier')}</Text>
              <View style={styles.card}>
                {group.items.map((n, index) => {
                  const view = describe(n, now);
                  return (
                    <Pressable
                      key={n.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${view.title}. ${view.body}`}
                      onPress={() => open(n)}
                      style={[styles.row, index < group.items.length - 1 && styles.divider]}
                    >
                      <View style={[styles.icon, n.readAt === null && { backgroundColor: colors.mint }]}>
                        <Glyph kind={view.icon} />
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={[styles.rowTitle, n.readAt !== null && { fontFamily: fontFamily.bold }]}>{view.title}</Text>
                        <Text style={styles.rowBody}>{view.body}</Text>
                      </View>
                      <View style={styles.meta}>
                        <Text style={styles.time}>{ago(n, now)}</Text>
                        {n.readAt === null ? <View style={styles.dot} /> : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
          <LoadMoreFooter
            hasMore={data.hasMore}
            loading={loadingMore}
            failed={moreFailed}
            onLoad={() => void loadMore()}
            skeleton={<NoticeListSkeleton rows={2} />}
          />
        </ScrollView>
      ) : null}
    </View>
  );
}

function Glyph({ kind }: { kind: NoticeIcon }) {
  if (kind === 'check') return <CheckIcon size={18} color={colors.greenDark} strokeWidth={3} />;
  return <BellIcon size={18} color={kind === 'alert' ? colors.chip.declined.fg : colors.greenDark} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 12 },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  topTitle: { flex: 1, fontFamily: fontFamily.extrabold, fontSize: 20, color: colors.ink },
  markAll: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' },
  markAllText: { fontFamily: fontFamily.extrabold, fontSize: 13, color: colors.green },
  clearRow: { alignItems: 'flex-end', paddingHorizontal: 12 },
  content: { paddingHorizontal: 20, paddingTop: 2, paddingBottom: 32, gap: 16 },
  groupLabel: { fontFamily: fontFamily.extrabold, fontSize: 13, color: colors.muted },
  card: { backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 14 },
  divider: { borderBottomWidth: 1.5, borderBottomColor: '#E2ECE6' },
  icon: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#EEF4F1', alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontFamily: fontFamily.extrabold, fontSize: 14, color: colors.ink },
  rowBody: { fontFamily: fontFamily.regular, fontSize: 13, lineHeight: 19, color: colors.muted },
  meta: { alignItems: 'flex-end', gap: 6 },
  time: { fontFamily: fontFamily.semibold, fontSize: 11, color: colors.muted },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.gold },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 48 },
  emptyTitle: { fontFamily: fontFamily.extrabold, fontSize: 16, color: colors.ink },
  emptyBody: { fontFamily: fontFamily.semibold, fontSize: 13, color: colors.muted, textAlign: 'center' },
  message: { margin: 20, backgroundColor: colors.mint, borderRadius: 18, padding: 16, gap: 10 },
  messageTitle: { fontFamily: fontFamily.extrabold, fontSize: 16, color: colors.greenDark },
  messageBody: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 19, color: colors.muted },
});
