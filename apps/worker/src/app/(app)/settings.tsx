import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ProfilePhoto } from '@/components/ProfilePhoto';
import { Card, InfoRow, NavRow, SectionTitle, SettingsTop, settingsStyles } from '@/components/SettingsParts';
import { displayPhone, versionText } from '@/features/settings/rules';
import { t } from '@/i18n';
import { useMyProfile } from '@/lib/profile';
import { signOut } from '@/lib/signOut';
import { colors, fontFamily } from '@/theme';

const STATUS_KEY = {
  incomplete: 'settings.statusIncomplete',
  pending: 'settings.statusPending',
  approved: 'settings.statusApproved',
  needs_changes: 'settings.statusNeedsChanges',
  visit_hq: 'settings.statusVisitHq',
  rejected: 'settings.statusRejected',
} as const;

// Settings: the ONE place for account, preferences, help and signing out (Shariq, 26 Nov: Profile and Settings used to repeat each other).
// The profile header opens Personal information; every other row opens its own screen. Terms and Privacy Policy are "coming soon" rows.
export default function SettingsScreen() {
  const router = useRouter();
  const { state } = useMyProfile();
  const [signingOut, setSigningOut] = useState(false);
  const profile = state.status === 'ready' ? state.profile : null;
  const approved = profile?.verification_status === 'approved';
  const status = profile?.verification_status ?? 'incomplete';
  const v = versionText(Constants.expoConfig?.version, Constants.nativeBuildVersion);

  function confirmSignOut() {
    if (signingOut) return;
    Alert.alert(t('settings.signOutTitle'), t('settings.signOutBody'), [
      { text: t('settings.cancel'), style: 'cancel' },
      {
        text: t('settings.signOutConfirm'),
        style: 'destructive',
        onPress: () => {
          setSigningOut(true);
          // signOut removes this phone's push token first, then ends the session; the app then returns to sign-in by itself.
          void signOut().finally(() => setSigningOut(false));
        },
      },
    ]);
  }

  return (
    <View style={settingsStyles.root}>
      <SettingsTop title={t('settings.title')} />
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('settings.personal')} onPress={() => router.push('/settings/personal')} style={styles.header}>
          <ProfilePhoto size={64} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.name} numberOfLines={1}>
              {profile?.full_name ?? ''}
            </Text>
            <Text style={styles.phone}>{displayPhone(profile?.phone)}</Text>
            <View style={[styles.chip, approved ? styles.chipOk : styles.chipWait]}>
              <Text style={[styles.chipText, { color: approved ? colors.chip.done.fg : colors.chip.wait.fg }]}>{t(approved ? 'settings.verifiedBadge' : 'settings.notVerified', { status: t(STATUS_KEY[status]) })}</Text>
            </View>
          </View>
          <Text style={styles.chev}>›</Text>
        </Pressable>

        <SectionTitle>{t('settings.account')}</SectionTitle>
        <Card>
          <NavRow title={t('settings.personal')} hint={t('settings.personalHint')} onPress={() => router.push('/settings/personal')} divider />
          <NavRow title={t('settings.professional')} hint={t('settings.professionalHint')} onPress={() => router.push('/settings/professional')} divider />
          <NavRow title={t('settings.serviceArea')} hint={t('settings.serviceAreaHint')} onPress={() => router.push('/settings/service-area')} divider />
          <NavRow title={t('settings.verification')} hint={t('settings.verificationHint')} onPress={() => router.push('/settings/verification')} />
        </Card>

        <SectionTitle>{t('settings.preferences')}</SectionTitle>
        <Card>
          <NavRow title={t('settings.notifications')} hint={t('settings.notificationsHint')} onPress={() => router.push('/settings/notifications')} divider />
          <NavRow title={t('settings.privacy')} hint={t('settings.privacyHint')} onPress={() => router.push('/settings/privacy')} />
        </Card>

        <SectionTitle>{t('settings.support')}</SectionTitle>
        <Card>
          <NavRow title={t('help.title')} hint={t('settings.helpAndSupportHint')} onPress={() => router.push('/help')} />
        </Card>

        <SectionTitle>{t('settings.legal')}</SectionTitle>
        <Card>
          <NavRow title={t('settings.terms')} value={t('settings.comingSoon')} disabled divider />
          <NavRow title={t('settings.privacyPolicy')} value={t('settings.comingSoon')} disabled divider />
          <InfoRow title={t('settings.version')} value={v.version} divider={v.build !== null} />
          {v.build !== null ? <InfoRow title={t('settings.build')} value={v.build} /> : null}
        </Card>

        <Card>
          <NavRow title={t('settings.signOut')} danger onPress={confirmSignOut} disabled={signingOut} />
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: '#fff', borderRadius: 20, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 },
  name: { fontFamily: fontFamily.extrabold, fontSize: 18, color: colors.ink },
  phone: { fontFamily: fontFamily.semibold, fontSize: 13, color: colors.muted },
  chip: { alignSelf: 'flex-start', borderRadius: 12, paddingVertical: 4, paddingHorizontal: 10, marginTop: 4 },
  chipOk: { backgroundColor: colors.chip.done.bg },
  chipWait: { backgroundColor: colors.chip.wait.bg },
  chipText: { fontFamily: fontFamily.extrabold, fontSize: 12 },
  chev: { fontFamily: fontFamily.extrabold, fontSize: 22, color: colors.muted },
});
