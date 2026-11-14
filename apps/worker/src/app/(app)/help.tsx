import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronLeftIcon, PhoneIcon } from '@/components/icons';
import { faqs } from '@/features/help/faq';
import { useHelpline } from '@/features/profile/useHelpline';
import { t } from '@/i18n';
import { colors, fontFamily } from '@/theme';

// W17 Help and support (worker/screens/w-help.dc.html). The helpline card and the common questions show only when
// DHA has approved them (app_settings.helpline_enabled); the "Email DHA support" row is not built because no
// support address exists yet (docs/OPEN-QUESTIONS.md). Report a problem always shows: reports are filed per job.
export default function HelpScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const helpline = useHelpline();
  const [open, setOpen] = useState(-1);
  const list = helpline ? faqs(helpline) : [];

  return (
    <View style={styles.root}>
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))} style={styles.back}>
          <ChevronLeftIcon size={22} color={colors.greenDark} />
        </Pressable>
        <Text style={styles.topTitle}>{t('help.title')}</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {helpline ? (
          <View style={styles.urgent}>
            <Text style={styles.urgentHead}>{t('help.urgentTitle')}</Text>
            <Text style={styles.urgentBody}>{t('help.urgentBody')}</Text>
            <Pressable accessibilityRole="button" onPress={() => void Linking.openURL(`tel:${helpline}`)} style={styles.callBtn}>
              <PhoneIcon size={18} color="#fff" />
              <Text style={styles.callText}>{t('help.callHelpline', { number: helpline })}</Text>
            </Pressable>
          </View>
        ) : null}

        {list.length > 0 ? (
          <>
            <Text style={styles.section}>{t('help.common')}</Text>
            <View style={styles.faqCard}>
              {list.map((faq, index) => (
                <View key={faq.question} style={index < list.length - 1 && styles.faqDivider}>
                  <Pressable accessibilityRole="button" accessibilityState={{ expanded: open === index }} onPress={() => setOpen(open === index ? -1 : index)} style={styles.faqRow}>
                    <Text style={styles.faqQ}>{faq.question}</Text>
                    <Text style={styles.chev}>{open === index ? '−' : '+'}</Text>
                  </Pressable>
                  {open === index ? <Text style={styles.faqA}>{faq.answer}</Text> : null}
                </View>
              ))}
            </View>
          </>
        ) : null}

        <Pressable accessibilityRole="button" onPress={() => router.push('/my-reports')} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{t('help.myReports')}</Text>
            <Text style={styles.rowBody}>{t('help.myReportsBody')}</Text>
          </View>
        </Pressable>

        <Pressable accessibilityRole="button" onPress={() => router.push('/report')} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{t('help.report')}</Text>
            <Text style={styles.rowBody}>{t('help.reportBody')}</Text>
          </View>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 12 },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  topTitle: { flex: 1, textAlign: 'center', fontFamily: fontFamily.extrabold, fontSize: 18, color: colors.ink },
  content: { paddingHorizontal: 20, paddingTop: 2, paddingBottom: 32, gap: 12 },
  urgent: { backgroundColor: colors.chip.declined.bg, borderRadius: 20, padding: 16, gap: 8 },
  urgentHead: { fontFamily: fontFamily.extrabold, fontSize: 16, color: colors.chip.declined.fg },
  urgentBody: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 19, color: colors.chip.declined.fg },
  callBtn: { height: 48, borderRadius: 12, backgroundColor: colors.chip.declined.fg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4 },
  callText: { fontFamily: fontFamily.extrabold, fontSize: 15, color: '#fff' },
  section: { fontFamily: fontFamily.extrabold, fontSize: 15, color: colors.ink, marginTop: 4 },
  faqCard: { backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 16 },
  faqDivider: { borderBottomWidth: 1.5, borderBottomColor: '#E2ECE6' },
  faqRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14 },
  faqQ: { flex: 1, fontFamily: fontFamily.bold, fontSize: 14, color: colors.ink },
  chev: { fontFamily: fontFamily.extrabold, fontSize: 20, color: colors.green },
  faqA: { fontFamily: fontFamily.regular, fontSize: 13, lineHeight: 20, color: colors.ink, paddingBottom: 14 },
  row: { backgroundColor: '#fff', borderRadius: 20, padding: 16, flexDirection: 'row', alignItems: 'center' },
  rowTitle: { fontFamily: fontFamily.extrabold, fontSize: 15, color: colors.ink },
  rowBody: { fontFamily: fontFamily.semibold, fontSize: 12, lineHeight: 17, color: colors.muted, marginTop: 2 },
});
