import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomBar, FieldError } from '@/components/onboarding';
import { CheckIcon, SearchIcon } from '@/components/icons';
import { toggleTrade } from '@/features/work/rules';
import { t } from '@/i18n';
import { useMyProfile } from '@/lib/profile';
import { supabase } from '@/lib/supabase';
import { showToast } from '@/lib/toast';
import { colors, fontFamily } from '@/theme';

// W05 Where do you work? DHA phases 1 to 8 (from service_areas), multi-select, saved with set_my_areas.
// The same screen is reused later to change areas (the button then says "Save areas").
export default function AreasScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state, refresh } = useMyProfile();
  const current = state.status === 'ready' ? state.areas : [];
  const firstTime = current.length === 0;

  const [phases, setPhases] = useState<number[]>([1, 2, 3, 4, 5, 6, 7, 8]);
  const [selected, setSelected] = useState<number[]>(current);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The phases come from the database (only active ones can be chosen); the list above is the safe default.
  useEffect(() => {
    let active = true;
    void supabase
      .from('service_areas')
      .select('phase')
      .eq('active', true)
      .order('phase')
      .then(({ data }) => {
        if (active && data && data.length > 0) setPhases(data.map((p) => p.phase));
      });
    return () => {
      active = false;
    };
  }, []);

  async function onSave() {
    if (saving) return;
    if (selected.length === 0) {
      setError(t('areas.errors.pick'));
      return;
    }
    setError(null);
    setSaving(true);
    let failure: string | null = null;
    try {
      const { error: rpcError } = await supabase.rpc('set_my_areas', { p_phases: selected });
      if (rpcError) failure = t('areas.errors.generic');
    } catch {
      failure = t('areas.errors.network');
    }
    if (failure) {
      setSaving(false);
      setError(failure);
      return;
    }
    await refresh();
    setSaving(false);
    if (!firstTime) showToast(t('common.saved'));
    router.replace(firstTime ? '/home' : '/profile');
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
        {firstTime ? (
          <View style={styles.approved}>
            <View style={styles.approvedIcon}>
              <CheckIcon size={16} color={colors.greenDark} strokeWidth={3} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.approvedTitle}>{t('areas.approvedTitle')}</Text>
              <Text style={styles.approvedBody}>{t('areas.approvedBody')}</Text>
            </View>
          </View>
        ) : null}

        <View style={{ gap: 8, marginTop: 4 }}>
          <Text style={styles.title}>{t('areas.title')}</Text>
          <Text style={styles.subtitle}>{t('areas.subtitle')}</Text>
        </View>

        <View style={styles.countRow}>
          <Text style={styles.countLabel}>{t('areas.phases')}</Text>
          <Text style={styles.count}>{t('areas.selected', { count: selected.length, total: phases.length })}</Text>
        </View>

        <View style={styles.grid}>
          {phases.map((phase) => {
            const on = selected.includes(phase);
            return (
              <Pressable
                key={phase}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() => {
                  setSelected((s) => toggleTrade(s, phase));
                  if (error) setError(null);
                }}
                style={[styles.slot, on && styles.slotOn]}
              >
                <Text style={[styles.slotText, on && { color: '#fff' }]}>{t('areas.phase', { n: phase })}</Text>
              </Pressable>
            );
          })}
        </View>
        {error ? <FieldError>{error}</FieldError> : null}

        <View style={styles.more}>
          <View style={styles.moreIcon}>
            <SearchIcon size={22} color={colors.green} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.moreTitle}>{t('areas.moreTitle')}</Text>
            <Text style={styles.moreBody}>{t('areas.moreBody')}</Text>
          </View>
        </View>
      </ScrollView>
      <BottomBar label={firstTime ? t('areas.start') : t('areas.save')} onPress={() => void onSave()} loading={saving} hideArrow />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingBottom: 24, gap: 16 },
  approved: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.green, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14 },
  approvedIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  approvedTitle: { fontFamily: fontFamily.extrabold, fontSize: 13, color: '#fff' },
  approvedBody: { fontFamily: fontFamily.regular, fontSize: 12, color: colors.onGreenMuted },
  title: { fontFamily: fontFamily.extrabold, fontSize: 28, lineHeight: 32, letterSpacing: -0.28, color: colors.ink },
  subtitle: { fontFamily: fontFamily.regular, fontSize: 13, lineHeight: 19.5, color: colors.muted },
  countRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  countLabel: { fontFamily: fontFamily.extrabold, fontSize: 13, color: colors.ink },
  count: { fontFamily: fontFamily.bold, fontSize: 12, color: colors.green },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: -6 },
  slot: { width: '23.2%', height: 46, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  slotOn: { backgroundColor: colors.green },
  slotText: { fontFamily: fontFamily.bold, fontSize: 12, color: colors.ink },
  more: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.mint, borderRadius: 18, padding: 14 },
  moreIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  moreTitle: { fontFamily: fontFamily.extrabold, fontSize: 13, color: colors.ink },
  moreBody: { fontFamily: fontFamily.bold, fontSize: 12, lineHeight: 16, color: colors.muted },
});
