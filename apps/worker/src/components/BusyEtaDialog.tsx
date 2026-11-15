import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { BUSY_ETA_QUICK, busyEtaLabel, parseBusyMinutes } from '@/features/quote/busy';
import { t } from '@/i18n';
import { colors, fontFamily } from '@/theme';

// The popup that asks a worker how long the job they are already doing will take (migration 0057). It opens on the job they
// just accepted. The customer sees the answer with the quote and decides whether to wait. The worker types the minutes or
// taps a quick choice. "Later" closes it; the screen keeps a button to open it again, and an unanswered quote is
// withdrawn after 30 minutes.
export function BusyEtaDialog({
  visible,
  currentJobTitle,
  sending,
  error,
  onSend,
  onLater,
}: {
  visible: boolean;
  currentJobTitle: string;
  sending: boolean;
  error: string | null;
  onSend: (minutes: number) => void;
  onLater: () => void;
}) {
  const [text, setText] = useState('');
  const minutes = parseBusyMinutes(text);
  const showRange = text.trim() !== '' && minutes === null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onLater}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.scrim}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <Text style={styles.title}>{t('quote.busyDialogTitle')}</Text>
          <Text style={styles.body}>{t('quote.busyDialogBody', { title: currentJobTitle || t('quote.busyYourJob') })}</Text>

          <Text style={styles.label}>{t('quote.busyMinutes')}</Text>
          <TextInput
            value={text}
            onChangeText={(v) => setText(v.replace(/[^0-9]/g, '').slice(0, 5))}
            keyboardType="number-pad"
            placeholder="20"
            placeholderTextColor={colors.muted}
            maxLength={5}
            style={styles.input}
            accessibilityLabel={t('quote.busyMinutes')}
          />
          <View style={styles.chips}>
            {BUSY_ETA_QUICK.map((m) => {
              const on = minutes === m;
              return (
                <Pressable key={m} accessibilityRole="button" accessibilityLabel={busyEtaLabel(m)} onPress={() => setText(String(m))} style={[styles.chip, on && styles.chipOn]}>
                  <Text style={[styles.chipText, on && { color: '#fff' }]}>{busyEtaLabel(m)}</Text>
                </Pressable>
              );
            })}
          </View>

          {showRange ? <Text style={styles.error}>{t('quote.busyRange')}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            accessibilityRole="button"
            disabled={minutes === null || sending}
            onPress={() => minutes !== null && onSend(minutes)}
            style={[styles.send, (minutes === null || sending) && { opacity: 0.45 }]}
          >
            <Text style={styles.sendText}>{sending ? t('common.loading') : t('quote.busySend')}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={onLater} style={styles.later}>
            <Text style={styles.laterText}>{t('quote.busyLater')}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', paddingHorizontal: 20 },
  sheet: { backgroundColor: '#fff', borderRadius: 20, padding: 18, gap: 10 },
  title: { fontFamily: fontFamily.extrabold, fontSize: 18, color: colors.greenDark },
  body: { fontFamily: fontFamily.semibold, fontSize: 13.5, lineHeight: 20, color: colors.muted },
  label: { fontFamily: fontFamily.bold, fontSize: 12, color: colors.muted, marginTop: 4 },
  input: { height: 52, borderRadius: 14, borderWidth: 1.5, borderColor: colors.mint, paddingHorizontal: 14, fontFamily: fontFamily.extrabold, fontSize: 22, color: colors.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { height: 38, paddingHorizontal: 14, borderRadius: 19, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: colors.green },
  chipText: { fontFamily: fontFamily.bold, fontSize: 13, color: colors.ink },
  error: { fontFamily: fontFamily.bold, fontSize: 12.5, color: '#B3261E' },
  send: { height: 50, borderRadius: 25, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  sendText: { fontFamily: fontFamily.extrabold, fontSize: 15, color: '#fff' },
  later: { height: 42, alignItems: 'center', justifyContent: 'center' },
  laterText: { fontFamily: fontFamily.bold, fontSize: 14, color: colors.muted },
});
