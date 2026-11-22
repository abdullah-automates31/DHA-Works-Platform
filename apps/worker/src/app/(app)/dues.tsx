import { useState } from 'react';
import { KeyboardAvoidingView, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/AuthForm';
import { FieldError, LabeledInput, Pill } from '@/components/onboarding';
import { Card, LoadError, Notice, SectionTitle, SettingsTop, settingsStyles } from '@/components/SettingsParts';
import { DetailSkeleton, SkeletonGroup } from '@/components/Skeleton';
import {
  amountDigits,
  checkPayment,
  dueView,
  methodLabel,
  METHODS,
  paymentView,
  sendPayment,
  spanText,
  type DuesPayment,
  type DueRow,
  type MyDues,
  type PaymentInput,
} from '@/features/dues/rules';
import { useMyDues } from '@/features/dues/useMyDues';
import { formatRupees } from '@/features/home/format';
import { dateText } from '@/features/myreports/rules';
import { t } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { showToast } from '@/lib/toast';
import { colors, fontFamily } from '@/theme';

// My Dues (migration 0071): what this worker owes DHA, where to pay, and a form to say "I have paid" with the transaction
// ID. DHA staff confirm it in the admin portal. The fee comes out of each job's quote: the worker collects the full quote in
// cash and pays DHA its share here. It also opens for a suspended worker, who pays here to get the account back.
export default function DuesScreen() {
  const { state, reload } = useMyDues();
  const [pulling, setPulling] = useState(false);

  async function pull() {
    setPulling(true);
    try {
      await reload();
    } finally {
      setPulling(false);
    }
  }

  return (
    <KeyboardAvoidingView style={settingsStyles.root} behavior="padding">
      <SettingsTop title={t('dues.title')} />
      {state.status === 'loading' ? (
        <SkeletonGroup style={{ paddingHorizontal: 20 }}>
          <DetailSkeleton />
        </SkeletonGroup>
      ) : null}
      {state.status === 'error' ? (
        <View style={{ paddingHorizontal: 20 }}>
          <LoadError onRetry={() => void reload()} />
        </View>
      ) : null}
      {state.status === 'ready' ? (
        <ScrollView
          contentContainerStyle={settingsStyles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void pull()} tintColor={colors.green} />}
        >
          <Body dues={state.dues} onSent={reload} />
        </ScrollView>
      ) : null}
    </KeyboardAvoidingView>
  );
}

function Body({ dues, onSent }: { dues: MyDues; onSent: () => Promise<void> }) {
  const now = new Date();
  const { summary } = dues;
  const suspended = dues.accountStatus === 'suspended';
  return (
    <>
      {suspended ? <Notice kind="error">{t('dues.suspendedNotice')}</Notice> : summary.overdue > 0 ? <Notice kind="error">{t('dues.overdueNotice')}</Notice> : null}

      <View style={styles.summary} accessible accessibilityLabel={`${t('dues.toPay')} ${formatRupees(summary.owed)}`}>
        <Text style={styles.cap}>{t('dues.toPay')}</Text>
        <Text style={[styles.big, summary.overdue > 0 && { color: colors.chip.declined.fg }]}>{formatRupees(summary.owed)}</Text>
        {summary.overdue > 0 ? <Text style={[styles.line, { color: colors.chip.declined.fg }]}>{t('dues.overdueLine', { amount: formatRupees(summary.overdue) })}</Text> : null}
        {summary.owed > 0 && summary.nextDueAt ? (
          <Text style={styles.line}>{t('dues.nextDue', { when: `${dateText(summary.nextDueAt)} (${spanText(new Date(summary.nextDueAt).getTime() - now.getTime())})` })}</Text>
        ) : null}
        {summary.owed === 0 ? <Text style={styles.line}>{t('dues.nothingOwed')}</Text> : null}
        {summary.pendingTotal > 0 ? <Text style={styles.line}>{t('dues.waiting', { amount: formatRupees(summary.pendingTotal) })}</Text> : null}
        {summary.credit > 0 ? <Text style={styles.line}>{t('dues.credit', { amount: formatRupees(summary.credit) })}</Text> : null}
        <Text style={styles.line}>{t('dues.paidSoFar', { amount: formatRupees(summary.paidTotal) })}</Text>
      </View>

      <Card>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>{t('dues.payTitle')}</Text>
          <Text style={dues.payTo ? styles.payTo : settingsStyles.body} selectable>
            {dues.payTo || t('dues.payNone')}
          </Text>
        </View>
      </Card>

      {summary.owed > 0 ? <PayForm owed={summary.owed} onSent={onSent} /> : null}

      {dues.payments.length > 0 ? (
        <>
          <SectionTitle>{t('dues.paymentsTitle')}</SectionTitle>
          {dues.payments.map((p) => (
            <PaymentCard key={p.id} payment={p} />
          ))}
        </>
      ) : null}

      <SectionTitle>{t('dues.duesTitle')}</SectionTitle>
      <Text style={settingsStyles.body}>{t('dues.duesNote')}</Text>
      {dues.dues.length === 0 ? <Text style={settingsStyles.body}>{t('dues.emptyDues')}</Text> : null}
      {dues.dues.map((d) => (
        <DueCard key={d.id} due={d} now={now} />
      ))}
    </>
  );
}

