import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { BUSY_CHIPS, busyEtaLabel, chipLabel, finishTimeLabel, parseBusyMinutes } from '@/features/quote/busy';
import { t } from '@/i18n';
import { colors, fontFamily } from '@/theme';

// "Current job time" (design W12d), shown on the Accept job form when the worker is in the middle of another job. The
// worker says how much longer the current job will take; the customer sees it with the quote and can wait or choose
// another worker. `text` is the typed minutes (digits); the parent turns it into the request.
export function BusyTimeSection({ jobTitle, text, onChange, invalid }: { jobTitle: string; text: string; onChange: (text: string) => void; invalid: boolean }) {
  const minutes = parseBusyMinutes(text);
  const now = useMemo(() => new Date(), [text]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <Text style={styles.small}>{t('quote.busyTitle')}</Text>
        <Text style={styles.job}>{jobTitle || t('quote.busyYourJob')}</Text>
      </View>

      <Text style={styles.question}>{t('quote.busyQuestion')}</Text>
      <Text style={styles.honest}>{t('quote.busyHonest')}</Text>
      <View style={styles.chips}>
        {BUSY_CHIPS.map((m) => {
          const on = minutes === m;
          return (
            <Pressable key={m} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => onChange(String(m))} style={[styles.chip, on && styles.chipOn]}>
              <Text style={[styles.chipText, on && { color: '#fff' }]}>{chipLabel(m)}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.small}>{t('quote.busyOrType')}</Text>
      <TextInput
        value={text}
        onChangeText={(v) => onChange(v.replace(/[^0-9]/g, '').slice(0, 5))}
        keyboardType="number-pad"
        placeholder="60"
        placeholderTextColor={colors.muted}
        maxLength={5}
        style={[styles.input, invalid && styles.inputBad]}
        accessibilityLabel={t('quote.busyOrType')}
      />
      {invalid ? <Text style={styles.error}>{t('quote.errors.busyEta')}</Text> : null}

      {minutes !== null ? (
        <View style={styles.card}>
          <Text style={styles.small}>{t('quote.busyCustomerTitle')}</Text>
          <Text style={styles.body}>{t('quote.busyCustomerBody', { time: busyEtaLabel(minutes), at: finishTimeLabel(minutes, now) })}</Text>
        </View>
      ) : null}

      <View style={styles.note}>
        <Text style={styles.noteText}>{t('quote.busyCannotStart')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  card: { backgroundColor: '#fff', borderRadius: 18, padding: 14, gap: 4 },
  small: { fontFamily: fontFamily.bold, fontSize: 12, color: colors.muted },
  job: { fontFamily: fontFamily.extrabold, fontSize: 16, color: colors.ink },
  question: { fontFamily: fontFamily.extrabold, fontSize: 17, color: colors.ink, marginTop: 4 },
  honest: { fontFamily: fontFamily.semibold, fontSize: 12, color: colors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { height: 40, paddingHorizontal: 16, borderRadius: 20, backgroundColor: '#fff', justifyContent: 'center' },
  chipOn: { backgroundColor: colors.green },
  chipText: { fontFamily: fontFamily.bold, fontSize: 13, color: colors.ink },
  input: { height: 48, borderRadius: 14, backgroundColor: '#fff', paddingHorizontal: 14, fontFamily: fontFamily.bold, fontSize: 16, color: colors.ink },
  inputBad: { borderWidth: 1.5, borderColor: colors.chip.declined.fg },
  error: { fontFamily: fontFamily.bold, fontSize: 12, color: colors.chip.declined.fg },
  body: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 19, color: colors.ink },
  note: { backgroundColor: colors.mint, borderRadius: 14, padding: 12 },
  noteText: { fontFamily: fontFamily.semibold, fontSize: 12, lineHeight: 17, color: colors.greenDark },
});
