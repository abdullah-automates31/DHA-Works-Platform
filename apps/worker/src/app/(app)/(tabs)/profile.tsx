import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/AuthForm';
import { ProfilePhoto } from '@/components/ProfilePhoto';
import { ShieldCheckIcon } from '@/components/icons';
import { FieldError } from '@/components/onboarding';
import { owedText } from '@/features/dues/rules';
import { useMyDues } from '@/features/dues/useMyDues';
import { formatRupees } from '@/features/home/format';
import { areaSummary, ratingText, tradeSummary } from '@/features/profile/summary';
import { useProfileSummary } from '@/features/profile/useProfileSummary';
import { t } from '@/i18n';
import { useMyProfile } from '@/lib/profile';
import { colors, fontFamily } from '@/theme';

// W16 Profile (worker/screens/w-profile.dc.html): name, trade and areas, "Verified worker", this week's cash,
// rating and jobs done, an "Available today" switch, the Job reminders switch (the owner wants it here too, 26 Nov), My dues, My introduction and a link to
// Settings. Everything else (trade, areas, help, signing out) lives in Settings only (Shariq, 26 Nov: no item in two places). The figures come
// from get_my_earnings (cash counts only jobs whose two amounts matched). The mock's other rows (visit fee,
// language, reviews) are not drawn in the approved rows and are not built.
export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state: profileState } = useMyProfile();
  const { data, reload, setAvailable, setReminders } = useProfileSummary();
  const duesState = useMyDues().state;
  const owedValue = duesState.status === 'ready' ? owedText(duesState.dues.summary) : '';
  const [switchError, setSwitchError] = useState(false);

  const profile = profileState.status === 'ready' ? profileState.profile : null;
  const areas = profileState.status === 'ready' ? profileState.areas : [];
  const ready = data.status === 'ready' ? data : null;
  const names = ready ? ready.trades.filter((tr) => ready.mine.includes(tr.id)).map((tr) => tr.name) : [];
  const approved = profile?.verification_status === 'approved';

  async function onToggle(value: boolean) {
    setSwitchError(false);
    if (!(await setAvailable(value))) setSwitchError(true);
  }

  async function onToggleReminders(value: boolean) {
    setSwitchError(false);
    if (!(await setReminders(value))) setSwitchError(true);
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => void reload()} tintColor={colors.green} />}
      >
        <Pressable accessibilityRole="button" accessibilityLabel={t('settings.personal')} onPress={() => router.push('/settings/personal')} style={styles.header}>
          <ProfilePhoto size={72} />
          <Text style={styles.name}>{profile?.full_name ?? ''}</Text>
          <Text style={styles.sub}>
            {ready ? `${tradeSummary(names)} · ${areaSummary(areas)}` : areaSummary(areas)}
          </Text>
          {approved ? (
            <View style={styles.verified}>
              <ShieldCheckIcon size={16} color={colors.greenDark} />
              <Text style={styles.verifiedText}>{t('profile.verified')}</Text>
            </View>
          ) : null}
        </Pressable>

        {data.status === 'loading' ? <ActivityIndicator color={colors.green} /> : null}
        {data.status === 'error' ? (
          <View style={styles.message}>
            <Text style={styles.messageTitle}>{t('profile.loadFailedTitle')}</Text>
            <Text style={styles.messageBody}>{t('profile.loadFailedBody')}</Text>
            <PrimaryButton label={t('common.retry')} onPress={() => void reload()} showArrow={false} />
          </View>
        ) : null}

        {ready ? (
          <>
            <View style={styles.stats}>
              <Stat value={formatRupees(ready.earnings.cashThisWeek)} label={t('profile.cashThisWeek')} />
              <Stat value={ratingText(ready.earnings.ratingAvg, ready.earnings.ratingCount)} label={t('profile.rating')} />
              <Stat value={String(ready.earnings.jobsDone)} label={t('profile.jobsDone')} />
            </View>

            <View style={styles.card}>
              <View style={[styles.row, styles.divider]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{t('profile.available')}</Text>
                  <Text style={styles.rowHint}>{t(ready.available ? 'profile.availableOn' : 'profile.availableOff')}</Text>
                </View>
                <Switch
                  accessibilityLabel={t('profile.available')}
                  value={ready.available}
                  onValueChange={(value) => void onToggle(value)}
                  trackColor={{ false: '#C9CFCB', true: colors.greenDark }}
                  thumbColor="#fff"
                />
              </View>
              <View style={[styles.row, styles.divider]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{t('profile.reminders')}</Text>
                  <Text style={styles.rowHint}>{t(ready.reminders ? 'profile.remindersOn' : 'profile.remindersOff')}</Text>
                </View>
                <Switch
                  accessibilityLabel={t('profile.reminders')}
                  value={ready.reminders}
                  onValueChange={(value) => void onToggleReminders(value)}
                  trackColor={{ false: '#C9CFCB', true: colors.greenDark }}
                  thumbColor="#fff"
                />
              </View>
              <Row title={t('dues.profileRow')} value={owedValue} onPress={() => router.push('/dues')} divider />
              <Row title={t('profile.introduction')} onPress={() => router.push('/introduction')} divider />
              <Row title={t('settings.open')} value={t('profile.settingsHint')} onPress={() => router.push('/settings')} />
            </View>
            {switchError ? <FieldError>{t('profile.errors.generic')}</FieldError> : null}
          </>
        ) : null}
      </ScrollView>

    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Row({ title, value, onPress, divider, danger }: { title: string; value?: string; onPress: () => void; divider?: boolean; danger?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.row, divider && styles.divider]}>
      <Text style={[styles.rowTitle, danger && { color: colors.chip.declined.fg }]}>{title}</Text>
      <View style={{ flex: 1 }} />
      {value ? (
        <Text style={styles.rowValue} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {danger ? null : <Text style={styles.chev}>›</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 14 },
  header: { alignItems: 'center', gap: 6 },
  name: { fontFamily: fontFamily.extrabold, fontSize: 22, color: colors.ink, marginTop: 4 },
  sub: { fontFamily: fontFamily.semibold, fontSize: 13, color: colors.muted, textAlign: 'center' },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.mint, borderRadius: 14, paddingVertical: 6, paddingHorizontal: 12, marginTop: 4 },
  verifiedText: { fontFamily: fontFamily.extrabold, fontSize: 12, color: colors.greenDark },
  stats: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, backgroundColor: '#fff', borderRadius: 18, paddingVertical: 14, paddingHorizontal: 8, alignItems: 'center', gap: 2 },
  statValue: { fontFamily: fontFamily.extrabold, fontSize: 16, color: colors.greenDark },
  statLabel: { fontFamily: fontFamily.semibold, fontSize: 11, color: colors.muted, textAlign: 'center' },
  card: { backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingVertical: 10 },
  divider: { borderBottomWidth: 1.5, borderBottomColor: '#E2ECE6' },
  rowTitle: { fontFamily: fontFamily.extrabold, fontSize: 15, color: colors.ink },
  rowHint: { fontFamily: fontFamily.semibold, fontSize: 12, color: colors.muted, marginTop: 2 },
  rowValue: { flexShrink: 1, maxWidth: '55%', fontFamily: fontFamily.semibold, fontSize: 13, color: colors.muted },
  chev: { fontFamily: fontFamily.extrabold, fontSize: 20, color: colors.muted },
  message: { backgroundColor: colors.mint, borderRadius: 18, padding: 16, gap: 10 },
  messageTitle: { fontFamily: fontFamily.extrabold, fontSize: 16, color: colors.greenDark },
  messageBody: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 19, color: colors.muted },
});