function PayForm({ owed, onSent }: { owed: number; onSent: () => Promise<void> }) {
  const [input, setInput] = useState<PaymentInput>({ amount: '', method: null, reference: '' });
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = checkPayment(input, owed);
  const fieldError = (field: 'amount' | 'method' | 'reference') => (touched && !check.ok && check.field === field ? t(check.key) : null);

  const set = (patch: Partial<PaymentInput>) => {
    setInput((current) => ({ ...current, ...patch }));
    if (error) setError(null);
  };

  async function send() {
    if (sending) return;
    setTouched(true);
    if (!check.ok) return;
    setSending(true);
    setError(null);
    const result = await sendPayment({ submit: (args) => supabase.rpc('submit_dues_payment', args) }, check.args);
    setSending(false);
    if (!result.ok) {
      setError(t(result.key));
      return;
    }
    setInput({ amount: '', method: null, reference: '' });
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
        {error ? <FieldError>{error}</FieldError> : null}
        <PrimaryButton label={t('dues.send')} onPress={() => void send()} loading={sending} showArrow={false} />
      </View>
    </Card>
  );
}

function PaymentCard({ payment }: { payment: DuesPayment }) {
  const view = paymentView(payment);
  const chip = colors.chip[view.tone];
  return (
    <View style={styles.item} accessible accessibilityLabel={`${methodLabel(payment.method)} ${formatRupees(payment.amount)} ${view.label}`}>
      <View style={styles.itemHead}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.itemTitle}>{formatRupees(payment.amount)}</Text>
          <Text style={styles.itemSub}>{[methodLabel(payment.method), payment.reference, dateText(payment.createdAt)].filter(Boolean).join(' · ')}</Text>
        </View>
        <View style={[styles.chip, { backgroundColor: chip.bg }]}>
          <Text style={[styles.chipText, { color: chip.fg }]}>{view.label}</Text>
        </View>
      </View>
      {payment.byStaff ? <Text style={styles.itemSub}>{t('dues.byStaff')}</Text> : null}
      {payment.status === 'rejected' && payment.reason ? <Text style={styles.itemNote}>{payment.reason}</Text> : null}
    </View>
  );
}

function DueCard({ due, now }: { due: DueRow; now: Date }) {
  const view = dueView(due, now);
  const chip = colors.chip[view.tone];
  return (
    <View style={styles.item} accessible accessibilityLabel={`${due.jobTitle}. ${t('dues.feeLine')} ${formatRupees(due.amount)}. ${view.label}. ${view.hint}`}>
      <View style={styles.itemHead}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.itemTitle} numberOfLines={2}>
            {due.jobTitle || due.jobCode}
          </Text>
          <Text style={styles.itemSub}>{[due.jobCode, `${t('dues.feeLine')} ${formatRupees(due.amount)}`].filter(Boolean).join(' · ')}</Text>
        </View>
        <View style={[styles.chip, { backgroundColor: chip.bg }]}>
          <Text style={[styles.chipText, { color: chip.fg }]}>{view.label}</Text>
        </View>
      </View>
      <Text style={styles.itemNote}>{view.hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { backgroundColor: '#fff', borderRadius: 20, padding: 18, gap: 4 },
  cap: { fontFamily: fontFamily.bold, fontSize: 11, letterSpacing: 0.5, color: colors.muted },
  big: { fontFamily: fontFamily.extrabold, fontSize: 34, color: colors.greenDark },
  line: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 19, color: colors.muted },
  cardBody: { paddingVertical: 14, gap: 10 },
  cardTitle: { fontFamily: fontFamily.extrabold, fontSize: 16, color: colors.ink },
  payTo: { fontFamily: fontFamily.bold, fontSize: 14, lineHeight: 21, color: colors.ink },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  item: { backgroundColor: '#fff', borderRadius: 18, padding: 14, gap: 6 },
  itemHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  itemTitle: { fontFamily: fontFamily.extrabold, fontSize: 15, color: colors.ink },
  itemSub: { fontFamily: fontFamily.semibold, fontSize: 12, color: colors.muted },
  itemNote: { fontFamily: fontFamily.semibold, fontSize: 12.5, lineHeight: 18, color: colors.ink },
  chip: { borderRadius: 13, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { fontFamily: fontFamily.extrabold, fontSize: 11.5 },
});
