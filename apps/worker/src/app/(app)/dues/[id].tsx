import { useLocalSearchParams, useRouter } from 'expo-router';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/AuthForm';
import { DuesPayForm } from '@/components/DuesPayForm';
import { Card, InfoRow, LoadError, SectionTitle, SettingsTop, settingsStyles } from '@/components/SettingsParts';
import { DetailSkeleton, SkeletonGroup } from '@/components/Skeleton';
import { dueView, whereText, type DueDetail } from '@/features/dues/rules';
import { useDueDetail } from '@/features/dues/useDueDetail';
import { formatRupees } from '@/features/home/format';
import { statusHref } from '@/features/job/routes';
import { dateText } from '@/features/myreports/rules';
import { t } from '@/i18n';
import { colors, fontFamily } from '@/theme';

// One due in full, like a job in My jobs: the job behind it (what, where, when it was completed), what the worker quoted, the DHA
// fee, what they earned, and how much of the fee is paid. If something is left, the payment form is right here.
export default function DueDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, reload } = useDueDetail(id ?? '');

  return (
    <KeyboardAvoidingView style={settingsStyles.root} behavior="padding">
      <SettingsTop title={t('dues.detail.title')} />
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
      {state.status === 'missing' ? (
        <View style={{ paddingHorizontal: 20, gap: 12 }}>
          <Text style={styles.missingTitle}>{t('dues.detail.missingTitle')}</Text>
          <Text style={settingsStyles.body}>{t('dues.detail.missingBody')}</Text>
          <PrimaryButton label={t('dues.title')} onPress={() => router.replace('/dues')} showArrow={false} />
        </View>
      ) : null}
      {state.status === 'ready' ? (
        <ScrollView contentContainerStyle={settingsStyles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <Body detail={state.detail} onPaid={reload} onOpenJob={() => router.push(statusHref(state.detail.job.id))} />
        </ScrollView>
      ) : null}
    </KeyboardAvoidingView>
  );
}

function Body({ detail, onPaid, onOpenJob }: { detail: DueDetail; onPaid: () => Promise<void>; onOpenJob: () => void }) {
  const { due, job, money } = detail;
  const view = dueView({ id: due.id, jobCode: job.code, jobTitle: job.title, amount: due.fee, paid: due.paid, remaining: due.remaining, accruedAt: due.accruedAt, dueAt: due.dueAt, status: due.status }, new Date());
  const chip = colors.chip[view.tone];
  return (
    <>
      <View style={styles.head}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.jobTitle}>{job.title}</Text>
          <Text style={styles.jobSub}>{[job.code, job.category].filter(Boolean).join(' \u00b7 ')}</Text>
        </View>
        <View style={[styles.chip, { backgroundColor: chip.bg }]}>
          <Text style={[styles.chipText, { color: chip.fg }]}>{view.label}</Text>
        </View>
      </View>

      <SectionTitle>{t('dues.detail.theJob')}</SectionTitle>
      <Card>
        <InfoRow title={t('dues.detail.where')} value={whereText(job.phase, job.lane)} divider />
        <InfoRow title={t('dues.detail.completed')} value={dateText(job.completedAt) || '-'} divider={Boolean(money.cashRecordedAt)} />
        {money.cashRecordedAt ? <InfoRow title={t('dues.detail.cashAt')} value={dateText(money.cashRecordedAt)} /> : null}
      </Card>
      <PrimaryButton label={t('dues.detail.openJob')} onPress={onOpenJob} showArrow={false} />

      <SectionTitle>{t('dues.detail.money')}</SectionTitle>
      <Card>
        <InfoRow title={t('dues.detail.labour')} value={formatRupees(money.labour)} divider />
        {money.materials > 0 ? <InfoRow title={t('dues.detail.materials')} value={formatRupees(money.materials)} divider /> : null}
        <InfoRow title={t('dues.detail.quoted')} value={formatRupees(money.total)} divider />
        <InfoRow title={t('dues.detail.dhaFee')} value={`- ${formatRupees(money.fee)}`} divider />
        <InfoRow title={t('dues.detail.earned')} value={formatRupees(money.earned)} divider={money.cashRecorded !== null} />
        {money.cashRecorded !== null ? <InfoRow title={t('dues.detail.cashCollected')} value={formatRupees(money.cashRecorded)} /> : null}
      </Card>

      <SectionTitle>{t('dues.detail.feeTitle')}</SectionTitle>
      <Card>
        <InfoRow title={t('dues.detail.fee')} value={formatRupees(due.fee)} divider />
        <InfoRow title={t('dues.detail.paid')} value={formatRupees(due.paid)} divider />
        <InfoRow title={t('dues.detail.left')} value={formatRupees(due.remaining)} divider />
        <InfoRow title={t('dues.detail.dueDate')} value={dateText(due.dueAt) || '-'} />
      </Card>
      <Text style={settingsStyles.body}>{view.hint}</Text>
      {due.status === 'waived' && due.waiveReason ? <Text style={settingsStyles.body}>{due.waiveReason}</Text> : null}

      {due.remaining > 0 ? (
        <>
          <Text style={settingsStyles.body}>{t('dues.detail.payNote')}</Text>
          <DuesPayForm owed={detail.owedTotal} initialAmount={due.remaining} onSent={onPaid} />
        </>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  head: { backgroundColor: '#fff', borderRadius: 20, padding: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  jobTitle: { fontFamily: fontFamily.extrabold, fontSize: 17, color: colors.ink },
  jobSub: { fontFamily: fontFamily.semibold, fontSize: 12.5, color: colors.muted },
  chip: { borderRadius: 13, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { fontFamily: fontFamily.extrabold, fontSize: 11.5 },
  missingTitle: { fontFamily: fontFamily.extrabold, fontSize: 17, color: colors.ink },
});
