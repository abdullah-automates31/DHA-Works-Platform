import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { RADIUS_OPTIONS, radiusLabel } from '@/features/feed/distance';
import { t } from '@/i18n';
import { colors, fontFamily } from '@/theme';

// The "Within X km" choices of W07 Open jobs, as a bottom sheet.
export function DistanceSheet({ visible, radius, onPick, onClose }: { visible: boolean; radius: number | null; onPick: (radius: number | null) => void; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={t('common.cancel')}>
        <View style={styles.sheet} accessibilityViewIsModal onStartShouldSetResponder={() => true}>
          <Text style={styles.title}>{t('feed.distanceTitle')}</Text>
          <Text style={styles.note}>{t('feed.distanceNote')}</Text>
          {RADIUS_OPTIONS.map((r) => {
            const on = r === radius;
            return (
              <Pressable key={String(r)} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => onPick(r)} style={[styles.row, on && styles.rowOn]}>
                <Text style={[styles.rowText, on && { color: '#fff' }]}>{radiusLabel(r)}</Text>
              </Pressable>
            );
          })}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32, gap: 8 },
  title: { fontFamily: fontFamily.extrabold, fontSize: 18, color: colors.ink },
  note: { fontFamily: fontFamily.semibold, fontSize: 12, lineHeight: 17, color: colors.muted, marginBottom: 6 },
  row: { height: 48, borderRadius: 14, backgroundColor: colors.background, justifyContent: 'center', paddingHorizontal: 16 },
  rowOn: { backgroundColor: colors.green },
  rowText: { fontFamily: fontFamily.bold, fontSize: 15, color: colors.ink },
});
