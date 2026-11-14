import { Fragment, useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '@/i18n';
import { colors, fontFamily } from '@/theme';

import { ChangesNeededBanner } from './ChangesNeededBanner';
import { ArrowRightIcon, CheckIcon, ChevronLeftIcon, LockIcon } from './icons';

// Pieces of the onboarding screens (W02 onwards). Values come from worker/screens/dww.css and
// w-onboard-1.dc.html: .top, .rb, .tn, .fld, .inp, .seg, .note.g, .cta, .btn.

const STEP_KEYS = ['about', 'documents', 'work', 'review'] as const;
const MUTED_STEP = '#5B7366';
const CONNECTOR = '#C9D9CF';

/**
 * Back button (44px round) and "Step n of 4". On the first step with nowhere to go back to, no button is drawn. When DHA
 * staff asked for changes, what to fix is shown right under it on every sign-up screen.
 */
export function OnboardingTop({ step, onBack }: { step: number; onBack?: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <>
    <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
      {onBack ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={onBack} style={styles.roundButton}>
          <ChevronLeftIcon size={22} color={colors.greenDark} />
        </Pressable>
      ) : (
        <View style={styles.roundButtonSpace} />
      )}
      <View style={{ flex: 1 }} />
      <Text style={styles.stepOf}>{t('onboarding.stepOf', { step, total: STEP_KEYS.length })}</Text>
    </View>
    <ChangesNeededBanner />
    </>
  );
}

export function Stepper({ current }: { current: number }) {
  return (
    <View style={styles.stepper} accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: 4, now: current }}>
      {STEP_KEYS.map((key, index) => {
        const number = index + 1;
        const active = number === current;
        const done = number < current;
        return (
          <Fragment key={key}>
            {index > 0 ? <View style={[styles.connector, number <= current && { backgroundColor: colors.green }]} /> : null}
            <View style={styles.stepCol}>
              <View style={[styles.circle, (active || done) && styles.circleOn]}>
                {done ? (
                  <CheckIcon size={14} color="#fff" strokeWidth={3} />
                ) : (
                  <Text style={[styles.circleText, active && { color: '#fff' }]}>{number}</Text>
                )}
              </View>
              <Text style={[styles.stepLabel, active ? styles.stepLabelOn : styles.stepLabelOff]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                {t(`onboarding.steps.${key}`)}
              </Text>
            </View>
          </Fragment>
        );
      })}
    </View>
  );
}

type LabeledProps = TextInputProps & { label: string; error?: string | null; invalid?: boolean; /** the field sits on a white card, so it needs its own tint and outline to be seen */ onCard?: boolean };

export function LabeledInput({ label, error, invalid, onCard, style, ...rest }: LabeledProps) {
  return (
    <View style={styles.fld}>
      <Text style={styles.fldLabel}>{label}</Text>
      <View style={[styles.inp, onCard ? styles.inpOnCard : null, error || invalid ? styles.inpError : null]}>
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor="#8A978F"
          {...rest}
          style={[styles.inpText, style]}
        />
      </View>
      {error ? <FieldError>{error}</FieldError> : null}
    </View>
  );
}

/** The fixed "+92" chip (mint) beside the number field. */
export function PhoneField({ label, error, ...rest }: LabeledProps) {
  return (
    <View style={styles.fld}>
      <Text style={styles.fldLabel}>{label}</Text>
      <View style={styles.phoneRow}>
        <View style={styles.country}>
          <Text style={styles.countryText}>{t('about.countryCode')}</Text>
        </View>
        <View style={[styles.inp, { flex: 1 }, error ? styles.inpError : null]}>
          <TextInput accessibilityLabel={label} placeholderTextColor="#8A978F" {...rest} style={styles.inpText} />
        </View>
      </View>
      {error ? <FieldError>{error}</FieldError> : null}
    </View>
  );
}

export function FieldError({ children }: { children: string }) {
  return (
    <Text accessibilityRole="alert" style={styles.fieldError}>
      {children}
    </Text>
  );
}

