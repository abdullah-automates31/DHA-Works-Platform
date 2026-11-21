import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AboutBox } from '@/components/AboutBox';
import { TextLink } from '@/components/AuthForm';
import { BottomBar, FieldError, NumberField, OnboardingTop, Pill, Stepper } from '@/components/onboarding';
import { VoiceIntro, type Recorded } from '@/components/VoiceIntro';
import {
  VOICE_MIME,
  aboutChanged,
  buildVoicePath,
  checkVoice,
  digitsOnly,
  parseFee,
  parseYears,
  toggleTrade,
} from '@/features/work/rules';
import { submitApplication, type SubmitClient } from '@/features/work/submit';
import { useWork } from '@/features/work/useWork';
import { t } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { useMyProfile } from '@/lib/profile';
import { supabase } from '@/lib/supabase';
import { colors, fontFamily } from '@/theme';

// W03b Your work: trades, experience, visit fee, optional voice introduction, then "Submit application".
// The voice file goes to the worker's own folder in worker-media; the business rules stay in the database RPCs.
export default function WorkScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { refresh } = useMyProfile();
  const work = useWork();
  const userId = session?.user.id ?? '';

  if (work.status === 'loading') {
    return <View style={styles.root} />;
  }
  if (work.status === 'error') {
    return (
      <View style={[styles.root, { padding: 26, justifyContent: 'center', gap: 16 }]}>
        <FieldError>{t('work.errors.network')}</FieldError>
        <TextLink label={t('common.back')} onPress={() => router.replace('/documents')} />
      </View>
    );
  }

  return <WorkForm work={work} userId={userId} refresh={refresh} onBack={() => router.replace('/documents')} />;
}

type Ready = Extract<ReturnType<typeof useWork>, { status: 'ready' }>;

