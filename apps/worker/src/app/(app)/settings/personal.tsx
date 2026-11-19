import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ProfilePhoto } from '@/components/ProfilePhoto';
import { Card, InfoRow, NavRow, Notice, SaveBar, SectionTitle, SettingsTop, settingsStyles } from '@/components/SettingsParts';
import { pickImage, type PickedFile } from '@/features/documents/pick';
import { dateText } from '@/features/myreports/rules';
import { normalizeName } from '@/features/profile/validation';
import { saveProfilePhoto, toDataUri } from '@/features/settings/photo';
import { displayPhone, personalState } from '@/features/settings/rules';
import { useUnsavedGuard } from '@/features/settings/useUnsavedGuard';
import { t } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { useMyProfile } from '@/lib/profile';
import { supabase } from '@/lib/supabase';
import { colors, fontFamily } from '@/theme';

// Settings > Personal information. The name changes through change_my_name (audited, so staff can compare it with the CNIC);
// the sign-in phone changes on its own screen after a code sent to the new number. The profile picture can be changed at
// any time: it only changes avatar_path, the photo staff approved stays in verification_documents.
export default function PersonalScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { state, refresh } = useMyProfile();
  const profile = state.status === 'ready' ? state.profile : null;
  const savedName = profile?.full_name ?? '';

  const [name, setName] = useState(savedName);
  const [photo, setPhoto] = useState<PickedFile | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [since, setSince] = useState<string | null>(null);

  const userId = session?.user.id ?? '';
  const view = personalState({ name: savedName }, { name, photoChosen: photo !== null });
  useUnsavedGuard(view.dirty && !saving);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void supabase
      .from('profiles')
      .select('created_at')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setSince(data?.created_at ?? null);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  async function choosePhoto(source: 'camera' | 'library') {
    setError(null);
    setDone(false);
    const picked = await pickImage(source, { square: true, kind: 'avatar' });
    if (picked.status === 'ok') setPhoto(picked.file);
    else if (picked.status === 'denied') setError(t('settings.errors.photoPermission'));
    else if (picked.status === 'error') setError(t('settings.errors.photoPick'));
  }

  function photoMenu() {
    Alert.alert(t('settings.personalScreen.changePhoto'), undefined, [
      { text: t('settings.personalScreen.takePhoto'), onPress: () => void choosePhoto('camera') },
      { text: t('settings.personalScreen.chooseLibrary'), onPress: () => void choosePhoto('library') },
      { text: t('settings.cancel'), style: 'cancel' },
    ]);
  }

  async function onSave() {
    if (saving || !view.canSave) return;
    setSaving(true);
    setError(null);
    setDone(false);
    try {
      if (photo) {
        const result = await saveProfilePhoto(
          {
            upload: (path, bytes, contentType) => supabase.storage.from('worker-media').upload(path, bytes, { contentType, upsert: false }),
            setAvatar: (path) => supabase.rpc('update_my_profile', { p_avatar_path: path }),
          },
          { userId, mime: photo.mime, bytes: photo.bytes },
        );
        if (!result.ok) {
          setError(t(result.key));
          return;
        }
        setPhoto(null);
      }
      if (normalizeName(name) !== normalizeName(savedName)) {
        const { error: rpcError } = await supabase.rpc('change_my_name', { p_name: normalizeName(name) });
        if (rpcError) {
          setError(t('settings.errors.generic'));
          return;
        }
      }
      await refresh();
      setDone(true);
    } catch {
      setError(t('settings.errors.network'));
    } finally {
      setSaving(false);
    }
  }

  function onCancel() {
    // The unsaved-changes guard asks first when something changed.
    router.back();
  }

  return (
    <View style={settingsStyles.root}>
      <SettingsTop title={t('settings.personal')} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={settingsStyles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.photoBlock}>
            {photo ? <Image source={{ uri: toDataUri(photo.bytes, photo.mime) }} style={styles.preview} contentFit="cover" accessibilityLabel={t('settings.personalScreen.photo')} /> : <ProfilePhoto size={96} />}
            <Pressable accessibilityRole="button" onPress={photoMenu} disabled={saving} style={styles.changeBtn}>
              <Text style={styles.changeText}>{t('settings.personalScreen.changePhoto')}</Text>
            </Pressable>
            <Text style={styles.photoNote}>{photo ? t('settings.personalScreen.newPhoto') : t('settings.personalScreen.photoRule')}</Text>
          </View>

          <SectionTitle>{t('settings.personalScreen.name')}</SectionTitle>
          <View style={[styles.inputWrap, view.nameError && styles.inputError]}>
            <TextInput
              accessibilityLabel={t('settings.personalScreen.name')}
              value={name}
              onChangeText={(v) => {
                setName(v);
                setDone(false);
              }}
              editable={!saving}
              maxLength={100}
              autoCapitalize="words"
              autoComplete="name"
              textContentType="name"
              returnKeyType="done"
              style={styles.input}
            />
          </View>
          {view.nameError ? <Notice kind="error">{t('settings.errors.name')}</Notice> : null}
          <Text style={settingsStyles.body}>{t('settings.personalScreen.nameNote')}</Text>

          <SectionTitle>{t('settings.personalScreen.phone')}</SectionTitle>
          <Card>
            <InfoRow title={t('settings.personalScreen.phone')} value={displayPhone(profile?.phone)} divider />
            <NavRow title={t('settings.personalScreen.changePhone')} onPress={() => router.push('/settings/change-phone')} divider />
            <InfoRow title={t('settings.personalScreen.since')} value={since ? dateText(since) : t('settings.personalScreen.sinceMissing')} />
          </Card>
          <Text style={settingsStyles.body}>{t('settings.personalScreen.phoneNote')}</Text>

          {error ? <Notice kind="error">{error}</Notice> : null}
          {done ? <Notice kind="ok">{t('settings.saved')}</Notice> : null}
        </ScrollView>
        <SaveBar canSave={view.canSave} saving={saving} onSave={() => void onSave()} onCancel={onCancel} />
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  photoBlock: { alignItems: 'center', gap: 8, paddingVertical: 8 },
  preview: { width: 96, height: 96, borderRadius: 48 },
  changeBtn: { minHeight: 44, paddingHorizontal: 18, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  changeText: { fontFamily: fontFamily.extrabold, fontSize: 14, color: colors.greenDark },
  photoNote: { fontFamily: fontFamily.semibold, fontSize: 12, lineHeight: 17, color: colors.muted, textAlign: 'center', paddingHorizontal: 12 },
  inputWrap: { height: 52, borderWidth: 1.5, borderColor: colors.signIn.fieldBorder, borderRadius: 16, backgroundColor: '#fff', paddingHorizontal: 14, justifyContent: 'center' },
  inputError: { borderColor: colors.chip.declined.fg },
  input: { fontFamily: fontFamily.semibold, fontSize: 15, color: colors.ink, padding: 0, height: 48 },
});
