import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { clockLabel, dayOptions, fromSlots, toSlots, twoHoursOn, type VisitChoice } from '@/features/quote/visit';
import { t } from '@/i18n';
import { colors, fontFamily } from '@/theme';

// The worker's arrival window (0044): a row of day chips, then "From" and "To" as rows of half-hour chips. Plain
// JavaScript, so it ships without a new native build. Choosing a later "From" keeps "To" valid by moving it along.
export function ArrivalPicker({ value, onChange, now = new Date() }: { value: VisitChoice; onChange: (next: VisitChoice) => void; now?: Date }) {
  const days = dayOptions(now);
  const starts = fromSlots(value.day, now);
  const ends = toSlots(value.from);

  const pickDay = (day: string) => {
    const options = fromSlots(day, now);
    const from = options.includes(value.from) ? value.from : options[0] ?? value.from;
    onChange(withEnd({ day, from, to: value.to }));
  };
  const pickFrom = (from: string) => onChange(withEnd({ ...value, from }));

  return (
    <View style={styles.box}>
      <Text style={styles.title}>{t('quote.visitTitle')}</Text>
      <Row label={t('quote.visitDay')} options={days.map((d) => ({ value: d.value, label: d.label }))} selected={value.day} onPick={pickDay} />
      <Row label={t('quote.visitFrom')} options={starts.map((s) => ({ value: s, label: clockLabel(s) }))} selected={value.from} onPick={pickFrom} />
      <Row label={t('quote.visitTo')} options={ends.map((s) => ({ value: s, label: clockLabel(s) }))} selected={value.to} onPick={(to) => onChange({ ...value, to })} />
    </View>
  );
}

/** Keeps the end after the start: an end that no longer fits becomes two hours later (or the latest allowed). */
function withEnd(choice: VisitChoice): VisitChoice {
  return toSlots(choice.from).includes(choice.to) ? choice : { ...choice, to: twoHoursOn(choice.from) };
}

function Row({ label, options, selected, onPick }: { label: string; options: { value: string; label: string }[]; selected: string; onPick: (v: string) => void }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
        {options.map((o) => {
          const on = o.value === selected;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${label} ${o.label}`}
              onPress={() => onPick(o.value)}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipText, on && { color: '#fff' }]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.mint, borderRadius: 14, padding: 12, gap: 10 },
  title: { fontFamily: fontFamily.extrabold, fontSize: 14, color: colors.greenDark },
  label: { fontFamily: fontFamily.bold, fontSize: 12, color: colors.muted },
  chips: { gap: 6, paddingRight: 6 },
  chip: { height: 40, minWidth: 64, paddingHorizontal: 14, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: colors.green },
  chipText: { fontFamily: fontFamily.bold, fontSize: 13, color: colors.ink },
});
