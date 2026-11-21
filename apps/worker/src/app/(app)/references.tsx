import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BottomBar, FieldError, LabeledInput, OnboardingTop } from '@/components/onboarding';
import { referenceErrors, validateReferences, type ReferenceInput } from '@/features/documents/references';
import { t } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { colors, fontFamily } from '@/theme';

const EMPTY: ReferenceInput = { name: '', phone: '', address: '' };

// TEMPORARY form for the "2 references instead of a police certificate" option. The design only mentions it
// (docs/OPEN-QUESTIONS.md). Stored with set_my_references, which replaces both references at once.
export default function ReferencesScreen() {
  const router = useRouter();
  const [refs, setRefs] = useState<[ReferenceInput, ReferenceInput]>([{ ...EMPTY }, { ...EMPTY }]);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (index: 0 | 1, field: keyof ReferenceInput, value: string) => {
    setRefs((current) => {
      const next: [ReferenceInput, ReferenceInput] = [{ ...current[0] }, { ...current[1] }];
      next[index][field] = value;
      return next;
    });
    if (error) setError(null);
  };

  async function onSave() {
    if (saving) return;
    setSubmitted(true);
    const result = validateReferences(refs);
    if (!result.ok) {
      setError(result.reason === 'same' ? t('references.errors.same') : t('references.errors.incomplete'));
      return;
    }
    setError(null);
    setSaving(true);
    let failure: string | null = null;
    try {
      const { error: rpcError } = await supabase.rpc('set_my_references', { p_refs: result.payload });
      if (rpcError) {
        const text = `${rpcError.message}`.toLowerCase();
        failure = text.includes('can only be changed') ? t('references.errors.locked') : t('references.errors.generic');
      }
    } catch {
      failure = t('references.errors.network');
    }
    setSaving(false);
    if (failure) {
      setError(failure);
      return;
    }
    router.replace('/documents');
  }

  return (
    <View style={styles.root}>
      <OnboardingTop step={2} onBack={() => router.back()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <View style={styles.heading}>
            <Text style={styles.title}>{t('references.title')}</Text>
            <Text style={styles.subtitle}>{t('references.subtitle')}</Text>
          </View>
          {([0, 1] as const).map((index) => {
            const errors = submitted ? referenceErrors(refs[index]) : {};
            return (
              <View key={index} style={styles.group}>
                <Text style={styles.groupTitle}>{t('references.person', { n: index + 1 })}</Text>
                <LabeledInput
                  label={t('references.name')}
                  value={refs[index].name}
                  onChangeText={(v) => set(index, 'name', v)}
                  autoCapitalize="words"
                  autoComplete="off"
                  maxLength={100}
                  invalid={errors.name === true}
                />
                <LabeledInput
                  label={t('references.phone')}
                  value={refs[index].phone}
                  onChangeText={(v) => set(index, 'phone', v)}
                  placeholder={t('references.phonePlaceholder')}
                  keyboardType="phone-pad"
                  autoComplete="off"
                  maxLength={20}
                  invalid={errors.phone === true}
                />
                <LabeledInput
                  label={t('references.address')}
                  value={refs[index].address}
                  onChangeText={(v) => set(index, 'address', v)}
                  placeholder={t('references.addressPlaceholder')}
                  autoComplete="off"
                  maxLength={200}
                  invalid={errors.address === true}
                />
              </View>
            );
          })}
          {error ? <FieldError>{error}</FieldError> : null}
        </ScrollView>
        <BottomBar label={t('references.save')} onPress={() => void onSave()} loading={saving} />
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 24, gap: 14 },
  heading: { gap: 4 },
  title: { fontFamily: fontFamily.extrabold, fontSize: 26, lineHeight: 30, letterSpacing: -0.26, color: colors.ink },
  subtitle: { fontFamily: fontFamily.regular, fontSize: 13, lineHeight: 19.5, color: colors.muted },
  group: { gap: 10 },
  groupTitle: { fontFamily: fontFamily.extrabold, fontSize: 15, color: colors.greenDark },
});
