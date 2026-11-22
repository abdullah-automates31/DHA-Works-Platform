import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/AuthForm';
import { FieldError, LabeledInput, Pill } from '@/components/onboarding';
import { Card, settingsStyles } from '@/components/SettingsParts';
import { pickImage } from '@/features/documents/pick';
import { amountDigits, checkPayment, methodLabel, METHODS, sendPayment, type PaymentInput } from '@/features/dues/rules';
import { t } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { showToast } from '@/lib/toast';
import { colors, fontFamily } from '@/theme';

// The "I have paid" form of My Dues (migration 0071, 0073): amount, how the worker paid, the transaction ID and a screenshot of
// the payment. It is used on the My Dues list and on the screen of one due (where the amount starts as what is left on it).
// The screenshot is uploaded first; only then is the payment sent with its path, so a failed upload sends nothing.

export function DuesPayForm({ owed, initialAmount, onSent }: { owed: number; initialAmount?: number; onSent: () => Promise<void> }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const [input, setInput] = useState<PaymentInput>({ amount: initialAmount && initialAmount > 0 ? String(Math.min(initialAmount, owed)) : '', method: null, reference: '', proof: null });
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = checkPayment(input, owed);
  const fieldError = (field: 'amount' | 'method' | 'reference' | 'proof') => (touched && !check.ok && check.field === field ? t(check.key) : null);

  const set = (patch: Partial<PaymentInput>) => {
    setInput((current) => ({ ...current, ...patch }));
    if (error) setError(null);
  };

  // The screenshot of the payment: taken or chosen here, re-encoded by the picker (it also drops location data).
  async function attach(source: 'camera' | 'library') {
    const picked = await pickImage(source, { kind: 'evidence' });
    if (picked.status === 'ok') set({ proof: { bytes: picked.file.bytes, mime: picked.file.mime } });
    else if (picked.status === 'denied') setError(t('dues.errors.permission'));
    else if (picked.status === 'error') setError(t('dues.errors.pickFailed'));
  }

  function onAttach() {
    setError(null);
    Alert.alert(t('dues.proofMenuTitle'), undefined, [
      { text: t('documents.menu.takePhoto'), onPress: () => void attach('camera') },
      { text: t('documents.menu.chooseLibrary'), onPress: () => void attach('library') },
      { text: t('documents.menu.cancel'), style: 'cancel' },
    ]);
  }

  async function send() {
    if (sending) return;
    setTouched(true);
    if (!check.ok) return;
    setSending(true);
    setError(null);
    const result = await sendPayment(
      {
        upload: async (path, bytes, mime) => {
          const { error: uploadError } = await supabase.storage.from('dues-proof').upload(path, bytes, { contentType: mime, upsert: false });
          return { error: uploadError };
        },
        submit: (args) => supabase.rpc('submit_dues_payment', args),
      },
      { userId, args: check.args, proof: check.proof },
    );
    setSending(false);
    if (!result.ok) {
      setError(t(result.key));
      return;
    }
    setInput({ amount: '', method: null, reference: '', proof: null });
    setTouched(false);
    showToast(t('dues.sent'));
    await onSent();
  }

  return (
    <Card>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle}>{t('dues.formTitle')}</Text>
        <Text style={settingsStyles.body}>{t('dues.formHint')}</Text>
        <LabeledInput
          label={t('dues.amount')}
          value={input.amount}
          onChangeText={(v) => set({ amount: amountDigits(v) })}
          keyboardType="number-pad"
          placeholder={String(owed)}
          maxLength={8}
          error={fieldError('amount')}
          onCard
        />
        <Text style={settingsStyles.label}>{t('dues.method')}</Text>
        <View style={styles.pills}>
          {METHODS.map((m) => (
            <Pill key={m} label={methodLabel(m)} on={input.method === m} onPress={() => set({ method: m })} />
          ))}
        </View>
        {fieldError('method') ? <FieldError>{fieldError('method') ?? ''}</FieldError> : null}
        <LabeledInput
          label={t('dues.reference')}
          value={input.reference}
          onChangeText={(v) => set({ reference: v.slice(0, 60) })}
          placeholder={t('dues.referencePlaceholder')}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={60}
          error={fieldError('reference')}
          onCard
        />
        <Text style={settingsStyles.label}>{t('dues.proofLabel')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('dues.proofLabel')}
          onPress={onAttach}
          style={({ pressed }) => [styles.proofBtn, input.proof ? styles.proofOn : null, pressed && { opacity: 0.7 }]}
        >
          <Text style={[styles.proofText, input.proof ? { color: colors.greenDark } : null]}>{input.proof ? `✓ ${t('dues.proofAttached')} · ${t('dues.proofChange')}` : t('dues.proofAttach')}</Text>
        </Pressable>
        {fieldError('proof') ? <FieldError>{fieldError('proof') ?? ''}</FieldError> : null}
        {error ? <FieldError>{error}</FieldError> : null}
        <PrimaryButton label={t('dues.send')} onPress={() => void send()} loading={sending} showArrow={false} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  cardBody: { paddingVertical: 14, gap: 10 },
  cardTitle: { fontFamily: fontFamily.extrabold, fontSize: 16, color: colors.ink },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  proofBtn: { minHeight: 48, borderRadius: 14, backgroundColor: colors.mint, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.green, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  proofOn: { borderStyle: 'solid', backgroundColor: '#E6F3EC' },
  proofText: { fontFamily: fontFamily.extrabold, fontSize: 14, color: colors.greenDark },
});