export function GenderSegment<T extends string>({
  label,
  options,
  value,
  onChange,
  error,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
  error?: string | null;
}) {
  return (
    <View style={[styles.fld, { flex: 1 }]}>
      <Text style={styles.fldLabel}>{label}</Text>
      <View style={[styles.seg, error ? styles.inpError : null]} accessibilityRole="radiogroup">
        {options.map((option) => {
          const on = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => onChange(option.value)}
              style={[styles.segButton, on && styles.segButtonOn]}
            >
              <Text style={[styles.segText, on && { color: '#fff' }]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {error ? <FieldError>{error}</FieldError> : null}
    </View>
  );
}

export function InfoNote({ children }: { children: string }) {
  return (
    <View style={styles.note}>
      <LockIcon size={18} color={colors.greenDark} />
      <Text style={styles.noteText}>{children}</Text>
    </View>
  );
}

/** White bar fixed at the bottom with the main button (.cta + .btn). */
function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setOpen(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return open;
}

export function BottomBar({
  label,
  onPress,
  loading,
  disabled,
  hideArrow,
  soft,
  secondary,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  hideArrow?: boolean;
  /** mint button (.btn.soft) for actions that wait or go back, instead of the green main button */
  soft?: boolean;
  /** a second, mint button on the left of the main one (for example "Back to job status") */
  secondary?: { label: string; onPress: () => void };
}) {
  const insets = useSafeAreaInsets();
  const keyboardOpen = useKeyboardOpen();
  const inactive = disabled || loading;
  return (
    // The home-indicator space is not needed while the keyboard covers it.
    <View style={[styles.cta, { paddingBottom: keyboardOpen ? 12 : Math.max(22, insets.bottom) }, secondary && { flexDirection: 'row', gap: 10 }]}>
      {secondary ? (
        <Pressable
          accessibilityRole="button"
          onPress={secondary.onPress}
          style={({ pressed }) => [styles.btn, { backgroundColor: colors.mint, flex: 1 }, pressed && { opacity: 0.6 }]}
        >
          <Text style={[styles.btnText, { color: colors.greenDark }]}>{secondary.label}</Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: inactive, busy: loading }}
        onPress={inactive ? undefined : onPress}
        style={({ pressed }) => [styles.btn, secondary && { flex: 1.3 }, soft && { backgroundColor: colors.mint }, (inactive || pressed) && { opacity: 0.6 }]}
      >
        <Text style={[styles.btnText, soft && { color: colors.greenDark }]}>{loading ? t('about.saving') : label}</Text>
        {loading || hideArrow ? null : <ArrowRightIcon size={22} color="#fff" />}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 6 },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundButtonSpace: { width: 44, height: 44 },
  stepOf: { fontFamily: fontFamily.semibold, fontSize: 12, color: colors.muted },

  stepper: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 2 },
  stepCol: { width: 64, alignItems: 'center', gap: 6 },
  connector: { flex: 1, height: 2, backgroundColor: CONNECTOR, marginTop: 13, marginHorizontal: -6 },
  circle: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  circleOn: { backgroundColor: colors.green },
  circleText: { fontFamily: fontFamily.extrabold, fontSize: 13, color: MUTED_STEP },
  stepLabel: { fontSize: 12 },
  stepLabelOn: { fontFamily: fontFamily.extrabold, color: colors.green },
  stepLabelOff: { fontFamily: fontFamily.semibold, color: colors.muted },

  fld: { gap: 6 },
  fldLabel: { fontFamily: fontFamily.bold, fontSize: 12, color: colors.muted },
  inp: {
    height: 52,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: 'transparent',
    paddingHorizontal: 14.5,
    justifyContent: 'center',
  },
  inpOnCard: { backgroundColor: colors.background, borderColor: colors.line },
  inpError: { borderColor: colors.chip.declined.fg },
  inpText: { fontFamily: fontFamily.semibold, fontSize: 15, color: colors.ink, padding: 0, height: 48 },
  fieldError: { fontFamily: fontFamily.semibold, fontSize: 12, lineHeight: 17, color: colors.chip.declined.fg },

  phoneRow: { flexDirection: 'row', gap: 8 },
  country: {
    width: 72,
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.mint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countryText: { fontFamily: fontFamily.extrabold, fontSize: 15, color: colors.greenDark },

  seg: { height: 52, flexDirection: 'row', backgroundColor: '#fff', borderRadius: 14, padding: 4, gap: 4, borderWidth: 0 },
  segButton: { flex: 1, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  segButtonOn: { backgroundColor: colors.green },
  segText: { fontFamily: fontFamily.bold, fontSize: 13, color: colors.muted },

  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.mint,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  noteText: { flex: 1, fontFamily: fontFamily.semibold, fontSize: 12, lineHeight: 17, color: colors.greenDark },

  cta: { backgroundColor: '#fff', paddingTop: 14, paddingHorizontal: 20 },
  btn: {
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.green,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  btnText: { fontFamily: fontFamily.extrabold, fontSize: 15, color: '#fff' },
});

/** Trade pill (.pill / .pill.on: 40 high, fully rounded, white or green). */
export function Pill({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      onPress={onPress}
      style={[pillStyles.pill, on && pillStyles.pillOn]}
    >
      <Text style={[pillStyles.text, on && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

/** Numeric field with a prefix ("Rs") or suffix ("years"), as on W03b: 52 high, 1.5 border, radius 16. */
export function NumberField({
  label,
  prefix,
  suffix,
  error,
  ...rest
}: TextInputProps & { label: string; prefix?: string; suffix?: string; error?: boolean }) {
  return (
    <View style={[styles.fld, { flex: 1 }]}>
      <Text style={styles.fldLabel}>{label}</Text>
      <View style={[pillStyles.number, error && { borderColor: colors.chip.declined.fg }]}>
        {prefix ? <Text style={pillStyles.affixStrong}>{prefix}</Text> : null}
        <TextInput
          accessibilityLabel={label}
          keyboardType="number-pad"
          placeholderTextColor="#8A978F"
          {...rest}
          style={pillStyles.numberText}
        />
        {suffix ? <Text style={pillStyles.affix}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

const pillStyles = StyleSheet.create({
  pill: { height: 40, paddingHorizontal: 16, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  pillOn: { backgroundColor: colors.green },
  text: { fontFamily: fontFamily.bold, fontSize: 13, color: colors.ink },
  number: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 52,
    borderWidth: 1.5,
    borderColor: colors.signIn.fieldBorder,
    borderRadius: 16,
    backgroundColor: '#fff',
    paddingHorizontal: 14,
  },
  numberText: { flex: 1, minWidth: 0, fontFamily: fontFamily.semibold, fontSize: 15, color: colors.ink, padding: 0, height: 48 },
  affix: { fontFamily: fontFamily.bold, fontSize: 12, color: colors.muted },
  affixStrong: { fontFamily: fontFamily.extrabold, fontSize: 13, color: colors.signIn.fieldText },
});
