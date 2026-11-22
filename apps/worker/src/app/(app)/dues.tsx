import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { DuesPayForm } from '@/components/DuesPayForm';
import { DuesPayTo } from '@/components/DuesPayTo';
import { Card, LoadError, Notice, SectionTitle, SettingsTop, settingsStyles } from '@/components/SettingsParts';
import { DetailSkeleton, SkeletonGroup } from '@/components/Skeleton';
import { clearableDues, clearablePayments, dueView, methodLabel, paymentView, showClearAll, spanText, type DuesPayment, type DueRow, type MyDues } from '@/features/dues/rules';
import { useMyDues } from '@/features/dues/useMyDues';
import { formatRupees } from '@/features/home/format';
import { dateText } from '@/features/myreports/rules';
import { t } from '@/i18n';
import { colors, fontFamily } from '@/theme';

// My Dues (migration 0071): what this worker owes DHA, where to pay, and a form to say "I have paid" with the transaction
// ID. DHA staff confirm it in the admin portal. The fee comes out of each job's quote: the worker collects the full quote in
// cash and pays DHA its share here. It also opens for a suspended worker, who pays here to get the account back.
export default function DuesScreen() {
  const { state, reload, clearHistory } = useMyDues();
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
          <Body dues={state.dues} onSent={reload} onClear={clearHistory} />
        </ScrollView>
      ) : null}
    </KeyboardAvoidingView>
  );
}

function Body({ dues, onSent, onClear }: { dues: MyDues; onSent: () => Promise<void>; onClear: (which: 'dues' | 'payments') => Promise<boolean> }) {
  const now = new Date();
  const { summary } = dues;
  const suspended = dues.accountStatus === 'suspended';

  function confirmClear(which: 'dues' | 'payments') {
    Alert.alert(t(which === 'dues' ? 'dues.clearDuesTitle' : 'dues.clearPaymentsTitle'), t(which === 'dues' ? 'dues.clearDuesBody' : 'dues.clearPaymentsBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('dues.clearAll'),
        style: 'destructive',
        onPress: () => {
          void onClear(which).then((ok) => {
            if (!ok) Alert.alert(t('dues.clearFailed'));
          });
        },
      },
    ]);
  }
  const clearDues = showClearAll(dues.dues.length, clearableDues(dues.dues));
  const clearPayments = showClearAll(dues.payments.length, clearablePayments(dues.payments));

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

      {summary.owed > 0 ? (
        <>
          <Card>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>{t('dues.payTitle')}</Text>
              <DuesPayTo dues={dues} />
            </View>
          </Card>
          <DuesPayForm owed={summary.owed} onSent={onSent} />
        </>
      ) : null}

      <View style={styles.sectionRow}>
        <View style={{ flex: 1 }}>
          <SectionTitle>{t('dues.duesTitle')}</SectionTitle>
        </View>
        {clearDues ? <ClearAllButton onPress={() => confirmClear('dues')} /> : null}
      </View>
      {dues.dues.length === 0 ? <Text style={settingsStyles.body}>{t('dues.emptyDues')}</Text> : null}
      {dues.dues.map((d) => (
        <DueCard key={d.id} due={d} now={now} />
      ))}

      {dues.payments.length > 0 ? (
        <>
          <View style={styles.sectionRow}>
            <View style={{ flex: 1 }}>
              <SectionTitle>{t('dues.paymentsTitle')}</SectionTitle>
            </View>
            {clearPayments ? <ClearAllButton onPress={() => confirmClear('payments')} /> : null}
          </View>
          {dues.payments.map((p) => (
            <PaymentCard key={p.id} payment={p} />
          ))}
        </>
      ) : null}
    </>
  );
}

function ClearAllButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t('dues.clearAll')} onPress={onPress} hitSlop={8} style={({ pressed }) => [styles.clearBtn, pressed && { opacity: 0.6 }]}>
      <Text style={styles.clearText}>{t('dues.clearAll')}</Text>
    </Pressable>
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
  const router = useRouter();
  const view = dueView(due, now);
  const chip = colors.chip[view.tone];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${due.jobTitle}. ${t('dues.feeLine')} ${formatRupees(due.amount)}. ${view.label}. ${view.hint}`}
      onPress={() => router.push({ pathname: '/dues/[id]', params: { id: due.id } })}
      style={({ pressed }) => [styles.item, pressed && { opacity: 0.7 }]}
    >
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
        <Text style={styles.arrow}>{'\u203A'}</Text>
      </View>
      {due.status === 'due' || due.status === 'overdue' ? <Text style={styles.itemNote}>{view.hint}</Text> : null}
    </Pressable>
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
  proofBtn: { minHeight: 48, borderRadius: 14, backgroundColor: colors.mint, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.green, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  proofOn: { borderStyle: 'solid', backgroundColor: '#E6F3EC' },
  proofText: { fontFamily: fontFamily.extrabold, fontSize: 14, color: colors.greenDark },
  item: { backgroundColor: '#fff', borderRadius: 18, padding: 14, gap: 6 },
  itemHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  itemTitle: { fontFamily: fontFamily.extrabold, fontSize: 15, color: colors.ink },
  itemSub: { fontFamily: fontFamily.semibold, fontSize: 12, color: colors.muted },
  itemNote: { fontFamily: fontFamily.semibold, fontSize: 12.5, lineHeight: 18, color: colors.ink },
  chip: { borderRadius: 13, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { fontFamily: fontFamily.extrabold, fontSize: 11.5 },
  sectionRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  clearBtn: { paddingHorizontal: 4, paddingVertical: 6 },
  clearText: { fontFamily: fontFamily.extrabold, fontSize: 13, color: colors.chip.declined.fg },
  arrow: { fontFamily: fontFamily.bold, fontSize: 22, lineHeight: 24, color: colors.muted },
});
