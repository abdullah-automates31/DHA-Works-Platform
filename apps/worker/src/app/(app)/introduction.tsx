import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AboutBox } from '@/components/AboutBox';
import { DetailSkeleton, SkeletonGroup } from '@/components/Skeleton';
import { PrimaryButton } from '@/components/AuthForm';
import { VoiceIntro, type Recorded } from '@/components/VoiceIntro';
import { ChevronLeftIcon } from '@/components/icons';
import { FieldError } from '@/components/onboarding';
import { saveIntroduction, type IntroductionClient } from '@/features/work/introduction';
import { VOICE_MIME, aboutChanged, buildVoicePath, checkVoice } from '@/features/work/rules';
import { useWork } from '@/features/work/useWork';
import { t } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { showToast } from '@/lib/toast';
import { colors, fontFamily } from '@/theme';

// Profile > Introduction (Shariq, 2 Nov): the worker's voice introduction and a written "about" text, editable any time.
// Same voice card and storage rules as the application's "Your work" step; business rules stay in update_worker_details.
export default function IntroductionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const work = useWork();
  const userId = session?.user.id ?? '';

  return (
    <View style={styles.root}>
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}>
          <ChevronLeftIcon size={22} color={colors.greenDark} />
        </Pressable>
        <Text style={styles.topTitle}>{t('introduction.title')}</Text>
        <View style={styles.back} />
      </View>
      {work.status === 'loading' ? (
        <SkeletonGroup>
          <DetailSkeleton />
        </SkeletonGroup>
      ) : null}
      {work.status === 'error' ? (
        <View style={{ padding: 20, gap: 14 }}>
          <FieldError>{t('introduction.errors.loadFailed')}</FieldError>
          <PrimaryButton label={t('common.back')} onPress={() => router.back()} showArrow={false} />
        </View>
      ) : null}
      {work.status === 'ready' ? <IntroductionForm work={work} userId={userId} /> : null}
    </View>
  );
}

type Ready = Extract<ReturnType<typeof useWork>, { status: 'ready' }>;

function IntroductionForm({ work, userId }: { work: Ready; userId: string }) {
  const [about, setAbout] = useState(work.about);
  const [savedAbout, setSavedAbout] = useState(work.about);
  const [savedVoicePath, setSavedVoicePath] = useState(work.voicePath);
  const [recorded, setRecorded] = useState<Recorded | null>(null);
  const [voiceMessage, setVoiceMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const hasRecording = recorded !== null || savedVoicePath !== null;
  const playbackUri = recorded?.uri ?? work.voiceUrl;
  const dirty = recorded !== null || aboutChanged(about, savedAbout);

  async function onSave() {
    if (saving || !dirty) return;
    setError(null);
    setJustSaved(false);
    setSaving(true);

    let newVoice: ArrayBuffer | null = null;
    if (recorded) {
      try {
        newVoice = await (await fetch(recorded.uri)).arrayBuffer();
      } catch {
        setSaving(false);
        setError(t('introduction.errors.voice'));
        return;
      }
      const check = checkVoice(newVoice.byteLength, recorded.durationMs);
      if (!check.ok) {
        setSaving(false);
        setError(check.reason === 'tooShort' ? t('work.errors.voiceTooShort') : t('introduction.errors.voice'));
        return;
      }
    }

    const client: IntroductionClient = {
      updateDetails: ({ voicePath, about: text }) =>
        supabase.rpc('update_worker_details', {
          p_voice_intro_path: voicePath ?? undefined,
          p_about: text ?? undefined,
        }),
      uploadVoice: async (bytes) => {
        const path = buildVoicePath(userId, Date.now(), Math.random().toString(16).slice(2, 10));
        const { error: uploadError } = await supabase.storage.from('worker-media').upload(path, bytes, { contentType: VOICE_MIME, upsert: false });
        return { path: uploadError ? null : path, error: uploadError };
      },
      deleteVoice: (path) => supabase.storage.from('worker-media').remove([path]),
    };
    const result = await saveIntroduction(client, {
      newVoice,
      previousVoicePath: savedVoicePath,
      about: aboutChanged(about, savedAbout) ? about : null,
    });
    setSaving(false);
    if (!result.ok) {
      setError(t(result.key));
      return;
    }
    // What is on screen is now what is saved. The new recording keeps playing from the local file.
    setSavedAbout(about.trim());
    setAbout(about.trim());
    if (result.voicePath) setSavedVoicePath(result.voicePath);
    setJustSaved(true);
    showToast(t('introduction.saved'));
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Text style={styles.subtitle}>{t('introduction.subtitle')}</Text>
        <VoiceIntro
          playbackUri={playbackUri}
          hasRecording={hasRecording}
          onRecorded={(next) => {
            setRecorded(next);
            setJustSaved(false);
          }}
          onError={setVoiceMessage}
        />
        {voiceMessage ? <FieldError>{voiceMessage}</FieldError> : null}
        <AboutBox
          label={t('introduction.aboutLabel')}
          hint={t('introduction.aboutHint')}
          placeholder={t('introduction.aboutPlaceholder')}
          value={about}
          onChange={(text) => {
            setAbout(text);
            setJustSaved(false);
          }}
        />
        {error ? <FieldError>{error}</FieldError> : null}
        {justSaved && !dirty ? <Text style={styles.saved}>{t('introduction.saved')}</Text> : null}
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label={t('introduction.save')} onPress={() => void onSave()} loading={saving} disabled={!dirty} showArrow={false} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 12 },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  topTitle: { flex: 1, textAlign: 'center', fontFamily: fontFamily.extrabold, fontSize: 18, color: colors.ink },
  content: { paddingHorizontal: 20, paddingTop: 2, paddingBottom: 24, gap: 14 },
  subtitle: { fontFamily: fontFamily.regular, fontSize: 13, lineHeight: 19.5, color: colors.muted },
  saved: { fontFamily: fontFamily.extrabold, fontSize: 13, color: colors.green, textAlign: 'center' },
  footer: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 20 },
});
