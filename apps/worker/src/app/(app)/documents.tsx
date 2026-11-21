import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { TextLink } from '@/components/AuthForm';
import { ProfilePhotoCard, UploadBox } from '@/components/documents';
import { BottomBar, FieldError, OnboardingTop, Stepper } from '@/components/onboarding';
import { storageClient } from '@/features/documents/client';
import { imageKindFor, initials, missingItems, type DocType } from '@/features/documents/files';
import { pickImage, pickPdf, type PickResult } from '@/features/documents/pick';
import { uploadDocument } from '@/features/documents/upload';
import { useDocuments } from '@/features/documents/useDocuments';
import { t } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { useMyProfile } from '@/lib/profile';
import { colors, fontFamily } from '@/theme';

type Source = 'camera' | 'library' | 'pdf';

// W03 Your documents. Files are compressed on the phone, sent to private storage under the worker's own folder,
// then recorded with add_verification_document. Identity files can never be read back by the app.
export default function DocumentsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { state, refresh: refreshProfile } = useMyProfile();
  const { data, refresh } = useDocuments();
  const [busy, setBusy] = useState<DocType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hints, setHints] = useState<string[]>([]);

  const profile = state.status === 'ready' ? state.profile : null;
  const docs = data.status === 'ready' ? data.docs : null;
  const userId = session?.user.id ?? '';

  async function add(type: DocType, source: Source) {
    if (busy) return;
    setError(null);
    setHints([]);
    setBusy(type);
    let picked: PickResult;
    if (source === 'pdf') picked = await pickPdf();
    else picked = await pickImage(source, { square: type === 'profile_photo', kind: imageKindFor(type) });

    if (picked.status === 'denied') setError(t('documents.errors.permission'));
    else if (picked.status === 'error') setError(t('documents.errors.pickFailed'));
    else if (picked.status === 'ok') {
      const result = await uploadDocument(storageClient, {
        userId,
        type,
        mime: picked.file.mime,
        bytes: picked.file.bytes,
      });
      if (result.ok) {
        await refresh();
        // The profile holds the picture path used by the home and profile screens.
        if (type === 'profile_photo') await refreshProfile();
      }
      else setError(t(result.key));
    }
    setBusy(null);
  }

  function choose(type: DocType) {
    const cancel = { text: t('documents.menu.cancel'), style: 'cancel' as const };
    const photo = [
      { text: t('documents.menu.takePhoto'), onPress: () => void add(type, 'camera') },
      { text: t('documents.menu.chooseLibrary'), onPress: () => void add(type, 'library') },
    ];
    const buttons = type === 'police_cert' ? [...photo, { text: t('documents.menu.choosePdf'), onPress: () => void add(type, 'pdf') }, cancel] : [...photo, cancel];
    Alert.alert(titleFor(type), undefined, buttons);
  }

  function onNext() {
    if (!docs) return;
    const missing = missingItems(docs);
    if (missing.length > 0) {
      setHints(missing.map((m) => t(`documents.missing.${m}`)));
      return;
    }
    router.push('/work');
  }

  return (
    <View style={styles.root}>
      <OnboardingTop step={2} onBack={() => router.replace('/about')} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={styles.content}>
          <Stepper current={2} />
          <View style={styles.heading}>
            <Text style={styles.title}>{t('documents.title')}</Text>
            <Text style={styles.subtitle}>{t('documents.subtitle')}</Text>
          </View>

          <View style={styles.fld}>
            <Text style={styles.label}>{t('documents.cnicLabel')}</Text>
            <View style={styles.row}>
              <UploadBox
                flex
                done={docs?.cnicFront ?? false}
                busy={busy === 'cnic_front'}
                label={docs?.cnicFront ? t('documents.frontAdded') : t('documents.addFront')}
                onPress={() => choose('cnic_front')}
              />
              <UploadBox
                flex
                done={docs?.cnicBack ?? false}
                busy={busy === 'cnic_back'}
                label={docs?.cnicBack ? t('documents.backAdded') : t('documents.addBack')}
                onPress={() => choose('cnic_back')}
              />
            </View>
          </View>

          <View style={styles.fld}>
            <Text style={styles.label}>{t('documents.policeLabel')}</Text>
            <UploadBox
              done={docs?.policeCert ?? false}
              busy={busy === 'police_cert'}
              label={docs?.policeCert ? t('documents.certificateAdded') : t('documents.addCertificate')}
              onPress={() => choose('police_cert')}
            />
            <Text style={styles.help}>{t('documents.policeHelp')}</Text>
            <TextLink
              label={docs && docs.references >= 2 ? t('documents.referencesAdded') : t('documents.referencesLink')}
              onPress={() => router.push('/references')}
            />
          </View>

          <ProfilePhotoCard
            title={t('documents.profilePicture')}
            help={t('documents.profileHelp')}
            buttonLabel={docs?.profilePhoto ? t('documents.change') : t('documents.add')}
            photoUrl={data.status === 'ready' ? data.photoUrl : null}
            initials={initials(profile?.full_name)}
            busy={busy === 'profile_photo'}
            onPress={() => choose('profile_photo')}
          />

          {data.status === 'error' ? <FieldError>{t('documents.errors.network')}</FieldError> : null}
          {error ? <FieldError>{error}</FieldError> : null}
          {hints.map((h) => (
            <FieldError key={h}>{h}</FieldError>
          ))}
        </ScrollView>
        <BottomBar label={t('documents.next')} onPress={onNext} disabled={data.status !== 'ready' || busy !== null} />
      </KeyboardAvoidingView>
    </View>
  );
}

function titleFor(type: DocType): string {
  switch (type) {
    case 'cnic_front':
      return `${t('documents.cnicLabel')}: ${t('documents.addFront')}`;
    case 'cnic_back':
      return `${t('documents.cnicLabel')}: ${t('documents.addBack')}`;
    case 'police_cert':
      return t('documents.policeLabel');
    case 'profile_photo':
      return t('documents.profilePicture');
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 24, gap: 14 },
  heading: { gap: 4 },
  title: { fontFamily: fontFamily.extrabold, fontSize: 26, lineHeight: 30, letterSpacing: -0.26, color: colors.ink },
  subtitle: { fontFamily: fontFamily.regular, fontSize: 13, lineHeight: 19.5, color: colors.muted },
  fld: { gap: 6 },
  label: { fontFamily: fontFamily.bold, fontSize: 12, color: colors.muted },
  row: { flexDirection: 'row', gap: 10 },
  help: { fontFamily: fontFamily.medium, fontSize: 12, lineHeight: 17, color: colors.muted },
});
