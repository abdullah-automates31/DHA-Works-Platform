import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/AuthForm';
import { ChevronLeftIcon } from '@/components/icons';
import { t } from '@/i18n';
import { colors, fontFamily } from '@/theme';

// Small building blocks shared by the Settings screens, in the same look as Profile and Help (white rounded
// cards on the pale green background, 44 px round back button, extrabold titles).

export function SettingsTop({ title }: { title: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/profile'))}
        style={styles.back}
      >
        <ChevronLeftIcon size={22} color={colors.greenDark} />
      </Pressable>
      <Text style={styles.topTitle} accessibilityRole="header">
        {title}
      </Text>
      <View style={styles.back} />
    </View>
  );
}

export function SectionTitle({ children }: { children: string }) {
  return <Text style={styles.section}>{children}</Text>;
}

export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function NavRow({
  title,
  hint,
  value,
  onPress,
  divider,
  disabled,
  danger,
}: {
  title: string;
  hint?: string;
  value?: string;
  onPress?: () => void;
  divider?: boolean;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !onPress || disabled }}
      onPress={onPress && !disabled ? onPress : undefined}
      style={({ pressed }) => [styles.row, divider && styles.divider, pressed && onPress ? { opacity: 0.7 } : null]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, danger && { color: colors.chip.declined.fg }, disabled && { color: colors.muted }]}>{title}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      {value ? (
        <Text style={styles.rowValue} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {onPress && !danger && !disabled ? <Text style={styles.chev}>›</Text> : null}
    </Pressable>
  );
}

export function InfoRow({ title, value, divider }: { title: string; value: string; divider?: boolean }) {
  return (
    <View style={[styles.row, divider && styles.divider]}>
      <Text style={styles.rowTitle}>{title}</Text>
      <View style={{ flex: 1 }} />
      <Text style={[styles.rowValue, { maxWidth: '65%' }]} selectable>
        {value}
      </Text>
    </View>
  );
}

export function ToggleRow({
  title,
  hint,
  value,
  busy,
  onChange,
  divider,
}: {
  title: string;
  hint: string;
  value: boolean;
  busy?: boolean;
  onChange: (next: boolean) => void;
  divider?: boolean;
}) {
  return (
    <View style={[styles.row, divider && styles.divider]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowHint}>{hint}</Text>
        <Text style={[styles.state, { color: value ? colors.greenDark : colors.muted }]}>{t(value ? 'settings.notificationsScreen.on' : 'settings.notificationsScreen.off')}</Text>
      </View>
      {busy ? <ActivityIndicator color={colors.green} style={{ marginRight: 6 }} /> : null}
      <Switch
        accessibilityLabel={title}
        value={value}
        onValueChange={onChange}
        trackColor={{ false: '#C9CFCB', true: colors.greenDark }}
        thumbColor="#fff"
      />
    </View>
  );
}

/** Save and Cancel under a form. Save is enabled only when something changed and is valid. */
export function SaveBar({ canSave, saving, onSave, onCancel }: { canSave: boolean; saving: boolean; onSave: () => void; onCancel: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.saveBar, { paddingBottom: Math.max(14, insets.bottom) }]}>
      <PrimaryButton label={t('settings.save')} onPress={onSave} loading={saving} disabled={!canSave} showArrow={false} />
      <Pressable accessibilityRole="button" onPress={onCancel} disabled={saving} style={styles.cancel}>
        <Text style={styles.cancelText}>{t('settings.cancel')}</Text>
      </Pressable>
    </View>
  );
}

/** A short line of feedback under a form: success in green, a problem in red. */
export function Notice({ kind, children }: { kind: 'ok' | 'error'; children: string }) {
  return (
    <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.notice, kind === 'ok' ? styles.noticeOk : styles.noticeError]}>
      {children}
    </Text>
  );
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorTitle}>{t('settings.loadFailedTitle')}</Text>
      <Text style={styles.errorBody}>{t('settings.loadFailedBody')}</Text>
      <PrimaryButton label={t('common.retry')} onPress={onRetry} showArrow={false} />
    </View>
  );
}

export const settingsStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 32, gap: 12 },
  body: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 19, color: colors.muted },
  label: { fontFamily: fontFamily.bold, fontSize: 12, color: colors.muted },
});

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 12 },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  topTitle: { flex: 1, textAlign: 'center', fontFamily: fontFamily.extrabold, fontSize: 18, color: colors.ink },
  section: { fontFamily: fontFamily.extrabold, fontSize: 13, color: colors.muted, marginTop: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  card: { backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingVertical: 10 },
  divider: { borderBottomWidth: 1.5, borderBottomColor: '#E2ECE6' },
  rowTitle: { fontFamily: fontFamily.extrabold, fontSize: 15, color: colors.ink },
  rowHint: { fontFamily: fontFamily.semibold, fontSize: 12, lineHeight: 17, color: colors.muted, marginTop: 2 },
  rowValue: { flexShrink: 1, maxWidth: '45%', fontFamily: fontFamily.semibold, fontSize: 13, color: colors.muted, textAlign: 'right' },
  chev: { fontFamily: fontFamily.extrabold, fontSize: 20, color: colors.muted },
  state: { fontFamily: fontFamily.extrabold, fontSize: 11, marginTop: 4 },
  saveBar: { paddingHorizontal: 20, paddingTop: 10, gap: 4, backgroundColor: colors.background },
  cancel: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontFamily: fontFamily.extrabold, fontSize: 14, color: colors.muted },
  notice: { fontFamily: fontFamily.bold, fontSize: 13, lineHeight: 18, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, overflow: 'hidden' },
  noticeOk: { backgroundColor: colors.chip.done.bg, color: colors.chip.done.fg },
  noticeError: { backgroundColor: colors.chip.declined.bg, color: colors.chip.declined.fg },
  errorBox: { backgroundColor: colors.mint, borderRadius: 18, padding: 16, gap: 10, margin: 20 },
  errorTitle: { fontFamily: fontFamily.extrabold, fontSize: 16, color: colors.greenDark },
  errorBody: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 19, color: colors.muted },
});
