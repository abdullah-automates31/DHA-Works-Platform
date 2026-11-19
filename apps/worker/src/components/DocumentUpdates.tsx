import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, Notice, SectionTitle, settingsStyles } from '@/components/SettingsParts';
import { imageKindFor, type DocType } from '@/features/documents/files';
import { pickImage, pickPdf, type PickResult } from '@/features/documents/pick';
import { dateText } from '@/features/myreports/rules';
import { parseRequests, sendDocumentUpdate, type MyRequest } from '@/features/settings/requests';
import { t } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { colors, fontFamily } from '@/theme';

const TYPES: { type: DocType; label: string }[] = [
  { type: 'cnic_front', label: 'settings.verificationScreen.updateCnicFront' },
  { type: 'cnic_back', label: 'settings.verificationScreen.updateCnicBack' },
  { type: 'police_cert', label: 'settings.verificationScreen.updatePolice' },
  { type: 'profile_photo', label: 'settings.verificationScreen.updatePhoto' },
];

const client = {
  upload: (bucket: string, path: string, bytes: ArrayBuffer, contentType: string) => supabase.storage.from(bucket).upload(path, bytes, { contentType, upsert: false }),
  submit: (type: DocType, path: string) => supabase.rpc('submit_document_update', { p_type: type, p_path: path }),
};

// An approved worker sends a replacement CNIC, certificate or photo. It waits for DHA staff (admin portal > Requests):
// approving swaps the verification file, rejecting keeps the old one and tells the worker why. (migration 0067)
export function DocumentUpdates() {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const [busy, setBusy] = useState<DocType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [list, setList] = useState<MyRequest[]>([]);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void supabase.rpc('my_requests', { p_limit: 30 }).then(({ data }) => {
      if (active && data) setList(parseRequests(data).filter((r) => r.kind === 'document'));
    });
    return () => {
      active = false;
    };
  }, [attempt]);

  async function add(type: DocType, source: 'camera' | 'library' | 'pdf') {
    if (busy) return;
    setError(null);
    setDone(false);
    setBusy(type);
    const picked: PickResult = source === 'pdf' ? await pickPdf() : await pickImage(source, { square: type === 'profile_photo', kind: imageKindFor(type) });
    if (picked.status === 'denied') setError(t('settings.verificationScreen.permission'));
    else if (picked.status === 'error') setError(t('settings.verificationScreen.pickFailed'));
    else if (picked.status === 'ok') {
      const result = await sendDocumentUpdate(client, { userId, type, mime: picked.file.mime, bytes: picked.file.bytes });
      if (result.ok) {
        setDone(true);
        setAttempt((n) => n + 1);
      } else setError(t(result.key));
    }
    setBusy(null);
  }

  function choose(type: DocType, label: string) {
    const cancel = { text: t('documents.menu.cancel'), style: 'cancel' as const };
    const photo = [
      { text: t('documents.menu.takePhoto'), onPress: () => void add(type, 'camera') },
      { text: t('documents.menu.chooseLibrary'), onPress: () => void add(type, 'library') },
    ];
    Alert.alert(label, undefined, type === 'police_cert' ? [...photo, { text: t('documents.menu.choosePdf'), onPress: () => void add(type, 'pdf') }, cancel] : [...photo, cancel]);
  }

  const label = (type: string | null) => {
    const hit = TYPES.find((x) => x.type === type);
    return hit ? t(hit.label as never) : '';
  };

  return (
    <>
      <SectionTitle>{t('settings.verificationScreen.updateTitle')}</SectionTitle>
      <Text style={settingsStyles.body}>{t('settings.verificationScreen.updateBody')}</Text>
      <Card>
        {TYPES.map((x, index) => (
          <Pressable
            key={x.type}
            accessibilityRole="button"
            accessibilityState={{ busy: busy === x.type, disabled: busy !== null }}
            disabled={busy !== null}
            onPress={() => choose(x.type, t(x.label as never))}
            style={[styles.row, index < TYPES.length - 1 && styles.divider]}
          >
            <Text style={styles.rowTitle}>{t(x.label as never)}</Text>
            <View style={{ flex: 1 }} />
            <Text style={styles.rowAction}>{busy === x.type ? t('settings.verificationScreen.updateSending') : t('settings.verificationScreen.updateSend')}</Text>
          </Pressable>
        ))}
      </Card>
      {error ? <Notice kind="error">{error}</Notice> : null}
      {done ? <Notice kind="ok">{t('settings.verificationScreen.updateSent')}</Notice> : null}

      {list.length > 0 ? (
        <>
          <SectionTitle>{t('settings.verificationScreen.updatesTitle')}</SectionTitle>
          {list.map((r) => {
            const tone = r.status === 'open' ? colors.chip.wait : r.status === 'approved' ? colors.chip.done : colors.chip.declined;
            return (
              <View key={r.id} style={styles.item}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.rowTitle}>{label(r.docType)}</Text>
                  <Text style={styles.date}>{dateText(r.createdAt)}</Text>
                  {r.status === 'rejected' && r.reply ? <Text style={styles.reason}>{t('settings.verificationScreen.updateReason', { reason: r.reply })}</Text> : null}
                </View>
                <View style={[styles.chip, { backgroundColor: tone.bg }]}>
                  <Text style={[styles.chipText, { color: tone.fg }]}>{t(r.status === 'open' ? 'settings.verificationScreen.updateWaiting' : r.status === 'approved' ? 'settings.verificationScreen.updateApproved' : 'settings.verificationScreen.updateRejected')}</Text>
                </View>
              </View>
            );
          })}
        </>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingVertical: 10 },
  divider: { borderBottomWidth: 1.5, borderBottomColor: '#E2ECE6' },
  rowTitle: { fontFamily: fontFamily.extrabold, fontSize: 15, color: colors.ink },
  rowAction: { fontFamily: fontFamily.extrabold, fontSize: 13, color: colors.green },
  item: { backgroundColor: '#fff', borderRadius: 18, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  date: { fontFamily: fontFamily.semibold, fontSize: 12, color: colors.muted },
  reason: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 18, color: colors.chip.declined.fg, marginTop: 2 },
  chip: { borderRadius: 12, paddingVertical: 5, paddingHorizontal: 10 },
  chipText: { fontFamily: fontFamily.extrabold, fontSize: 12 },
});
