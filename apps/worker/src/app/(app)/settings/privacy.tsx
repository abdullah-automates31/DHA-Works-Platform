import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/AuthForm';
import { Card, InfoRow, Notice, SectionTitle, SettingsTop, settingsStyles } from '@/components/SettingsParts';
import { OTP_CHANNEL_NAME } from '@/features/auth/channel';
import { timeAgo } from '@/features/feed/format';
import { dateText } from '@/features/myreports/rules';
import { currentDeviceToken } from '@/features/push/device';
import { parseSessions, signOutOtherPhones, type MySession } from '@/features/settings/requests';
import { displayPhone } from '@/features/settings/rules';
import { t } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { useMyProfile } from '@/lib/profile';
import { supabase } from '@/lib/supabase';
import { colors, fontFamily } from '@/theme';

const KIND = { android: 'settings.privacyScreen.kindAndroid', iphone: 'settings.privacyScreen.kindIphone', other: 'settings.privacyScreen.kindOther' } as const;

// Settings > Privacy and security. Only facts the app really has: the registered number, how sign-in works, the phones
// signed in to this account (auth sessions, migration 0067) with a button to sign the others out. There is no password to
// change (sign-in is a one-time code) and no token or code is shown.
export default function PrivacyScreen() {
  const { session } = useAuth();
  const { state } = useMyProfile();
  const profile = state.status === 'ready' ? state.profile : null;
  const lastSignIn = session?.user.last_sign_in_at ? dateText(session.user.last_sign_in_at) : '';

  const [phones, setPhones] = useState<MySession[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    void supabase.rpc('my_sessions').then(({ data, error }) => {
      if (!active) return;
      if (error) setFailed(true);
      else {
        setFailed(false);
        setPhones(parseSessions(data));
      }
    });
    return () => {
      active = false;
    };
  }, [attempt]);

  const others = (phones ?? []).filter((p) => !p.current);

  function confirmSignOutOthers() {
    if (busy) return;
    Alert.alert(t('settings.privacyScreen.signOutOthersTitle'), t('settings.privacyScreen.signOutOthersBody'), [
      { text: t('settings.cancel'), style: 'cancel' },
      {
        text: t('settings.privacyScreen.signOutOthers'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setBusy(true);
            setMessage(null);
            const keep = await currentDeviceToken();
            const result = await signOutOtherPhones({ signOutOthers: (token) => supabase.rpc('sign_out_other_sessions', { p_keep_token: token ?? undefined }) }, keep);
            setBusy(false);
            if (!result.ok) {
              setMessage({ kind: 'error', text: t(result.key) });
              return;
            }
            setMessage({ kind: 'ok', text: t('settings.privacyScreen.signOutOthersDone', { count: result.count }) });
            setAttempt((n) => n + 1);
          })();
        },
      },
    ]);
  }

  return (
    <View style={settingsStyles.root}>
      <SettingsTop title={t('settings.privacy')} />
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <Card>
          <InfoRow title={t('settings.privacyScreen.phone')} value={displayPhone(profile?.phone)} divider />
          <InfoRow title={t('settings.privacyScreen.method')} value={t('settings.privacyScreen.methodValue', { channel: OTP_CHANNEL_NAME })} divider={lastSignIn !== ''} />
          {lastSignIn ? <InfoRow title={t('settings.privacyScreen.lastSignIn')} value={lastSignIn} /> : null}
        </Card>
        <Text style={settingsStyles.body}>{t('settings.privacyScreen.noPassword')}</Text>

        <SectionTitle>{t('settings.privacyScreen.phonesTitle')}</SectionTitle>
        <Text style={settingsStyles.body}>{t('settings.privacyScreen.phonesBody')}</Text>
        {failed && phones === null ? <Notice kind="error">{t('settings.privacyScreen.phonesFailed')}</Notice> : null}
        {(phones ?? []).map((p) => (
          <View key={p.id} style={styles.phone}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.phoneTitle}>{t(KIND[p.label])}</Text>
              {p.lastActive ? <Text style={styles.phoneSub}>{t('settings.privacyScreen.activeAgo', { when: timeAgo(p.lastActive) })}</Text> : null}
            </View>
            {p.current ? (
              <View style={styles.tag}>
                <Text style={styles.tagText}>{t('settings.privacyScreen.thisPhoneTag')}</Text>
              </View>
            ) : null}
          </View>
        ))}
        {phones !== null && others.length === 0 ? <Text style={settingsStyles.body}>{t('settings.privacyScreen.noOthers')}</Text> : null}
        {others.length > 0 ? <PrimaryButton label={t('settings.privacyScreen.signOutOthers')} onPress={confirmSignOutOthers} loading={busy} showArrow={false} /> : null}
        {message ? <Notice kind={message.kind}>{message.text}</Notice> : null}

        <SectionTitle>{t('settings.privacyScreen.tips')}</SectionTitle>
        <Card>
          <Text style={[settingsStyles.body, { paddingTop: 14 }]}>{`• ${t('settings.privacyScreen.tip1')}`}</Text>
          <Text style={[settingsStyles.body, { paddingTop: 8 }]}>{`• ${t('settings.privacyScreen.tip2')}`}</Text>
          <Text style={[settingsStyles.body, { paddingVertical: 8, paddingBottom: 14 }]}>{`• ${t('settings.privacyScreen.tip3')}`}</Text>
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  phone: { backgroundColor: '#fff', borderRadius: 18, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  phoneTitle: { fontFamily: fontFamily.extrabold, fontSize: 15, color: colors.ink },
  phoneSub: { fontFamily: fontFamily.semibold, fontSize: 12, color: colors.muted },
  tag: { backgroundColor: colors.chip.done.bg, borderRadius: 12, paddingVertical: 4, paddingHorizontal: 10 },
  tagText: { fontFamily: fontFamily.extrabold, fontSize: 12, color: colors.chip.done.fg },
});
