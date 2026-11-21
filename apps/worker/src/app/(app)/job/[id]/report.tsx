import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/AuthForm';
import { DetailSkeleton, SkeletonGroup } from '@/components/Skeleton';
import { StatusChip } from '@/components/MyJobParts';
import { ChevronLeftIcon, PhoneIcon, PlusIcon } from '@/components/icons';
import { FieldError, Pill } from '@/components/onboarding';
import { pickImage } from '@/features/documents/pick';
import { statusHref } from '@/features/job/routes';
import { canReport, jobKind } from '@/features/myjobs/rules';
import { useJobStatus } from '@/features/myjobs/useJobStatus';
import { useHelpline } from '@/features/profile/useHelpline';
import {
  DETAILS_MAX,
  MAX_PHOTOS,
  REPORT_CHOICES,
  checkReport,
  fileReport,
  initialChoice,
  type Photo,
  type ReportChoiceId,
} from '@/features/report/rules';
import { t } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { colors, fontFamily } from '@/theme';

// W14 Report a problem (worker/screens/w-report.dc.html), including "I felt unsafe" (the red button on W12 opens it
// with that reason chosen). DHA staff read the report; the worker can add photos. The helpline strip shows only
// when DHA has approved the number (app_settings.helpline_enabled).
export default function ReportProblemScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { id, kind: kindParam } = useLocalSearchParams<{ id: string; kind?: string }>();
  const { state, reload } = useJobStatus(id ?? '');
  const helpline = useHelpline();
  const [choice, setChoice] = useState<ReportChoiceId | null>(initialChoice(kindParam));
  const [details, setDetails] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userId = session?.user.id ?? '';

  const goBack = () => (router.canGoBack() ? router.back() : router.replace(statusHref(id ?? '')));
  const ready = state.status === 'ready' ? state : null;
  const job = ready?.job ?? null;
  const kind = job ? jobKind(job) : null;
  const allowed = kind !== null && canReport(kind);
  const failed = state.status === 'error';
  const checked = checkReport(choice, details);

  async function addPhoto(source: 'camera' | 'library') {
    const picked = await pickImage(source, { kind: 'evidence' });
    if (picked.status === 'ok') setPhotos((current) => [...current, { bytes: picked.file.bytes, mime: picked.file.mime }].slice(0, MAX_PHOTOS));
    else if (picked.status === 'denied') setError(t('documents.errors.permission'));
    else if (picked.status === 'error') setError(t('documents.errors.pickFailed'));
  }

  function onAddPhoto() {
    if (photos.length >= MAX_PHOTOS) return;
    setError(null);
    Alert.alert(t('report.photo'), undefined, [
      { text: t('documents.menu.takePhoto'), onPress: () => void addPhoto('camera') },
      { text: t('documents.menu.chooseLibrary'), onPress: () => void addPhoto('library') },
      { text: t('documents.menu.cancel'), style: 'cancel' },
    ]);
  }

  async function submit() {
    if (busy || !job || !choice) {
      setTried(true);
      return;
    }
    setTried(true);
    if (!checked.ok) return;
    setError(null);
    setBusy(true);
    const result = await fileReport(
      {
        uploadPhoto: async (path, bytes, mime) => {
          const { error: uploadError } = await supabase.storage.from('report-media').upload(path, bytes, { contentType: mime, upsert: false });
          return { error: uploadError };
        },
        file: (jobId, reportKind, text, paths) => supabase.rpc('file_report', { p_job_id: jobId, p_kind: reportKind, p_text: text, p_photo_paths: paths }),
      },
      { userId, jobId: job.id, choice, details, photos },
    );
    setBusy(false);
    if (!result.ok) {
      setError(t(result.key));
      void reload();
      return;
    }
    Alert.alert(t('report.sentTitle'), t('report.sentBody'), [{ text: t('common.ok'), onPress: () => router.dismissTo(statusHref(job.id)) }]);
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior="padding">
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={goBack} style={styles.back}>
          <ChevronLeftIcon size={22} color={colors.greenDark} />
        </Pressable>
        <Text style={styles.topTitle}>{t('report.title')}</Text>
        <View style={{ width: 44 }} />
      </View>

      {state.status === 'loading' ? (
        <SkeletonGroup>
          <DetailSkeleton />
        </SkeletonGroup>
      ) : null}

      {state.status === 'unavailable' || failed ? (
        <Message title={failed ? t('job.loadFailedTitle') : t('job.unavailableTitle')} body={failed ? t('job.loadFailedBody') : t('job.unavailableBody')}>
          <PrimaryButton label={failed ? t('common.retry') : t('myjobs.backToMyJobs')} onPress={() => (failed ? void reload() : router.replace('/my-jobs'))} showArrow={false} />
        </Message>
      ) : null}

      {ready && job && !allowed ? (
        <Message title={t('report.notAllowedTitle')} body={t('report.notAllowedBody')}>
          <PrimaryButton label={t('cash.backToJob')} onPress={() => router.replace(statusHref(job.id))} showArrow={false} />
        </Message>
      ) : null}

      {ready && job && kind && allowed ? (
        <>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets>
            {helpline ? (
              <View style={styles.helpline}>
                <Text style={styles.helplineText}>{t('report.helplineLead')}</Text>
                <Pressable accessibilityRole="button" onPress={() => void Linking.openURL(`tel:${helpline}`)} style={styles.helplineBtn}>
                  <PhoneIcon size={18} color="#fff" />
                  <Text style={styles.helplineBtnText}>{t('report.callHelpline', { number: helpline })}</Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.note}>
              <Text style={styles.noteText}>{t('report.note')}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.label}>{t('report.aboutJob')}</Text>
              <Text style={styles.jobTitle}>
                {job.title} · {job.code}
              </Text>
              <View style={{ alignSelf: 'flex-start' }}>
                <StatusChip kind={kind} />
              </View>
            </View>

            <Text style={styles.label}>{t('report.what')}</Text>
            <View style={styles.pills}>
              {REPORT_CHOICES.map((c) => (
                <Pill key={c.id} label={c.label} on={choice === c.id} onPress={() => setChoice(choice === c.id ? null : c.id)} />
              ))}
            </View>
            {tried && !checked.ok && checked.missing === 'choice' ? <FieldError>{t('report.errors.choice')}</FieldError> : null}

            <Text style={styles.label}>{t('report.tellMore')}</Text>
            <TextInput
              accessibilityLabel={t('report.tellMore')}
              value={details}
              onChangeText={(text) => setDetails(text.slice(0, DETAILS_MAX))}
              placeholder={t('report.placeholder')}
              placeholderTextColor="#8A978F"
              multiline
              textAlignVertical="top"
              style={[styles.input, tried && !checked.ok && checked.missing === 'details' && { borderColor: colors.chip.declined.fg }]}
            />
            {tried && !checked.ok && checked.missing === 'details' ? <FieldError>{t('report.errors.details')}</FieldError> : null}

            <Text style={styles.label}>{t('report.photo')}</Text>
            <View style={styles.pills}>
              {photos.map((_, index) => (
                <Pressable key={index} accessibilityRole="button" accessibilityLabel={t('report.removePhoto', { n: String(index + 1) })} onPress={() => setPhotos((current) => current.filter((__, i) => i !== index))} style={styles.photoChip}>
                  <Text style={styles.photoChipText}>{t('report.photoN', { n: String(index + 1) })} ✕</Text>
                </Pressable>
              ))}
              {photos.length < MAX_PHOTOS ? (
                <Pressable accessibilityRole="button" accessibilityLabel={t('report.addPhoto')} onPress={onAddPhoto} style={styles.addPhoto}>
                  <PlusIcon size={20} color={colors.greenDark} />
                  <Text style={styles.addPhotoText}>{t('report.addPhoto')}</Text>
                </Pressable>
              ) : null}
            </View>

            {error ? <FieldError>{error}</FieldError> : null}
            <PrimaryButton label={t('report.send')} onPress={() => void submit()} loading={busy} showArrow={false} />
          </ScrollView>
        </>
      ) : null}
    </KeyboardAvoidingView>
  );
}

