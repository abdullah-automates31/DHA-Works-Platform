import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card, NavRow, Notice, SectionTitle, SettingsTop, settingsStyles } from '@/components/SettingsParts';
import { SUPPORT_EMAIL, supportMailLink } from '@/features/dues/rules';
import { faqs } from '@/features/help/faq';
import { useHelpline } from '@/features/profile/useHelpline';
import { t } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { colors, fontFamily } from '@/theme';

// Help and support: the ONE place for everything about getting help (Shariq, 26 Nov: Profile and Settings repeated it, and this screen
// still had the old look). It uses the same building blocks as the Settings screens. The helpline row and the common questions show only
// when DHA has approved them (app_settings.helpline_enabled); messaging DHA, e-mailing DHA and reports always show.
export default function HelpScreen() {
  const router = useRouter();
  const helpline = useHelpline();
  const { session } = useAuth();
  const [open, setOpen] = useState(-1);
  const [noMail, setNoMail] = useState(false);
  const list = helpline ? faqs(helpline) : [];

  async function emailSupport() {
    setNoMail(false);
    const link = supportMailLink(t('help.mailSubject'), t('help.mailBody', { phone: session?.user.phone || '-' }));
    try {
      await Linking.openURL(link);
    } catch {
      setNoMail(true);
    }
  }

  return (
    <View style={settingsStyles.root}>
      <SettingsTop title={t('help.title')} />
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <SectionTitle>{t('help.contactTitle')}</SectionTitle>
        <Card>
          {helpline ? <NavRow title={t('help.callHelpline', { number: helpline })} hint={t('help.urgentBody')} onPress={() => void Linking.openURL(`tel:${helpline}`)} divider /> : null}
          <NavRow title={t('help.messageSupport')} hint={t('help.messageSupportHint')} onPress={() => router.push('/settings/support')} divider />
          <NavRow title={t('help.emailSupport')} hint={SUPPORT_EMAIL} onPress={() => void emailSupport()} />
        </Card>
        {noMail ? <Notice kind="error">{t('help.noMailApp', { address: SUPPORT_EMAIL })}</Notice> : null}

        {list.length > 0 ? (
          <>
            <SectionTitle>{t('help.common')}</SectionTitle>
            <Card>
              {list.map((faq, index) => (
                <View key={faq.question} style={index < list.length - 1 && styles.divider}>
                  <Pressable accessibilityRole="button" accessibilityState={{ expanded: open === index }} onPress={() => setOpen(open === index ? -1 : index)} style={styles.faqRow}>
                    <Text style={styles.faqQ}>{faq.question}</Text>
                    <Text style={styles.chev}>{open === index ? '−' : '+'}</Text>
                  </Pressable>
                  {open === index ? <Text style={styles.faqA}>{faq.answer}</Text> : null}
                </View>
              ))}
            </Card>
          </>
        ) : null}

        <SectionTitle>{t('help.problemsTitle')}</SectionTitle>
        <Card>
          <NavRow title={t('help.report')} hint={t('help.reportBody')} onPress={() => router.push('/report')} divider />
          <NavRow title={t('help.myReports')} hint={t('help.myReportsBody')} onPress={() => router.push('/my-reports')} />
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  divider: { borderBottomWidth: 1.5, borderBottomColor: '#E2ECE6' },
  faqRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingVertical: 10 },
  faqQ: { flex: 1, fontFamily: fontFamily.extrabold, fontSize: 15, color: colors.ink },
  chev: { fontFamily: fontFamily.extrabold, fontSize: 20, color: colors.green },
  faqA: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 20, color: colors.muted, paddingBottom: 14 },
});
