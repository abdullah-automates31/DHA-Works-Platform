import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AboutBox } from '@/components/AboutBox';
import { LoadError, Notice, SaveBar, SectionTitle, SettingsTop, settingsStyles } from '@/components/SettingsParts';
import { DetailSkeleton, SkeletonGroup } from '@/components/Skeleton';
import { NumberField, Pill } from '@/components/onboarding';
import { saveProfessional, type ProfessionalClient } from '@/features/settings/professional';
import { professionalCanSave, professionalChanges } from '@/features/settings/rules';
import { useUnsavedGuard } from '@/features/settings/useUnsavedGuard';
import { digitsOnly, toggleTrade } from '@/features/work/rules';
import { fetchWork, type WorkData } from '@/features/work/useWork';
import { t } from '@/i18n';
import { supabase } from '@/lib/supabase';

const professionalClient: ProfessionalClient = {
  rpc: (fn, args) =>
    fn === 'update_worker_details'
      ? supabase.rpc('update_worker_details', args as { p_experience_years?: number; p_about?: string })
      : supabase.rpc('set_my_categories', args as { p_category_ids: number[] }),
};

type Ready = Extract<WorkData, { status: 'ready' }>;

// Settings > Professional details: skills and services (the existing trades; none are added), years of experience and
// the written "about" text. Same database functions as the application's "Your work" step and Profile > Introduction.
export default function ProfessionalScreen() {
  const [data, setData] = useState<WorkData>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void fetchWork().then((next) => {
      if (active) setData(next);
    });
    return () => {
      active = false;
    };
  }, [attempt]);
  const retry = () => {
    setData({ status: 'loading' });
    setAttempt((n) => n + 1);
  };

  return (
    <View style={settingsStyles.root}>
      <SettingsTop title={t('settings.professional')} />
      {data.status === 'loading' ? (
        <SkeletonGroup>
          <DetailSkeleton />
        </SkeletonGroup>
      ) : null}
      {data.status === 'error' ? <LoadError onRetry={retry} /> : null}
      {data.status === 'ready' ? <Form work={data} /> : null}
    </View>
  );
}

function Form({ work }: { work: Ready }) {
  const router = useRouter();
  const [saved, setSaved] = useState({ trades: work.selected, years: work.years, about: work.about });
  const [trades, setTrades] = useState<number[]>(work.selected);
  const [years, setYears] = useState(work.years === null ? '' : String(work.years));
  const [about, setAbout] = useState(work.about);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const draft = { trades, years, about };
  const changes = professionalChanges(saved, draft);
  const dirty = changes.trades || changes.years || changes.about;
  const canSave = professionalCanSave(saved, draft);
  useUnsavedGuard(dirty && !saving);

  async function onSave() {
    if (saving || !canSave) return;
    setSaving(true);
    setError(null);
    setDone(false);
    const result = await saveProfessional(professionalClient, saved, draft);
    if (!result.ok) {
      setSaving(false);
      setError(t(result.key));
      return;
    }
    const years2 = years.trim() === '' ? saved.years : Number(years);
    setSaved({ trades: [...trades], years: years2, about: about.trim() });
    setAbout(about.trim());
    setSaving(false);
    setDone(true);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={settingsStyles.content} keyboardShouldPersistTaps="handled">
        <SectionTitle>{t('settings.professionalScreen.skills')}</SectionTitle>
        <Text style={settingsStyles.body}>{t('settings.professionalScreen.skillsHint')}</Text>
        <View style={styles.pills}>
          {work.trades.map((tr) => (
            <Pill
              key={tr.id}
              label={tr.name}
              on={trades.includes(tr.id)}
              onPress={() => {
                setTrades((current) => toggleTrade(current, tr.id));
                setError(null);
                setDone(false);
              }}
            />
          ))}
        </View>
        {changes.noTrade ? <Notice kind="error">{t('settings.errors.trade')}</Notice> : null}

        <SectionTitle>{t('settings.professionalScreen.experience')}</SectionTitle>
        <View style={{ flexDirection: 'row' }}>
          <NumberField
            label={t('settings.professionalScreen.years')}
            suffix={t('settings.professionalScreen.yearsSuffix')}
            value={years}
            onChangeText={(v) => {
              setYears(digitsOnly(v, 2));
              setDone(false);
            }}
            maxLength={2}
            error={changes.yearsInvalid}
            editable={!saving}
          />
        </View>
        {changes.yearsInvalid ? <Notice kind="error">{t('settings.errors.years')}</Notice> : null}

        <AboutBox
          label={t('settings.professionalScreen.about')}
          hint={t('settings.professionalScreen.aboutHint')}
          placeholder={t('settings.professionalScreen.aboutPlaceholder')}
          value={about}
          onChange={(v) => {
            setAbout(v);
            setDone(false);
          }}
        />

        {error ? <Notice kind="error">{error}</Notice> : null}
        {done ? <Notice kind="ok">{t('settings.saved')}</Notice> : null}
      </ScrollView>
      <SaveBar canSave={canSave} saving={saving} onSave={() => void onSave()} onCancel={() => router.back()} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
