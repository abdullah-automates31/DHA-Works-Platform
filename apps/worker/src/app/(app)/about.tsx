import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BottomBar, FieldError, GenderSegment, InfoNote, LabeledInput, OnboardingTop, PhoneField, Stepper } from '@/components/onboarding';
import { TextLink } from '@/components/AuthForm';
import { saveAbout, type RpcClient } from '@/features/profile/save';
import {
  cnicDigits,
  dobDigits,
  formatCnic,
  formatDob,
  formatNational,
  isoToDobField,
  isValidCnic,
  isValidName,
  nextFormatted,
  normalizeName,
  normalizePkMobile,
  parseDob,
  sanitizeNationalInput,
  storedPhoneToField,
  type Gender,
} from '@/features/profile/validation';
import { t } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { useMyProfile } from '@/lib/profile';
import { signOut } from '@/lib/signOut';
import { supabase } from '@/lib/supabase';
import { colors, fontFamily } from '@/theme';

const rpcClient: RpcClient = { rpc: (fn, args) => supabase.rpc(fn, args as never) };

type FieldErrors = Partial<Record<'name' | 'mobile' | 'dob' | 'gender' | 'cnic', string>>;

// W02 "About you". CNIC and date of birth are typed into plain fields: never logged, never stored on the device
// (only sent to register_profile / update_my_profile), and autofill and suggestions are switched off for them.
export default function AboutScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { state, refresh } = useMyProfile();
  const existing = state.status === 'ready' ? state.profile : null;

  const [name, setName] = useState(existing?.full_name ?? '');
  const [mobile, setMobile] = useState(storedPhoneToField(existing?.phone ?? session?.user.phone));
  const [dob, setDob] = useState(isoToDobField(existing?.date_of_birth));
  const [gender, setGender] = useState<Gender | null>(existing?.gender === 'male' || existing?.gender === 'female' ? existing.gender : null);
  const [cnic, setCnic] = useState(existing?.cnic ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const clear = (field: keyof FieldErrors) => {
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
    if (formError) setFormError(null);
  };

  async function onNext() {
    if (saving) return;
    const phone = normalizePkMobile(mobile);
    const dateOfBirth = parseDob(dob);
    const next: FieldErrors = {
      name: isValidName(name) ? undefined : t('about.errors.name'),
      mobile: phone ? undefined : t('about.errors.mobile'),
      dob: dateOfBirth ? undefined : t('about.errors.dob'),
      gender: gender ? undefined : t('about.errors.gender'),
      cnic: isValidCnic(cnic) ? undefined : t('about.errors.cnic'),
    };
    setErrors(next);
    setFormError(null);
    if (Object.values(next).some(Boolean) || !phone || !dateOfBirth || !gender) return;

    setSaving(true);
    const result = await saveAbout(rpcClient, existing !== null, {
      fullName: normalizeName(name),
      phone,
      gender,
      dateOfBirth,
      cnic,
    });
    if (!result.ok) {
      setSaving(false);
      if (result.key === 'about.errors.cnicRejected' || result.key === 'about.errors.cnicUnavailable') {
        setErrors({ cnic: t(result.key) });
      } else if (result.key === 'about.errors.mobileRejected') {
        setErrors({ mobile: t(result.key) });
      } else {
        setFormError(t(result.key));
      }
      return;
    }
    await refresh();
    setSaving(false);
    router.replace('/documents');
  }

  // Step 1 has no earlier onboarding step; the button only appears when editing from the next step.
  const onBack = existing !== null && router.canGoBack() ? () => router.back() : undefined;

  return (
    <View style={styles.root}>
      <OnboardingTop step={1} onBack={onBack} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <Stepper current={1} />
          <View style={styles.heading}>
            <Text style={styles.title}>{t('about.title')}</Text>
            <Text style={styles.subtitle}>{t('about.subtitle')}</Text>
          </View>

          <LabeledInput
            label={t('about.fullName')}
            value={name}
            onChangeText={(v) => {
              setName(v);
              clear('name');
            }}
            placeholder={t('about.fullNamePlaceholder')}
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
            returnKeyType="next"
            maxLength={100}
            error={errors.name}
          />

          <PhoneField
            label={t('about.mobile')}
            value={mobile}
            onChangeText={(v) => {
              setMobile(formatNational(sanitizeNationalInput(v)));
              clear('mobile');
            }}
            placeholder={t('about.mobilePlaceholder')}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            error={errors.mobile}
          />

          <View style={styles.pair}>
            <View style={{ flex: 1 }}>
              <LabeledInput
                label={t('about.dob')}
                value={dob}
                onChangeText={(v) => {
                  setDob(nextFormatted(dob, v, dobDigits, formatDob));
                  clear('dob');
                }}
                placeholder={t('about.dobPlaceholder')}
                keyboardType="number-pad"
                autoComplete="off"
                autoCorrect={false}
                spellCheck={false}
                importantForAutofill="no"
                textContentType="none"
                maxLength={14}
                error={errors.dob}
              />
            </View>
            <GenderSegment
              label={t('about.gender')}
              options={[
                { value: 'male', label: t('about.male') },
                { value: 'female', label: t('about.female') },
              ]}
              value={gender}
              onChange={(g) => {
                setGender(g);
                clear('gender');
              }}
              error={errors.gender}
            />
          </View>

          <LabeledInput
            label={t('about.cnic')}
            value={cnic}
            onChangeText={(v) => {
              setCnic(nextFormatted(cnic, v, cnicDigits, formatCnic));
              clear('cnic');
            }}
            placeholder={t('about.cnicPlaceholder')}
            keyboardType="number-pad"
            autoComplete="off"
            autoCorrect={false}
            spellCheck={false}
            importantForAutofill="no"
            textContentType="none"
            maxLength={15}
            error={errors.cnic}
          />

          <InfoNote>{t('about.cnicNote')}</InfoNote>
          {formError ? <FieldError>{formError}</FieldError> : null}
          <TextLink label={t('temp.notYou')} onPress={() => void signOut()} />
        </ScrollView>
        <BottomBar label={t('about.next')} onPress={() => void onNext()} loading={saving} />
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 24, gap: 14 },
  heading: { gap: 4 },
  title: { fontFamily: fontFamily.extrabold, fontSize: 26, lineHeight: 30, letterSpacing: -0.26, color: colors.ink },
  subtitle: { fontFamily: fontFamily.regular, fontSize: 13, lineHeight: 19.5, color: colors.muted },
  pair: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
});
