import { useEffect, useState } from 'react';
import { Linking, KeyboardAvoidingView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '@/components/AuthForm';
import { Card, NavRow, Notice, SectionTitle, SettingsTop, settingsStyles } from '@/components/SettingsParts';
import { dateText } from '@/features/myreports/rules';
import { useHelpline } from '@/features/profile/useHelpline';
import { BODY_MAX, SUBJECT_MAX, parseRequests, sendSupport, supportState, type MyRequest } from '@/features/settings/requests';
import { t } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { colors, fontFamily } from '@/theme';

// Settings > Contact DHA support: a real message to DHA staff. They answer in the admin portal; the answer shows here and
// arrives as a notice. (migration 0067: submit_support_request, my_requests, admin_request_reply)
export default function SupportScreen() {
  const helpline = useHelpline();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [list, setList] = useState<MyRequest[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void supabase.rpc('my_requests', { p_limit: 30 }).then(({ data, error: loadError }) => {
      if (!active) return;
      if (loadError) setFailed(true);
      else {
        setFailed(false);
        setList(parseRequests(data).filter((r) => r.kind === 'support'));
      }
    });
    return () => {
      active = false;
    };
  }, [attempt]);

  const state = supportState({ subject, body });

  async function onSend() {
    if (sending || !state.canSend) return;
    setSending(true);
    setError(null);
    setDone(false);
    const result = await sendSupport({ send: (s, b) => supabase.rpc('submit_support_request', { p_subject: s, p_body: b }) }, { subject, body });
    setSending(false);
    if (!result.ok) {
      setError(t(result.key));
      return;
    }
    setSubject('');
    setBody('');
    setDone(true);
    setAttempt((n) => n + 1);
  }

  return (
    <View style={settingsStyles.root}>
      <SettingsTop title={t('settings.supportScreen.title')} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={settingsStyles.content} keyboardShouldPersistTaps="handled">
          <Text style={settingsStyles.body}>{t('settings.supportScreen.intro')}</Text>
          {helpline ? (
            <Card>
              <NavRow title={t('settings.callSupport', { number: helpline })} onPress={() => void Linking.openURL(`tel:${helpline}`)} />
            </Card>
          ) : null}

          <SectionTitle>{t('settings.supportScreen.newTitle')}</SectionTitle>
          <Text style={settingsStyles.label}>{t('settings.supportScreen.subjectLabel')}</Text>
          <View style={styles.inputWrap}>
            <TextInput
              accessibilityLabel={t('settings.supportScreen.subjectLabel')}
              value={subject}
              onChangeText={(v) => {
                setSubject(v);
                setDone(false);
              }}
              placeholder={t('settings.supportScreen.subjectPlaceholder')}
              placeholderTextColor="#8A978F"
              maxLength={SUBJECT_MAX}
              editable={!sending}
              style={styles.input}
            />
          </View>
          <Text style={settingsStyles.label}>{t('settings.supportScreen.bodyLabel')}</Text>
          <TextInput
            accessibilityLabel={t('settings.supportScreen.bodyLabel')}
            value={body}
            onChangeText={(v) => {
              setBody(v.slice(0, BODY_MAX));
              setDone(false);
            }}
            placeholder={t('settings.supportScreen.bodyPlaceholder')}
            placeholderTextColor="#8A978F"
            multiline
            textAlignVertical="top"
            maxLength={BODY_MAX}
            editable={!sending}
            style={styles.area}
          />
          <Text style={styles.counter}>{t('settings.supportScreen.counter', { count: body.length, max: BODY_MAX })}</Text>
          {error ? <Notice kind="error">{error}</Notice> : null}
          {done ? <Notice kind="ok">{t('settings.supportScreen.sent')}</Notice> : null}
          <PrimaryButton label={t('settings.supportScreen.send')} onPress={() => void onSend()} loading={sending} disabled={!state.canSend} showArrow={false} />

          <SectionTitle>{t('settings.supportScreen.yourMessages')}</SectionTitle>
          {failed && list === null ? <Notice kind="error">{t('settings.loadFailedBody')}</Notice> : null}
          {list !== null && list.length === 0 ? <Text style={settingsStyles.body}>{t('settings.supportScreen.empty')}</Text> : null}
          {(list ?? []).map((r) => (
            <View key={r.id} style={styles.msg}>
              <View style={styles.msgTop}>
                <Text style={styles.msgTitle} numberOfLines={2}>
                  {r.subject}
                </Text>
                <View style={[styles.chip, { backgroundColor: r.status === 'open' ? colors.chip.wait.bg : colors.chip.done.bg }]}>
                  <Text style={[styles.chipText, { color: r.status === 'open' ? colors.chip.wait.fg : colors.chip.done.fg }]}>{t(r.status === 'open' ? 'settings.supportScreen.open' : 'settings.supportScreen.answered')}</Text>
                </View>
              </View>
              <Text style={styles.msgDate}>{dateText(r.createdAt)}</Text>
              <Text style={styles.msgBody}>{r.body}</Text>
              {r.reply ? (
                <View style={styles.reply}>
                  <Text style={styles.replyTitle}>{t('settings.supportScreen.staffAnswer')}</Text>
                  <Text style={styles.replyBody}>{r.reply}</Text>
                </View>
              ) : null}
            </View>
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  inputWrap: { height: 52, borderWidth: 1.5, borderColor: colors.signIn.fieldBorder, borderRadius: 16, backgroundColor: '#fff', paddingHorizontal: 14, justifyContent: 'center' },
  input: { fontFamily: fontFamily.semibold, fontSize: 15, color: colors.ink, padding: 0, height: 48 },
  area: { minHeight: 120, borderWidth: 1.5, borderColor: colors.signIn.fieldBorder, borderRadius: 16, backgroundColor: '#fff', padding: 14, fontFamily: fontFamily.semibold, fontSize: 15, color: colors.ink },
  counter: { fontFamily: fontFamily.semibold, fontSize: 12, color: colors.muted, textAlign: 'right' },
  msg: { backgroundColor: '#fff', borderRadius: 18, padding: 14, gap: 6 },
  msgTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  msgTitle: { flex: 1, fontFamily: fontFamily.extrabold, fontSize: 15, color: colors.ink },
  msgDate: { fontFamily: fontFamily.semibold, fontSize: 12, color: colors.muted },
  msgBody: { fontFamily: fontFamily.regular, fontSize: 14, lineHeight: 20, color: colors.ink },
  chip: { borderRadius: 12, paddingVertical: 4, paddingHorizontal: 10 },
  chipText: { fontFamily: fontFamily.extrabold, fontSize: 12 },
  reply: { backgroundColor: colors.mint, borderRadius: 12, padding: 10, gap: 2, marginTop: 4 },
  replyTitle: { fontFamily: fontFamily.extrabold, fontSize: 12, color: colors.greenDark },
  replyBody: { fontFamily: fontFamily.semibold, fontSize: 14, lineHeight: 20, color: colors.greenDark },
});