function Message({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <View style={styles.message}>
      <Text style={styles.messageTitle}>{title}</Text>
      <Text style={styles.messageBody}>{body}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 12 },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  topTitle: { flex: 1, textAlign: 'center', fontFamily: fontFamily.extrabold, fontSize: 18, color: colors.ink },
  content: { paddingHorizontal: 20, paddingTop: 2, paddingBottom: 40, gap: 12 },
  helpline: { backgroundColor: colors.chip.declined.bg, borderRadius: 18, padding: 14, gap: 10 },
  helplineText: { fontFamily: fontFamily.bold, fontSize: 13, lineHeight: 19, color: colors.chip.declined.fg },
  helplineBtn: { height: 44, borderRadius: 12, backgroundColor: colors.chip.declined.fg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  helplineBtnText: { fontFamily: fontFamily.extrabold, fontSize: 14, color: '#fff' },
  note: { backgroundColor: colors.mint, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14 },
  noteText: { fontFamily: fontFamily.semibold, fontSize: 12, lineHeight: 17, color: colors.greenDark },
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 16, gap: 8 },
  label: { fontFamily: fontFamily.bold, fontSize: 12, color: colors.muted },
  jobTitle: { fontFamily: fontFamily.extrabold, fontSize: 15, color: colors.ink },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: { minHeight: 110, borderRadius: 14, backgroundColor: '#fff', borderWidth: 1.5, borderColor: 'transparent', padding: 14, fontFamily: fontFamily.semibold, fontSize: 15, color: colors.ink },
  addPhoto: { height: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: colors.mint, flexDirection: 'row', alignItems: 'center', gap: 6 },
  addPhotoText: { fontFamily: fontFamily.bold, fontSize: 13, color: colors.greenDark },
  photoChip: { height: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  photoChipText: { fontFamily: fontFamily.bold, fontSize: 13, color: colors.ink },
  message: { margin: 20, backgroundColor: colors.mint, borderRadius: 18, padding: 16, gap: 10 },
  messageTitle: { fontFamily: fontFamily.extrabold, fontSize: 16, color: colors.greenDark },
  messageBody: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 19, color: colors.muted },
});
