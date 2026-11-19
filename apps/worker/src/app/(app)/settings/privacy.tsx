import { ScrollView, Text, View } from 'react-native';

import { Card, InfoRow, SectionTitle, SettingsTop, settingsStyles } from '@/components/SettingsParts';
import { OTP_CHANNEL_NAME } from '@/features/auth/channel';
import { dateText } from '@/features/myreports/rules';
import { displayPhone } from '@/features/settings/rules';
import { t } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { useMyProfile } from '@/lib/profile';

// Settings > Privacy and security. Only facts the app really has: the registered number, how sign-in works, when this
// session last signed in. There is no password to change (sign-in is a one-time code) and no token or code is shown.
// The server keeps no list of other phones, so none is drawn.
export default function PrivacyScreen() {
  const { session } = useAuth();
  const { state } = useMyProfile();
  const profile = state.status === 'ready' ? state.profile : null;
  const lastSignIn = session?.user.last_sign_in_at ? dateText(session.user.last_sign_in_at) : '';

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

        <SectionTitle>{t('settings.privacyScreen.thisDevice')}</SectionTitle>
        <Text style={settingsStyles.body}>{t('settings.privacyScreen.thisDeviceBody')}</Text>

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
