import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AuthPhoneField, ErrorText, Field, FieldLabel, PrimaryButton, TextLink } from '@/components/AuthForm';
import { Card, InfoRow, SettingsTop, settingsStyles } from '@/components/SettingsParts';
import { formatPhoneDisplay, formatNational, isCompleteOtp, maskPhone, OTP_LENGTH, sanitizeNationalInput, sanitizeOtp } from '@/features/auth/validation';
import { confirmPhoneChange, requestPhoneChange, type PhoneClient } from '@/features/settings/phone';
import { t } from '@/i18n';
import { useMyProfile } from '@/lib/profile';
import { supabase } from '@/lib/supabase';
import { colors, fontFamily } from '@/theme';

const RESEND_SECONDS = 60;

const client: PhoneClient = {
  updatePhone: (phone) => supabase.auth.updateUser({ phone }),
  verifyChange: (phone, token) => supabase.auth.verifyOtp({ phone, token, type: 'phone_change' }),
};

// Settings > Change my phone number (migration 0066). A code goes to the NEW number and the sign-in number changes only
// when that code is entered. If the worker leaves half way, nothing has changed.
export default function ChangePhoneScreen() {
  const router = useRouter();
  const { state, refresh } = useMyProfile();
  const current = state.status === 'ready' ? state.profile?.phone ?? null : null;

  const [step, setStep] = useState<'enter' | 'code' | 'done'>('enter');
  const [digits, setDigits] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function send() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await requestPhoneChange(client, digits, current);
    setBusy(false);
    if (!result.ok) {
      setError(t(result.key));
      return;
    }
    setPhone(result.phone);
    setCode('');
    setCooldown(RESEND_SECONDS);
    setStep('code');
  }

  async function resend() {
    if (busy || cooldown > 0) return;
    setBusy(true);
    setError(null);
    const result = await requestPhoneChange(client, phone, current);
    setBusy(false);
    if (!result.ok) setError(t(result.key));
    else setCooldown(RESEND_SECONDS);
  }

  async function confirm(value: string) {
    if (busy) return;
    if (!isCompleteOtp(value)) {
      setError(t('auth.errors.wrongOrExpiredCode'));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await confirmPhoneChange(client, phone, value);
    if (!result.ok) {
      setBusy(false);
      setError(t(result.key));
      return;
    }
    await refresh();
    setBusy(false);
    setStep('done');
  }

  return (
    <View style={settingsStyles.root}>
      <SettingsTop title={t('settings.personalScreen.changePhone')} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={settingsStyles.content} keyboardShouldPersistTaps="handled">
          {step === 'enter' ? (
            <>
              <Card>
                <InfoRow title={t('settings.phoneScreen.current')} value={formatPhoneDisplay(current ?? '')} />
              </Card>
              <FieldLabel>{t('settings.phoneScreen.newNumber')}</FieldLabel>
              <AuthPhoneField
                prefix={t('about.countryCode')}
                value={formatNational(digits)}
                onChangeText={(v) => {
                  setDigits(sanitizeNationalInput(v));
                  if (error) setError(null);
                }}
                placeholder="321 4567890"
                accessibilityLabel={t('settings.phoneScreen.newNumber')}
                hasError={error !== null}
                editable={!busy}
              />
              <ErrorText>{error}</ErrorText>
              <Text style={settingsStyles.body}>{t('settings.phoneScreen.warning')}</Text>
              <PrimaryButton label={t('settings.phoneScreen.send')} onPress={() => void send()} loading={busy} disabled={digits.length === 0} showArrow={false} />
            </>
          ) : null}

          {step === 'code' ? (
            <>
              <Text style={settingsStyles.body}>{t('settings.phoneScreen.codeSent', { phone: maskPhone(phone) })}</Text>
              <FieldLabel>{t('settings.phoneScreen.codeLabel')}</FieldLabel>
              <Field
                value={code}
                onChangeText={(v) => {
                  const next = sanitizeOtp(v);
                  setCode(next);
                  if (error) setError(null);
                  if (next.length === OTP_LENGTH) void confirm(next);
                }}
                placeholder="000000"
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                autoFocus
                maxLength={OTP_LENGTH + 2}
                style={styles.codeInput}
                accessibilityLabel={t('settings.phoneScreen.codeLabel')}
                hasError={error !== null}
              />
              <ErrorText>{error}</ErrorText>
              <PrimaryButton label={t('settings.phoneScreen.confirm')} onPress={() => void confirm(code)} loading={busy} showArrow={false} />
              <TextLink label={cooldown > 0 ? t('settings.phoneScreen.resendIn', { seconds: cooldown }) : t('settings.phoneScreen.resend')} onPress={() => void resend()} disabled={cooldown > 0 || busy} />
              <TextLink
                label={t('settings.phoneScreen.wrongNumber')}
                onPress={() => {
                  setStep('enter');
                  setError(null);
                }}
              />
            </>
          ) : null}

          {step === 'done' ? (
            <>
              <View style={styles.done}>
                <Text style={styles.doneTitle}>{t('settings.phoneScreen.doneTitle')}</Text>
                <Text style={styles.doneBody}>{t('settings.phoneScreen.doneBody', { phone: formatPhoneDisplay(phone) })}</Text>
              </View>
              <PrimaryButton label={t('settings.phoneScreen.back')} onPress={() => router.back()} showArrow={false} />
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  codeInput: { fontFamily: fontFamily.extrabold, fontSize: 22, letterSpacing: 6 },
  done: { backgroundColor: colors.chip.done.bg, borderRadius: 18, padding: 16, gap: 6 },
  doneTitle: { fontFamily: fontFamily.extrabold, fontSize: 16, color: colors.chip.done.fg },
  doneBody: { fontFamily: fontFamily.semibold, fontSize: 14, lineHeight: 20, color: colors.chip.done.fg },
});
