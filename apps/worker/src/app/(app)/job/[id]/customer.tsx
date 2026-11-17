import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/AuthForm';
import { ChevronLeftIcon, PhoneIcon, UserIcon } from '@/components/icons';
import { DetailSkeleton, SkeletonGroup } from '@/components/Skeleton';
import { jobDetailsHref, statusHref } from '@/features/job/routes';
import { useJob } from '@/features/job/useJob';
import { dialable } from '@/features/myjobs/rules';
import { visitText } from '@/features/quote/visit';
import { t } from '@/i18n';
import { callPhone } from '@/lib/call';
import { colors, fontFamily } from '@/theme';

// Customer details page, opened from the "Verified resident" bar on the job screen. Before the customer accepts the
// quote only the phase is known (no name, phone, plot or address: decision 4), so the page says what unlocks and when.
// After acceptance the database fills `contact` for the winning worker only: name, phone, address, floor, visit time.
export default function CustomerDetailsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, reload } = useJob(id ?? '');
  const job = state.status === 'ready' ? state.job : null;
  const contact = job?.contact ?? null;
  const phone = dialable(contact?.phone);
  const visit = contact?.visitStart ? visitText(contact.visitStart) : '';
  const address = contact ? [contact.plot ? t('job.customerPlotValue', { plot: contact.plot }) : '', contact.floor ? t('job.customerFloorValue', { floor: contact.floor }) : '', t('job.customerAreaValue', { phase: job?.phase ?? '' })].filter(Boolean).join(', ') : '';

  const goBack = () => (router.canGoBack() ? router.back() : router.replace(statusHref(id ?? '')));

  return (
    <View style={styles.root}>
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={goBack} style={styles.back}>
          <ChevronLeftIcon size={22} color={colors.greenDark} />
        </Pressable>
        <Text style={styles.topTitle}>{t('job.customerDetails')}</Text>
        <View style={{ width: 44 }} />
      </View>

      {state.status === 'loading' ? (
        <SkeletonGroup>
          <DetailSkeleton />
        </SkeletonGroup>
      ) : null}

      {state.status === 'unavailable' || state.status === 'error' ? (
        <View style={styles.message}>
          <Text style={styles.messageTitle}>{state.status === 'error' ? t('job.loadFailedTitle') : t('job.unavailableTitle')}</Text>
          <Text style={styles.messageBody}>{state.status === 'error' ? t('job.loadFailedBody') : t('job.unavailableBody')}</Text>
          <PrimaryButton label={state.status === 'error' ? t('common.retry') : t('myjobs.backToMyJobs')} onPress={() => (state.status === 'error' ? void reload() : router.replace('/my-jobs'))} showArrow={false} />
        </View>
      ) : null}

      {job ? (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
          <View style={[styles.card, styles.hero]}>
            <View style={styles.avatar}>
              <UserIcon size={34} color="#5C4300" />
            </View>
            <Text style={styles.name}>{contact?.name || t('job.customer')}</Text>
            <View style={styles.verified}>
              <Text style={styles.verifiedText}>{t('job.residentPhase', { phase: job.phase })}</Text>
            </View>
            {phone ? (
              <Pressable accessibilityRole="button" accessibilityLabel={t('myjobs.call')} onPress={() => void callPhone(phone)} style={styles.callBtn}>
                <PhoneIcon size={18} color="#fff" />
                <Text style={styles.callBtnText}>{t('myjobs.call')}</Text>
              </Pressable>
            ) : null}
          </View>

          {contact ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t('job.customerContact')}</Text>
              {contact.phone ? <Line label={t('job.customerPhone')} value={contact.phone} /> : null}
              {address ? <Line label={t('job.customerAddress')} value={address} /> : null}
              {visit ? <Line label={t('job.customerVisit')} value={visit} /> : null}
            </View>
          ) : (
            <View style={[styles.card, { backgroundColor: '#FBEFC6' }]}>
              <Text style={[styles.cardTitle, { color: '#3F2F00' }]}>{t('job.customerLockedTitle')}</Text>
              <Text style={[styles.body, { color: '#5C4300' }]}>{t('job.customerLocked')}</Text>
            </View>
          )}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('job.customerJob')}</Text>
            <Line label={t('job.customerJobTitle')} value={job.title} />
            <Line label={t('job.customerJobCategory')} value={job.categoryName} />
            <Line label={t('job.customerJobCode')} value={job.code} />
            {job.when ? <Line label={t('job.customerJobWhen')} value={job.when} /> : null}
            <Pressable accessibilityRole="button" onPress={() => router.push(jobDetailsHref(job.id))} style={styles.linkBtn}>
              <Text style={styles.linkText}>{t('job.customerSeeJob')}</Text>
            </Pressable>
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={styles.lineValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 12 },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  topTitle: { flex: 1, textAlign: 'center', fontFamily: fontFamily.extrabold, fontSize: 18, color: colors.ink },
  content: { paddingHorizontal: 20, paddingTop: 2, gap: 12 },
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 16, gap: 10 },
  hero: { alignItems: 'center', gap: 8, paddingVertical: 22 },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#F6E7B4', alignItems: 'center', justifyContent: 'center' },
  name: { fontFamily: fontFamily.extrabold, fontSize: 20, color: colors.ink },
  verified: { height: 26, paddingHorizontal: 12, borderRadius: 13, backgroundColor: colors.mint, justifyContent: 'center' },
  verifiedText: { fontFamily: fontFamily.extrabold, fontSize: 12, color: colors.green },
  callBtn: { alignSelf: 'stretch', height: 48, borderRadius: 24, backgroundColor: colors.green, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  callBtnText: { fontFamily: fontFamily.extrabold, fontSize: 15, color: '#fff' },
  cardTitle: { fontFamily: fontFamily.extrabold, fontSize: 14, color: colors.ink },
  body: { fontFamily: fontFamily.regular, fontSize: 13, lineHeight: 20, color: colors.ink },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  lineLabel: { fontFamily: fontFamily.bold, fontSize: 13, color: colors.muted },
  lineValue: { flex: 1, textAlign: 'right', fontFamily: fontFamily.extrabold, fontSize: 14, color: colors.ink },
  linkBtn: { height: 40, alignItems: 'center', justifyContent: 'center' },
  linkText: { fontFamily: fontFamily.extrabold, fontSize: 14, color: colors.green },
  message: { paddingHorizontal: 20, paddingTop: 40, gap: 12 },
  messageTitle: { fontFamily: fontFamily.extrabold, fontSize: 18, color: colors.ink },
  messageBody: { fontFamily: fontFamily.regular, fontSize: 14, lineHeight: 21, color: colors.muted },
});
