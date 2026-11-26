import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/AuthForm';
import { Card, InfoRow, LoadError, SectionTitle, SettingsTop, settingsStyles } from '@/components/SettingsParts';
import { DetailSkeleton, SkeletonGroup } from '@/components/Skeleton';
import { dateTimeText, isOwnProofPath, methodLabel, paymentNoteKey, paymentView, whereText, type PaymentDetail } from '@/features/dues/rules';
import { usePaymentDetail } from '@/features/dues/usePaymentDetail';
import { formatRupees } from '@/features/home/format';
import { dateText } from '@/features/myreports/rules';
import { t } from '@/i18n';
import { stableSource } from '@/lib/image';
import { supabase } from '@/lib/supabase';
import { colors, fontFamily } from '@/theme';

// One payment in full (Shariq's team, 26 Nov: the cards under "Your payments" must open). How it was paid, when it was sent and decided,
// the screenshot the worker sent, the reason when DHA did not accept it, and WHICH DUES it paid (a payment is not stored against a job:
// all confirmed payments clear the oldest dues first, so the list is worked out by the database, migration 0081). Each due opens the
// due's own screen with the job, where and when.
export default function PaymentDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, reload } = usePaymentDetail(id ?? '');

  return (
    <View style={settingsStyles.root}>
      <SettingsTop title={t('dues.payment.title')} />
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
          <Text style={styles.missingTitle}>{t('dues.payment.missingTitle')}</Text>
          <Text style={settingsStyles.body}>{t('dues.payment.missingBody')}</Text>
          <PrimaryButton label={t('dues.title')} onPress={() => router.replace('/dues')} showArrow={false} />
        </View>
      ) : null}
      {state.status === 'ready' ? (
        <ScrollView contentContainerStyle={settingsStyles.content}>
          <Body detail={state.detail} />
        </ScrollView>
      ) : null}
    </View>
  );
}

function Body({ detail }: { detail: PaymentDetail }) {
  const router = useRouter();
  const { payment, covers, credit, projected } = detail;
  const view = paymentView({ id: payment.id, amount: payment.amount, method: payment.method, reference: payment.reference, status: payment.status, createdAt: payment.createdAt, reason: payment.reason, byStaff: payment.byStaff });
  const chip = colors.chip[view.tone];
  const note = paymentNoteKey(payment);
  const noteText = t(note === 'waiting' ? 'dues.payment.noteWaiting' : note === 'confirmed' ? 'dues.payment.noteConfirmed' : note === 'confirmedStaff' ? 'dues.payment.noteConfirmedStaff' : 'dues.payment.noteRejected');

  return (
    <>
      <View style={styles.head}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.amount}>{formatRupees(payment.amount)}</Text>
          <Text style={styles.note}>{noteText}</Text>
        </View>
        <View style={[styles.chip, { backgroundColor: chip.bg }]}>
          <Text style={[styles.chipText, { color: chip.fg }]}>{view.label}</Text>
        </View>
      </View>

      {payment.status === 'rejected' ? (
        <View style={styles.rejected}>
          <Text style={styles.rejectedTitle}>{t('dues.payment.reasonTitle')}</Text>
          <Text style={styles.rejectedReason}>{payment.reason || t('dues.rejectedNoReason')}</Text>
          <PrimaryButton label={t('dues.payment.payAgain')} onPress={() => router.replace('/dues')} showArrow={false} />
        </View>
      ) : null}

      <SectionTitle>{t('dues.payment.paymentTitle')}</SectionTitle>
      <Card>
        <InfoRow title={t('dues.payment.how')} value={methodLabel(payment.method)} divider />
        {payment.reference ? <InfoRow title={t('dues.payment.txn')} value={payment.reference} divider /> : null}
        <InfoRow title={t('dues.payment.sent')} value={dateTimeText(payment.createdAt) || '-'} divider={payment.decidedAt !== null || payment.byStaff} />
        {payment.decidedAt !== null ? <InfoRow title={t('dues.payment.decided')} value={dateTimeText(payment.decidedAt)} divider={payment.byStaff} /> : null}
        {payment.byStaff ? <InfoRow title={t('dues.byStaff')} value={t('dues.payment.recordedByDha')} /> : null}
      </Card>

      {!payment.byStaff ? <Screenshot path={payment.proofPath} /> : null}

      {payment.status !== 'rejected' ? (
        <>
          <SectionTitle>{t(projected ? 'dues.payment.wouldPayTitle' : 'dues.payment.paidTitle')}</SectionTitle>
          {projected ? <Text style={settingsStyles.body}>{t('dues.payment.waitingHint')}</Text> : null}
          {covers.length === 0 ? <Text style={settingsStyles.body}>{t(projected ? 'dues.payment.noneWaiting' : 'dues.payment.noneConfirmed')}</Text> : null}
          {covers.map((c) => (
            <Pressable
              key={c.dueId}
              accessibilityRole="button"
              accessibilityHint={t('dues.payment.open')}
              accessibilityLabel={`${c.title || c.code}. ${t('dues.payment.coverLine', { covered: formatRupees(c.covered), fee: formatRupees(c.fee) })}`}
              onPress={() => router.push({ pathname: '/dues/[id]', params: { id: c.dueId } })}
              style={({ pressed }) => [styles.cover, pressed && { opacity: 0.7 }]}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.coverTitle} numberOfLines={2}>
                  {c.title || c.code}
                </Text>
                <Text style={styles.coverSub}>{[c.code, whereText(c.phase, c.lane)].filter(Boolean).join(' · ')}</Text>
                {c.completedAt ? <Text style={styles.coverSub}>{t('dues.payment.completedOn', { date: dateText(c.completedAt) })}</Text> : null}
                <Text style={styles.coverMoney}>{t('dues.payment.coverLine', { covered: formatRupees(c.covered), fee: formatRupees(c.fee) })}</Text>
              </View>
              <Text style={styles.arrow}>{'›'}</Text>
            </Pressable>
          ))}
          {credit > 0 ? <Text style={settingsStyles.body}>{t(projected ? 'dues.payment.creditWaiting' : 'dues.payment.credit', { amount: formatRupees(credit) })}</Text> : null}
        </>
      ) : null}
    </>
  );
}

