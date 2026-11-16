import { Pressable, StyleSheet, Text, View } from 'react-native';

import { clockLabel, dayOptions, timeSlots, type VisitChoice } from '@/features/quote/visit';
import { t } from '@/i18n';
import { colors, fontFamily } from '@/theme';

// The worker's visiting time: a day and ONE time. Both are plain buttons in a wrapped grid (no scrolling rows or
// sliders). Plain JavaScript, so it ships without a new native build. Choosing another day keeps the time when that
// day still offers it, otherwise the first time of that day.
export function ArrivalPicker({ value, onChange, now = new Date() }: { value: VisitChoice; onChange: (next: VisitChoice) => void; now?: Date }) {
  const days = dayOptions(now);
  const times = timeSlots(value.day, now);

  const pickDay = (day: string) => {
    const options = timeSlots(day, now);
    onChange({ day, time: options.includes(value.time) ? value.time : options[0] ?? value.time });
  };

  return (
    <View style={styles.box}>
      <Text style={styles.title}>{t('quote.visitTitle')}</Text>
      <Grid label={t('quote.visitDay')} options={days} selected={value.day} onPick={pickDay} />
      <Grid label={t('quote.visitTime')} options={times.map((s) => ({ value: s, label: clockLabel(s) }))} selected={value.time} onPick={(time) => onChange({ ...value, time })} />
    </View>
  );
}

function Grid({ label, options, selected, onPick }: { label: string; options: { value: string; label: string }[]; selected: string; onPick: (v: string) => void }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.grid} accessibilityRole="radiogroup">
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.mint, borderRadius: 14, padding: 12, gap: 12 },
  title: { fontFamily: fontFamily.extrabold, fontSize: 14, color: colors.greenDark },
  label: { fontFamily: fontFamily.bold, fontSize: 12, color: colors.muted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { height: 40, minWidth: 76, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: colors.green },
  chipText: { fontFamily: fontFamily.bold, fontSize: 13, color: colors.ink },
});
