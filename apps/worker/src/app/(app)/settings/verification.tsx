import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/AuthForm';
import { Card, LoadError, NavRow, SectionTitle, SettingsTop, settingsStyles } from '@/components/SettingsParts';
import { DetailSkeleton, SkeletonGroup } from '@/components/Skeleton';
import { ShieldCheckIcon } from '@/components/icons';
import { dateText } from '@/features/myreports/rules';
import { useHelpline } from '@/features/profile/useHelpline';
import { canResubmitDocuments, documentItems, staffReason, type DocumentKind, type DocumentRow, type DocumentStatus } from '@/features/settings/rules';
import { t } from '@/i18n';
import { useMyProfile } from '@/lib/profile';
import { supabase } from '@/lib/supabase';
import { colors, fontFamily } from '@/theme';

type Summary = { status: 'loading' } | { status: 'error' } | { status: 'ready'; rows: DocumentRow[]; references: number };

const STATUS_TEXT: Record<DocumentStatus, string> = {
  not_submitted: 'settings.verificationScreen.statusNotSubmitted',
  uploaded: 'settings.verificationScreen.statusUploaded',
  pending: 'settings.verificationScreen.statusPending',
  approved: 'settings.verificationScreen.statusApproved',
  changes_needed: 'settings.verificationScreen.statusChangesNeeded',
  rejected: 'settings.verificationScreen.statusRejected',
};
const TONE: Record<DocumentStatus, { bg: string; fg: string }> = {
  not_submitted: { bg: '#E7ECE9', fg: colors.muted },
  uploaded: colors.chip.wait,
  pending: colors.chip.wait,
  approved: colors.chip.done,
  changes_needed: colors.chip.wait,
  rejected: colors.chip.declined,
};
const TITLE: Record<DocumentKind, string> = {
  cnic: 'settings.verificationScreen.cnic',
  police: 'settings.verificationScreen.police',
  photo: 'settings.verificationScreen.photo',
};

