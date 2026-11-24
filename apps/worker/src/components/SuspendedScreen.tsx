import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { OutlineButton, PrimaryButton, TextLink } from '@/components/AuthForm';
import { Crest } from '@/components/Crest';
import { DuesPayTo } from '@/components/DuesPayTo';
import { HomeIcon, MailIcon } from '@/components/icons';
import { maskPhone } from '@/features/auth/validation';
import { SUPPORT_EMAIL, supportMailLink, whatsappLink } from '@/features/dues/rules';
import { useMyDues } from '@/features/dues/useMyDues';
import { formatRupees } from '@/features/home/format';
import { dateText } from '@/features/myreports/rules';
import { t } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { colors, fontFamily } from '@/theme';

// Shown when DHA staff have suspended the account (they do it by hand, for example for unpaid dues). It says why, how much
// the worker owes, how to pay (My Dues opens even while suspended), and how to reach DHA support. The reason and end date
// come from the profile the app already holds; the amount and the support number come from my_dues, which a suspended
// worker may read. Nothing else in the app opens until DHA reactivates the account.
export function SuspendedScreen({ reason, until, onCheck, checking }: { reason: string | null | undefined; until: string | null | undefined; onCheck: () => Promise<void>; checking: boolean }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { state } = useMyDues();
  const phone = session?.user.phone ?? '';
  const dues = state.status === 'ready' ? state.dues : null;
  const owed = dues?.summary.owed ?? 0;
  const helpline = dues?.helpline ?? null;
  const whatsapp = whatsappLink(helpline);
  const end = dateText(until);
  const [note, setNote] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Opens the phone's mail app with DHA's address, a subject and the worker's phone and amount already typed in.
  async function emailSupport() {
    setNote(null);
    const link = supportMailLink(t('dues.suspended.mailSubject'), t('dues.suspended.mailBody', { phone: phone || '-', owed: formatRupees(owed) }));
    try {
      await Linking.openURL(link);
    } catch {
      if (mounted.current) setNote(t('dues.suspended.noMailApp', { address: SUPPORT_EMAIL }));
    }
  }

  // Re-reads the account. If DHA has opened it again, the route gate moves the worker to Home by itself and this screen goes away;
  // if it is still suspended, say so, so the tap visibly did something.
  async function backHome() {
    setNote(null);
    await onCheck();
    if (mounted.current) setNote(t('dues.suspended.stillSuspended'));
  }

  return (
    <ScrollView contentContainerStyle={[styles.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]} bounces={false}>
      <Crest size={88} />
      <AppText variant="h2" color={colors.greenDark} style={styles.center}>
        {t('dues.suspended.title')}
      </AppText>
      <AppText variant="small" color={colors.signIn.fieldText} style={styles.center}>
        {end ? `${t('dues.suspended.body')} ${t('temp.status.suspendedUntil', { date: end })}` : t('dues.suspended.body')}
      </AppText>

      {reason ? (
        <View style={styles.box}>
          <AppText variant="caption" color={colors.muted}>
            {t('temp.status.reasonLabel')}
          </AppText>
          <AppText variant="bodyBold" color={colors.ink}>
            {reason}
          </AppText>
        </View>
      ) : null}

      {owed > 0 ? (
        <View style={[styles.box, styles.owed]}>
          <Text style={styles.owedAmount}>{t('dues.suspended.owed', { amount: formatRupees(owed) })}</Text>
          {dues ? <DuesPayTo dues={dues} /> : null}
        </View>
      ) : null}

      <View style={styles.buttons}>
        {owed > 0 ? <PrimaryButton label={t('dues.suspended.payCta')} onPress={() => router.push('/dues')} showArrow={false} /> : null}
        {helpline ? <PrimaryButton label={`${t('dues.suspended.call')} (${helpline})`} onPress={() => void Linking.openURL(`tel:${helpline}`)} showArrow={false} /> : null}
        {whatsapp ? <PrimaryButton label={t('dues.suspended.whatsapp')} onPress={() => void Linking.openURL(whatsapp)} showArrow={false} /> : null}
        <OutlineButton label={t('dues.suspended.email')} icon={<MailIcon size={20} color={colors.signIn.hero} />} onPress={() => void emailSupport()} />
        <OutlineButton label={t('dues.suspended.backHome')} icon={<HomeIcon size={20} color={colors.signIn.hero} />} onPress={() => void backHome()} loading={checking} />
        {note ? (
          <Text accessibilityRole="alert" style={styles.noContact}>
            {note}
          </Text>
        ) : null}
        {!helpline ? <Text style={styles.noContact}>{t('dues.suspended.noContact')}</Text> : null}
        <TextLink label={t('temp.status.refresh')} onPress={() => void onCheck()} disabled={checking} />
      </View>

      <AppText variant="caption" color={colors.signIn.footnote} style={styles.center}>
        {t('temp.signedInAs', { phone: phone ? maskPhone(phone) : '' })}
      </AppText>
      <TextLink label={t('temp.signOut')} onPress={() => void supabase.auth.signOut()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 26 },
  center: { textAlign: 'center' },
  box: { alignSelf: 'stretch', backgroundColor: colors.mint, borderRadius: 14, padding: 14, gap: 4 },
  owed: { backgroundColor: colors.chip.declined.bg },
  owedAmount: { fontFamily: fontFamily.extrabold, fontSize: 18, color: colors.chip.declined.fg },
  buttons: { alignSelf: 'stretch', gap: 12, marginTop: 6 },
  noContact: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 19, color: colors.muted, textAlign: 'center' },
});
