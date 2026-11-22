import { ActivityIndicator, Keyboard, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { colors, fontFamily } from '@/theme';

import { ArrowRightIcon } from './icons';

// Form pieces of the sign-in screen (W01), sized from worker/screens/Main.dc.html.

export function FormTitle({ children }: { children: string }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function FieldLabel({ children }: { children: string }) {
  return <Text style={styles.label}>{children}</Text>;
}

type FieldProps = TextInputProps & { icon?: React.ReactNode; hasError?: boolean };

export function Field({ icon, hasError, style, ...rest }: FieldProps) {
  return (
    <View style={[styles.field, hasError && styles.fieldError]}>
      {icon}
      <TextInput
        placeholderTextColor="#8A978F"
        {...rest}
        style={[styles.input, style]}
      />
    </View>
  );
}

type PhoneFieldProps = TextInputProps & { prefix: string; hasError?: boolean };

export function AuthPhoneField({ prefix, hasError, style, ...rest }: PhoneFieldProps) {
  return (
    <View style={[styles.field, hasError && styles.fieldError]}>
      <Text style={styles.prefix}>{prefix}</Text>
      <View style={styles.divider} />
      <TextInput
        placeholderTextColor="#8A978F"
        keyboardType="phone-pad"
        {...rest}
        style={[styles.input, style]}
      />
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  loading,
  disabled,
  showArrow = true,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  showArrow?: boolean;
}) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      onPress={
        inactive
          ? undefined
          : () => {
              Keyboard.dismiss(); // closes the keyboard and takes the cursor out of the box, so the tap visibly did something
              onPress();
            }
      }
      style={({ pressed }) => [styles.button, (disabled || pressed) && styles.buttonDim]}
    >
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <>
          <Text style={styles.buttonText}>{label}</Text>
          {showArrow ? <ArrowRightIcon size={22} color="#fff" /> : null}
        </>
      )}
    </Pressable>
  );
}

export function ErrorText({ children }: { children?: string | null }) {
  if (!children) return null;
  return (
    <Text accessibilityRole="alert" style={styles.error}>
      {children}
    </Text>
  );
}

export function TextLink({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={disabled ? undefined : onPress} hitSlop={8}>
      <Text style={[styles.link, disabled && styles.linkDisabled]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: fontFamily.extrabold,
    fontSize: 24,
    letterSpacing: -0.24,
    color: colors.greenDark,
    marginBottom: 4,
  },
  label: { fontFamily: fontFamily.bold, fontSize: 14, color: colors.greenDark },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 52,
    borderWidth: 1.5,
    borderColor: colors.signIn.fieldBorder,
    borderRadius: 16,
    backgroundColor: '#fff',
    paddingHorizontal: 16,
  },
  fieldError: { borderColor: colors.chip.declined.fg },
  prefix: { fontFamily: fontFamily.extrabold, fontSize: 15, color: colors.greenDark },
  divider: { width: 1, height: 24, backgroundColor: colors.signIn.fieldBorder },
  input: {
    flex: 1,
    minWidth: 0,
    height: 48,
    fontFamily: fontFamily.medium,
    fontSize: 15,
    color: colors.signIn.fieldText,
    padding: 0,
  },
  button: {
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.signIn.hero,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 6,
  },
  buttonDim: { opacity: 0.6 },
  buttonText: { fontFamily: fontFamily.extrabold, fontSize: 17, color: '#fff' },
  error: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 18, color: colors.chip.declined.fg },
  link: { fontFamily: fontFamily.bold, fontSize: 14, color: colors.greenDark, textAlign: 'center' },
  linkDisabled: { color: colors.signIn.footnote },
});
