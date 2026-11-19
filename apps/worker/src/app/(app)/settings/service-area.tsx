import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/AuthForm';
import { Card, SectionTitle, SettingsTop, settingsStyles } from '@/components/SettingsParts';
import { t } from '@/i18n';
import { useMyProfile } from '@/lib/profile';
import { colors, fontFamily } from '@/theme';

// Settings > Service area: the DHA phases the worker registered (worker_areas). There is no GPS and no distance:
// jobs are matched by phase only. Phases are the worker's own choice (set_my_areas), so "change" opens the existing
// areas screen; no staff request is needed.
export default function ServiceAreaScreen() {
  const router = useRouter();
  const { state } = useMyProfile();
  const phases = state.status === 'ready' ? [...state.areas].sort((a, b) => a - b) : [];

  return (
    <View style={settingsStyles.root}>
      <SettingsTop title={t('settings.serviceArea')} />
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <SectionTitle>{t('settings.areaScreen.registered')}</SectionTitle>
        <Card>
          <View style={styles.box}>
            {phases.length === 0 ? (
              <Text style={styles.none}>{t('settings.areaScreen.none')}</Text>
            ) : (
              <View style={styles.chips}>
                {phases.map((phase) => (
                  <View key={phase} style={styles.chip}>
                    <Text style={styles.chipText}>{t('settings.areaScreen.phase', { number: phase })}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </Card>
        <Text style={settingsStyles.body}>{t('settings.areaScreen.coverage')}</Text>
        <PrimaryButton label={t('settings.areaScreen.change')} onPress={() => router.push('/areas')} showArrow={false} />
        <Text style={settingsStyles.body}>{t('settings.areaScreen.changeHint')}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { paddingVertical: 16 },
  none: { fontFamily: fontFamily.semibold, fontSize: 14, color: colors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: colors.mint, borderRadius: 16, paddingVertical: 8, paddingHorizontal: 14 },
  chipText: { fontFamily: fontFamily.extrabold, fontSize: 13, color: colors.greenDark },
});