function WorkForm({ work, userId, refresh, onBack }: { work: Ready; userId: string; refresh: () => Promise<void>; onBack: () => void }) {
  const [selected, setSelected] = useState<number[]>(work.selected);
  const [years, setYears] = useState(work.years === null ? '' : String(work.years));
  const [fee, setFee] = useState(work.fee === null ? '' : String(work.fee));
  const [about, setAbout] = useState(work.about);
  const [recorded, setRecorded] = useState<Recorded | null>(null);
  const [voiceMessage, setVoiceMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ trades?: string; years?: string; fee?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const hasRecording = recorded !== null || work.voicePath !== null;
  const playbackUri = recorded?.uri ?? work.voiceUrl;

  async function onSubmit() {
    if (submitting) return;
    const yearsResult = parseYears(years);
    const feeResult = parseFee(fee);
    const next = {
      trades: selected.length > 0 ? undefined : t('work.errors.pickTrade'),
      years: yearsResult.ok ? undefined : t('work.errors.years'),
      fee: feeResult.ok ? undefined : t('work.errors.fee'),
    };
    setErrors(next);
    setFormError(null);
    if (next.trades || next.years || next.fee || !yearsResult.ok || !feeResult.ok) return;

    setSubmitting(true);
    let newVoice: ArrayBuffer | null = null;
    if (recorded) {
      try {
        newVoice = await (await fetch(recorded.uri)).arrayBuffer();
      } catch {
        setSubmitting(false);
        setFormError(t('work.errors.voice'));
        return;
      }
      const check = checkVoice(newVoice.byteLength, recorded.durationMs);
      if (!check.ok) {
        setSubmitting(false);
        setFormError(check.reason === 'tooShort' ? t('work.errors.voiceTooShort') : t('work.errors.voice'));
        return;
      }
    }

    const client: SubmitClient = {
      setCategories: (ids) => supabase.rpc('set_my_categories', { p_category_ids: ids }),
      updateDetails: ({ years: y, fee: f, voicePath, about: text }) =>
        supabase.rpc('update_worker_details', {
          p_experience_years: y ?? undefined,
          p_visit_fee: f ?? undefined,
          p_voice_intro_path: voicePath ?? undefined,
          p_about: text ?? undefined,
        }),
      uploadVoice: async (bytes) => {
        const path = buildVoicePath(userId, Date.now(), Math.random().toString(16).slice(2, 10));
        const { error } = await supabase.storage.from('worker-media').upload(path, bytes, { contentType: VOICE_MIME, upsert: false });
        return { path: error ? null : path, error };
      },
      deleteVoice: (path) => supabase.storage.from('worker-media').remove([path]),
      submit: () => supabase.rpc('submit_for_review'),
    };
    const result = await submitApplication(client, {
      tradeIds: selected,
      years: yearsResult.value,
      fee: feeResult.value,
      newVoice,
      previousVoicePath: work.voicePath,
      about: aboutChanged(about, work.about) ? about : null,
    });
    if (!result.ok) {
      setSubmitting(false);
      setFormError(t(result.key));
      return;
    }
    // The profile is now "pending": the route guard moves the worker to the under-review screen.
    await refresh();
    setSubmitting(false);
  }

  return (
    <View style={styles.root}>
      <OnboardingTop step={3} onBack={onBack} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <Stepper current={3} />
          <View style={styles.heading}>
            <Text style={styles.title}>{t('work.title')}</Text>
            <Text style={styles.subtitle}>{t('work.subtitle')}</Text>
          </View>

          <View style={{ gap: 6 }}>
            <Text style={styles.label}>{t('work.expertise')}</Text>
            <Text style={styles.hint}>{t('work.expertiseHint')}</Text>
            <View style={styles.pills}>
              {work.trades.map((trade) => (
                <Pill
                  key={trade.id}
                  label={trade.name}
                  on={selected.includes(trade.id)}
                  onPress={() => {
                    setSelected((s) => toggleTrade(s, trade.id));
                    if (errors.trades) setErrors((e) => ({ ...e, trades: undefined }));
                  }}
                />
              ))}
            </View>
            {errors.trades ? <FieldError>{errors.trades}</FieldError> : null}
          </View>

          <View style={styles.pair}>
            <NumberField
              label={t('work.experience')}
              suffix={t('work.years')}
              value={years}
              onChangeText={(v) => {
                setYears(digitsOnly(v, 2));
                if (errors.years) setErrors((e) => ({ ...e, years: undefined }));
              }}
              maxLength={2}
              error={Boolean(errors.years)}
            />
            <NumberField
              label={t('work.visitFee')}
              prefix={t('work.rupees')}
              value={fee}
              onChangeText={(v) => {
                setFee(digitsOnly(v, 7));
                if (errors.fee) setErrors((e) => ({ ...e, fee: undefined }));
              }}
              maxLength={7}
              error={Boolean(errors.fee)}
            />
          </View>
          {errors.years ? <FieldError>{errors.years}</FieldError> : null}
          {errors.fee ? <FieldError>{errors.fee}</FieldError> : null}
          <Text style={styles.feeNote}>{t('work.feeNote')}</Text>

          <VoiceIntro
            playbackUri={playbackUri}
            hasRecording={hasRecording}
            onRecorded={setRecorded}
            onError={setVoiceMessage}
          />
          {voiceMessage ? <FieldError>{voiceMessage}</FieldError> : null}
          <AboutBox
            label={t('work.about')}
            hint={t('work.aboutHint')}
            placeholder={t('work.aboutPlaceholder')}
            value={about}
            onChange={setAbout}
          />
          {formError ? <FieldError>{formError}</FieldError> : null}
        </ScrollView>
        <BottomBar label={t('work.submit')} onPress={() => void onSubmit()} loading={submitting} hideArrow />
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
  label: { fontFamily: fontFamily.bold, fontSize: 12, color: colors.muted },
  hint: { fontFamily: fontFamily.medium, fontSize: 12, color: colors.muted, marginTop: -4 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pair: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  feeNote: { fontFamily: fontFamily.medium, fontSize: 12, lineHeight: 17, color: colors.muted, marginTop: -6 },
});