// Settings > Verification and documents. Only dates and states are shown, never a file or a link: identity files are
// private and unreadable from the app. The state of each file is the state of the whole application (staff decide
// per application, docs/DECISIONS.md), and the reason staff wrote is shown once.
export default function VerificationScreen() {
  const router = useRouter();
  const { state, refresh } = useMyProfile();
  const helpline = useHelpline();
  const profile = state.status === 'ready' ? state.profile : null;
  const status = profile?.verification_status ?? null;
  const [summary, setSummary] = useState<Summary>({ status: 'loading' });
  const [reloading, setReloading] = useState(false);

  const load = useCallback(async (): Promise<Summary> => {
    const { data, error } = await supabase.rpc('get_my_document_summary');
    if (error || !data) return { status: 'error' };
    return {
      status: 'ready',
      rows: data.filter((r) => r.doc_type !== null).map((r) => ({ doc_type: String(r.doc_type), uploaded_at: r.uploaded_at })),
      references: data.reduce((max, r) => Math.max(max, r.reference_count ?? 0), 0),
    };
  }, []);

  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void load().then((next) => {
      if (active) setSummary((current) => (next.status === 'error' && current.status === 'ready' ? current : next));
    });
    return () => {
      active = false;
    };
  }, [load, attempt]);

  async function onRefresh() {
    setReloading(true);
    const [next] = await Promise.all([load(), refresh()]);
    setSummary((current) => (next.status === 'error' && current.status === 'ready' ? current : next));
    setReloading(false);
  }

  const items = summary.status === 'ready' ? documentItems(summary.rows, summary.references, status) : [];
  const reason = staffReason(status, profile?.verification_reason);
  const overall = status === 'approved' ? 'settings.statusApproved' : status === 'pending' ? 'settings.statusPending' : status === 'needs_changes' ? 'settings.statusNeedsChanges' : status === 'visit_hq' ? 'settings.statusVisitHq' : status === 'rejected' ? 'settings.statusRejected' : 'settings.statusIncomplete';
  const advice =
    status === 'needs_changes' ? t('settings.verificationScreen.fixChanges') : status === 'rejected' ? t('settings.verificationScreen.fixRejected') : status === 'visit_hq' ? t('settings.verificationScreen.fixHq') : null;

  return (
    <View style={settingsStyles.root}>
      <SettingsTop title={t('settings.verification')} />
      {summary.status === 'loading' ? (
        <SkeletonGroup>
          <DetailSkeleton />
        </SkeletonGroup>
      ) : null}
      {summary.status === 'error' ? <LoadError onRetry={() => { setSummary({ status: 'loading' }); setAttempt((n) => n + 1); }} /> : null}
      {summary.status === 'ready' ? (
        <ScrollView contentContainerStyle={settingsStyles.content} refreshControl={<RefreshControl refreshing={reloading} onRefresh={() => void onRefresh()} tintColor={colors.green} />}>
          <SectionTitle>{t('settings.verificationScreen.overall')}</SectionTitle>
          <View style={styles.overall}>
            <ShieldCheckIcon size={22} color={status === 'approved' ? colors.greenDark : colors.muted} />
            <Text style={styles.overallText}>{t(overall)}</Text>
          </View>
          {reason ? (
            <View style={styles.reason}>
              <Text style={styles.reasonTitle}>{t('settings.verificationScreen.reasonTitle')}</Text>
              <Text style={styles.reasonBody}>{reason}</Text>
            </View>
          ) : null}
          {advice ? <Text style={settingsStyles.body}>{advice}</Text> : null}

          <SectionTitle>{t('settings.verificationScreen.documents')}</SectionTitle>
          <Card>
            {items.map((item, index) => {
              const tone = TONE[item.status];
              const title = item.kind === 'police' && summary.rows.every((r) => r.doc_type !== 'police_cert') && item.status !== 'not_submitted' ? t('settings.verificationScreen.policeRefs') : t(TITLE[item.kind] as never);
              return (
                <View key={item.kind} style={[styles.doc, index < items.length - 1 && styles.divider]} accessible accessibilityLabel={`${title}. ${t(STATUS_TEXT[item.status] as never)}`}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.docTitle}>{title}</Text>
                    <Text style={styles.docDate}>{item.submittedAt ? t('settings.verificationScreen.submitted', { date: dateText(item.submittedAt) }) : item.status === 'not_submitted' ? t('settings.verificationScreen.notSent') : ''}</Text>
                  </View>
                  <View style={[styles.chip, { backgroundColor: tone.bg }]}>
                    <Text style={[styles.chipText, { color: tone.fg }]}>{t(STATUS_TEXT[item.status] as never)}</Text>
                  </View>
                </View>
              );
            })}
          </Card>
          <Text style={settingsStyles.body}>{t('settings.verificationScreen.explain')}</Text>
          <Text style={settingsStyles.body}>{t('settings.verificationScreen.private')}</Text>

          {canResubmitDocuments(status) ? <PrimaryButton label={t('settings.verificationScreen.resubmit')} onPress={() => router.push('/documents')} showArrow={false} /> : null}

          <SectionTitle>{t('settings.support')}</SectionTitle>
          <Text style={settingsStyles.body}>{t('settings.verificationScreen.help')}</Text>
          <Card>
            {helpline ? <NavRow title={t('settings.callSupport', { number: helpline })} onPress={() => void Linking.openURL(`tel:${helpline}`)} divider /> : null}
            <NavRow title={t('settings.helpAndFaq')} onPress={() => router.push('/help')} />
          </Card>
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overall: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 20, padding: 16 },
  overallText: { fontFamily: fontFamily.extrabold, fontSize: 16, color: colors.ink },
  reason: { backgroundColor: colors.chip.wait.bg, borderRadius: 18, padding: 14, gap: 4 },
  reasonTitle: { fontFamily: fontFamily.extrabold, fontSize: 13, color: colors.chip.wait.fg },
  reasonBody: { fontFamily: fontFamily.semibold, fontSize: 14, lineHeight: 20, color: colors.chip.wait.fg },
  doc: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 64, paddingVertical: 10 },
  divider: { borderBottomWidth: 1.5, borderBottomColor: '#E2ECE6' },
  docTitle: { fontFamily: fontFamily.extrabold, fontSize: 14, color: colors.ink },
  docDate: { fontFamily: fontFamily.semibold, fontSize: 12, color: colors.muted },
  chip: { borderRadius: 12, paddingVertical: 5, paddingHorizontal: 10 },
  chipText: { fontFamily: fontFamily.extrabold, fontSize: 12 },
});
