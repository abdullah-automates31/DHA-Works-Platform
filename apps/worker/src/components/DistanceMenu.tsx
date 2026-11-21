import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CheckIcon } from '@/components/icons';
import { RADIUS_OPTIONS, radiusLabel } from '@/features/feed/distance';
import { colors, fontFamily } from '@/theme';

// The "Within X km" choices of W07 Open jobs as a dropdown that opens right under the distance button (not a bottom sheet):
// a white card, no dividers, the chosen option in bold green with a tick, a soft rounded highlight on the row being pressed.
// The screen draws it at its top level (Android does not deliver taps to a child outside its parent's bounds), placed right
// under the button, with a tap-away backdrop behind it.
export function DistanceMenu({ radius, onPick }: { radius: number | null; onPick: (radius: number | null) => void }) {
  return (
    <View style={styles.menu} accessibilityRole="radiogroup">
      {RADIUS_OPTIONS.map((r) => {
        const on = r === radius;
        return (
          <Pressable
            key={String(r)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onPick(r)}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <Text style={[styles.rowText, on && styles.rowTextOn]}>{radiusLabel(r)}</Text>
            {on ? <CheckIcon size={18} color={colors.greenDark} strokeWidth={2.6} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  menu: {
    minWidth: 190,
    backgroundColor: '#fff',
    borderRadius: 22,
    padding: 6,
    shadowColor: '#0B2A1D',
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  row: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 18, paddingHorizontal: 16, borderRadius: 14 },
  rowPressed: { backgroundColor: '#EEF3F0' },
  rowText: { fontFamily: fontFamily.semibold, fontSize: 16, color: colors.ink },
  rowTextOn: { fontFamily: fontFamily.extrabold, color: colors.greenDark },
});
