import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { DuesPayForm } from '@/components/DuesPayForm';
import { DuesPayTo } from '@/components/DuesPayTo';
import { Card, LoadError, Notice, SectionTitle, SettingsTop, settingsStyles } from '@/components/SettingsParts';
import { SearchIcon } from '@/components/icons';
import { DetailSkeleton, SkeletonGroup } from '@/components/Skeleton';
import { dueView, latestRejection, methodLabel, paymentView, SEARCH_FROM, searchText, spanText, type DuesPayment, type DueRow, type MyDues } from '@/features/dues/rules';
import { useDuesSearch } from '@/features/dues/useDuesSearch';
import { useMyDues } from '@/features/dues/useMyDues';
import { formatRupees } from '@/features/home/format';
import { dateText } from '@/features/myreports/rules';
import { t } from '@/i18n';
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
  const rejected = latestRejection(dues.payments);
  const [query, setQuery] = useState('');
  const searching = searchText(query) !== '';
  const found = useDuesSearch(query);
  const showSearch = searching || dues.dues.length + dues.payments.length >= SEARCH_FROM;
  return (
    <>
      {suspended ? <Notice kind="error">{t('dues.suspendedNotice')}</Notice> : summary.overdue > 0 ? <Notice kind="error">{t('dues.overdueNotice')}</Notice> : null}

      {rejected ? (
        <View style={styles.rejected} accessibilityRole="alert">
          <Text style={styles.rejectedTitle}>{t('dues.rejectedTitle', { amount: formatRupees(rejected.amount) })}</Text>
          <Text style={styles.rejectedLine}>{t('dues.rejectedWhich', { method: methodLabel(rejected.method), reference: rejected.reference || '-' })}</Text>
          <Text style={styles.rejectedReason}>{rejected.reason ? t('dues.rejectedReason', { reason: rejected.reason }) : t('dues.rejectedNoReason')}</Text>
          <Text style={styles.rejectedLine}>{summary.owed > 0 ? t('dues.rejectedAgain') : t('dues.rejectedDone')}</Text>
        </View>
      ) : null}

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

      {showSearch ? <SearchBox value={query} onChange={setQuery} /> : null}

      {searching ? (
        <SearchResults state={found} query={searchText(query)} now={now} />
      ) : (
        <>
          <SectionTitle>{t('dues.duesTitle')}</SectionTitle>
          {dues.dues.length === 0 ? <Text style={settingsStyles.body}>{t('dues.emptyDues')}</Text> : null}
          {dues.dues.map((d) => (
            <DueCard key={d.id} due={d} now={now} />
          ))}

          {dues.payments.length > 0 ? (
            <>
              <SectionTitle>{t('dues.paymentsTitle')}</SectionTitle>
              {dues.payments.map((p) => (
                <PaymentCard key={p.id} payment={p} />
              ))}
            </>
          ) : null}
        </>
      )}
    </>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.searchWrap}>
      <SearchIcon size={18} color={colors.muted} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={t('dues.searchPlaceholder')}
        placeholderTextColor={colors.muted}
        accessibilityLabel={t('dues.searchPlaceholder')}
        accessibilityHint={t('dues.searchHint')}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        maxLength={40}
        style={styles.searchInput}
      />
      {value !== '' ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t('dues.searchClear')} onPress={() => onChange('')} hitSlop={10} style={styles.searchClear}>
          <Text style={styles.searchClearText}>{'\u2715'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function SearchResults({ state, query, now }: { state: ReturnType<typeof useDuesSearch>; query: string; now: Date }) {
  if (state.status === 'error') return <Notice kind="error">{t('dues.searchError')}</Notice>;
  if (state.status !== 'ready') {
    return (
      <SkeletonGroup>
        <DetailSkeleton />
      </SkeletonGroup>
    );
  }
  const total = state.dues.length + state.payments.length;
  if (total === 0) return <Text style={settingsStyles.body}>{t('dues.searchNone', { q: query })}</Text>;
  return (
    <>
      <Text style={styles.searchCount} accessibilityLiveRegion="polite">
        {t('dues.searchCount', { n: String(total) })}
      </Text>
      {state.dues.length > 0 ? <SectionTitle>{t('dues.duesTitle')}</SectionTitle> : null}
      {state.dues.map((d) => (
        <DueCard key={d.id} due={d} now={now} />
      ))}
      {state.payments.length > 0 ? <SectionTitle>{t('dues.paymentsTitle')}</SectionTitle> : null}
      {state.payments.map((p) => (
        <PaymentCard key={p.id} payment={p} />
      ))}
    </>
  );
}

function PaymentCard({ payment }: { payment: DuesPayment }) {
  const router = useRouter();
  const view = paymentView(payment);
  const chip = colors.chip[view.tone];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${methodLabel(payment.method)} ${formatRupees(payment.amount)} ${view.label}`}
      accessibilityHint={t('dues.payment.open')}
      onPress={() => router.push({ pathname: '/dues/payment/[id]', params: { id: payment.id } })}
      style={({ pressed }) => [styles.item, pressed && { opacity: 0.7 }]}
    >
      <View style={styles.itemHead}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.itemTitle}>{formatRupees(payment.amount)}</Text>
          <Text style={styles.itemSub}>{[methodLabel(payment.method), payment.reference, dateText(payment.createdAt)].filter(Boolean).join(' · ')}</Text>
        </View>
        <View style={[styles.chip, { backgroundColor: chip.bg }]}>
          <Text style={[styles.chipText, { color: chip.fg }]}>{view.label}</Text>
        </View>
        <Text style={styles.arrow}>{'›'}</Text>
      </View>
      {payment.byStaff ? <Text style={styles.itemSub}>{t('dues.byStaff')}</Text> : null}
      {payment.status === 'rejected' ? <Text style={styles.itemNote}>{payment.reason ? t('dues.reasonLabel', { reason: payment.reason }) : t('dues.rejectedNoReason')}</Text> : null}
    </Pressable>
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
  rejected: { backgroundColor: colors.chip.declined.bg, borderRadius: 18, padding: 16, gap: 6 },
  rejectedTitle: { fontFamily: fontFamily.extrabold, fontSize: 16, lineHeight: 22, color: colors.chip.declined.fg },
  rejectedReason: { fontFamily: fontFamily.bold, fontSize: 14.5, lineHeight: 21, color: colors.ink },
  rejectedLine: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 19, color: colors.ink },
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
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 14, minHeight: 50 },
  searchInput: { flex: 1, fontFamily: fontFamily.semibold, fontSize: 15, color: colors.ink, paddingVertical: 10 },
  searchClear: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' },
  searchClearText: { fontFamily: fontFamily.bold, fontSize: 12, color: colors.greenDark },
  searchCount: { fontFamily: fontFamily.semibold, fontSize: 12.5, color: colors.muted },
  arrow: { fontFamily: fontFamily.bold, fontSize: 22, lineHeight: 24, color: colors.muted },
});
