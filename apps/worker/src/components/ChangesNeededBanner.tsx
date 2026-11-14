import { StyleSheet, Text, View } from 'react-native';

import { changesNeededReason } from '@/features/profile/routing';
import { t } from '@/i18n';
import { useMyProfile } from '@/lib/profile';
import { colors, fontFamily } from '@/theme';

// Shown at the top of the sign-up screens when DHA staff asked for changes ("Ask for changes" in the portal): it says
// what to fix, in the words staff wrote, until the worker sends the application again. Nothing is drawn otherwise.
export function ChangesNeededBanner() {
  const { state } = useMyProfile();
  const profile = state.status === 'ready' ? state.profile : null;
  const reason = changesNeededReason(profile);
  if (reason === null) return null;
  return (
    <View accessible accessibilityRole="alert" accessibilityLabel={`${t('onboarding.changesTitle')}. ${reason || t('onboarding.changesNoReason')}`} style={styles.box}>
      <Text style={styles.title}>{t('onboarding.changesTitle')}</Text>
      <Text style={styles.body}>{reason || t('onboarding.changesNoReason')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginHorizontal: 20, marginBottom: 12, backgroundColor: colors.chip.wait.bg, borderRadius: 16, padding: 14, gap: 4 },
  title: { fontFamily: fontFamily.extrabold, fontSize: 14, color: colors.chip.wait.fg },
  body: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 19, color: colors.chip.wait.fg },
});