// The screenshot the worker sent: their own file in the private bucket, shown through a short-lived link. Tap it to see it large.
function Screenshot({ path }: { path: string | null }) {
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [big, setBig] = useState(false);
  const usable = isOwnProofPath(path);

  useEffect(() => {
    if (!usable || !path) return;
    let active = true;
    void supabase.storage
      .from('dues-proof')
      .createSignedUrl(path, 600)
      .then(({ data, error }) => {
        if (!active) return;
        if (error || !data?.signedUrl) setFailed(true);
        else setUrl(data.signedUrl);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [path, usable]);

  return (
    <>
      <SectionTitle>{t('dues.payment.screenshotTitle')}</SectionTitle>
      {!usable ? <Text style={settingsStyles.body}>{t('dues.payment.screenshotNone')}</Text> : null}
      {usable && failed ? <Text style={settingsStyles.body}>{t('dues.payment.screenshotFailed')}</Text> : null}
      {usable && !failed && !url ? <ActivityIndicator color={colors.green} /> : null}
      {url ? (
        <Pressable accessibilityRole="imagebutton" accessibilityLabel={t('dues.payment.screenshotTitle')} onPress={() => setBig(true)} style={styles.shot}>
          <Image source={stableSource(url)} contentFit="contain" style={styles.shotImage} onError={() => setFailed(true)} />
        </Pressable>
      ) : null}
      <Modal visible={big} transparent animationType="fade" onRequestClose={() => setBig(false)}>
        <Pressable style={[styles.bigBackdrop, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]} onPress={() => setBig(false)} accessibilityRole="button" accessibilityLabel={t('dues.payment.screenshotClose')}>
          {url ? <Image source={stableSource(url)} contentFit="contain" style={{ flex: 1 }} /> : null}
          <Text style={styles.bigClose}>{t('dues.payment.screenshotClose')}</Text>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  head: { backgroundColor: '#fff', borderRadius: 20, padding: 18, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  amount: { fontFamily: fontFamily.extrabold, fontSize: 32, color: colors.greenDark },
  note: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 19, color: colors.muted },
  chip: { borderRadius: 13, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { fontFamily: fontFamily.extrabold, fontSize: 11.5 },
  rejected: { backgroundColor: colors.chip.declined.bg, borderRadius: 18, padding: 16, gap: 8 },
  rejectedTitle: { fontFamily: fontFamily.extrabold, fontSize: 15, color: colors.chip.declined.fg },
  rejectedReason: { fontFamily: fontFamily.bold, fontSize: 14.5, lineHeight: 21, color: colors.ink },
  cover: { backgroundColor: '#fff', borderRadius: 18, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  coverTitle: { fontFamily: fontFamily.extrabold, fontSize: 15, color: colors.ink },
  coverSub: { fontFamily: fontFamily.semibold, fontSize: 12, color: colors.muted },
  coverMoney: { fontFamily: fontFamily.extrabold, fontSize: 13, color: colors.greenDark, marginTop: 4 },
  arrow: { fontFamily: fontFamily.bold, fontSize: 22, lineHeight: 24, color: colors.muted },
  shot: { backgroundColor: '#fff', borderRadius: 18, padding: 10 },
  shotImage: { width: '100%', height: 320 },
  bigBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', paddingHorizontal: 12, gap: 12 },
  bigClose: { fontFamily: fontFamily.extrabold, fontSize: 15, color: '#fff', textAlign: 'center', paddingVertical: 8 },
  missingTitle: { fontFamily: fontFamily.extrabold, fontSize: 17, color: colors.ink },
});
