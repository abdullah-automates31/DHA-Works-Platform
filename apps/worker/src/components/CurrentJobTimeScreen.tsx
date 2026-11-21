import { useEffect, useMemo, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronLeftIcon, ClockIcon, ToolIcon } from '@/components/icons';
import { BottomBar, FieldError } from '@/components/onboarding';
import type { JobInProgress } from '@/features/feed/useJobInProgress';
import { BUSY_CHIPS, busyEtaLabel, chipLabel, clockLabel, finishTimeLabel, parseBusyMinutes } from '@/features/quote/busy';
import { t } from '@/i18n';
import { colors, fontFamily } from '@/theme';

// W12d "Current job time": a full screen, shown after the worker has filled in the price, only when it is needed (the worker is
// in the middle of another job and the customer's visit is soon; features/quote/busy.ts, migration 0070). It shows the job
// in progress and the job waiting, asks how much longer the current job will take, and shows what the customer will read.
// "I will be free by <visit time>" is the quick answer for a worker who will be done in time.
export function CurrentJobTimeScreen({
  current,
  next,
  visitWhen,
  freeByMinutes,
  sending,
  error,
  onBack,
  onOpenCurrent,
  onSend,
}: {
  current: JobInProgress;
  next: { code: string; title: string; phase: number; when: string };
  visitWhen: string;
  freeByMinutes: number | null; // minutes from now to the visit (the "I will be free by" answer), null when unknown
  sending: boolean;
  error: string | null;
  onBack: () => void;
  onOpenCurrent: () => void;
  onSend: (minutes: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [freeBy, setFreeBy] = useState(false);
  const [touched, setTouched] = useState(false);
  const typed = parseBusyMinutes(text);
  const minutes = freeBy ? freeByMinutes : typed;
  const now = useMemo(() => new Date(), [text, freeBy]); // eslint-disable-line react-hooks/exhaustive-deps

  // the phone's back button returns to the price form, like the arrow
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  const send = () => {
    if (sending) return;
    setTouched(true);
    if (minutes !== null) onSend(minutes);
  };
  const started = clockLabel(current.startedAt);

  return (
    <View style={[StyleSheet.absoluteFill, styles.root]}>
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={onBack} style={styles.back}>
          <ChevronLeftIcon size={22} color={colors.greenDark} />
        </Pressable>
        <Text style={styles.topTitle}>{t('quote.ctTitle')}</Text>
        <View style={{ width: 44 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <View style={styles.card}>
            <Text style={styles.cap}>{t('quote.ctYourJob')}</Text>
            <View style={styles.row}>
              <View style={[styles.tile, { backgroundColor: '#E4DDF4' }]}>
                <ToolIcon size={20} color="#4B3A8C" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.jobTitle} numberOfLines={2}>
                  {current.title}
                </Text>
                <Text style={styles.jobSub}>
                  {[current.code, current.phase ? `Phase ${current.phase}` : '', started ? t('quote.ctStarted', { time: started }) : ''].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <View style={[styles.chip, { backgroundColor: '#E4DDF4' }]}>
                <Text style={[styles.chipText, { color: '#4B3A8C' }]}>{t('quote.ctInProgress')}</Text>
              </View>
            </View>

            <Text style={[styles.cap, { marginTop: 10 }]}>{t('quote.ctNextJob')}</Text>
            <View style={styles.row}>
              <View style={[styles.tile, { backgroundColor: colors.mint }]}>
                <ClockIcon size={20} color={colors.greenDark} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.jobTitle} numberOfLines={2}>
                  {next.title}
                </Text>
                <Text style={styles.jobSub}>{[next.code, `Phase ${next.phase}`, next.when].filter(Boolean).join(' · ')}</Text>
              </View>
              <View style={[styles.chip, { backgroundColor: colors.mint }]}>
                <Text style={[styles.chipText, { color: colors.greenDark }]}>{t('quote.ctWaiting')}</Text>
              </View>
            </View>
          </View>

          <Text style={styles.question}>{t('quote.busyQuestion')}</Text>
          <Text style={styles.honest}>{t('quote.ctNow', { time: finishTimeLabel(0, now) })}</Text>

          {freeByMinutes !== null ? (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected: freeBy }}
              onPress={() => {
                setFreeBy(true);
                setText('');
              }}
              style={[styles.freeBy, freeBy && styles.on]}
            >
              <Text style={[styles.freeByText, freeBy && { color: '#fff' }]}>{t('quote.ctFreeBy', { when: visitWhen })}</Text>
            </Pressable>
          ) : null}
          <View style={styles.chips}>
            {BUSY_CHIPS.map((m) => {
              const on = !freeBy && typed === m;
              return (
                <Pressable
                  key={m}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  onPress={() => {
                    setFreeBy(false);
                    setText(String(m));
                  }}
                  style={[styles.pill, on && styles.on]}
                >
                  <Text style={[styles.pillText, on && { color: '#fff' }]}>{chipLabel(m)}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>{t('quote.busyOrType')}</Text>
          <TextInput
            value={text}
            onChangeText={(v) => {
              setFreeBy(false);
              setText(v.replace(/[^0-9]/g, '').slice(0, 5));
            }}
            keyboardType="number-pad"
            placeholder="60"
            placeholderTextColor={colors.muted}
            maxLength={5}
            style={[styles.input, touched && minutes === null && styles.inputBad]}
            accessibilityLabel={t('quote.busyOrType')}
          />
          {touched && minutes === null ? <FieldError>{t('quote.errors.busyEta')}</FieldError> : null}

          {minutes !== null ? (
            <View style={styles.seeCard}>
              <Text style={styles.cap}>{t('quote.busyCustomerTitle')}</Text>
              <Text style={styles.seeBody}>{freeBy ? t('quote.busyYesCustomer') : t('quote.busyCustomerBody', { time: busyEtaLabel(minutes), at: finishTimeLabel(minutes, now) })}</Text>
            </View>
          ) : null}

          <View style={styles.note}>
            <Text style={styles.noteText}>
              {t('quote.busyCannotStart')}{' '}
              <Text onPress={onOpenCurrent} accessibilityRole="link" style={styles.link}>
                {t('quote.ctOpenCurrent')}
              </Text>
            </Text>
          </View>
          {error ? <FieldError>{error}</FieldError> : null}
        </ScrollView>
        <BottomBar hideArrow label={sending ? t('quote.ctSending') : t('quote.ctSend')} onPress={send} loading={sending} disabled={minutes === null} />
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  topTitle: { fontFamily: fontFamily.extrabold, fontSize: 18, color: colors.ink },
  content: { padding: 16, gap: 10, paddingBottom: 24 },
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 14, gap: 8 },
  cap: { fontFamily: fontFamily.bold, fontSize: 11, letterSpacing: 0.4, color: colors.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tile: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  jobTitle: { fontFamily: fontFamily.extrabold, fontSize: 15, color: colors.ink },
  jobSub: { fontFamily: fontFamily.semibold, fontSize: 11, color: colors.muted, marginTop: 1 },
  chip: { height: 26, paddingHorizontal: 10, borderRadius: 13, justifyContent: 'center' },
  chipText: { fontFamily: fontFamily.bold, fontSize: 11 },
  question: { fontFamily: fontFamily.extrabold, fontSize: 17, color: colors.ink, marginTop: 6 },
  honest: { fontFamily: fontFamily.semibold, fontSize: 12, color: colors.muted },
  freeBy: { minHeight: 44, borderRadius: 22, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16 },
  freeByText: { fontFamily: fontFamily.extrabold, fontSize: 14, color: colors.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { height: 40, paddingHorizontal: 18, borderRadius: 20, backgroundColor: '#fff', justifyContent: 'center' },
  pillText: { fontFamily: fontFamily.bold, fontSize: 13, color: colors.ink },
  on: { backgroundColor: colors.green },
  label: { fontFamily: fontFamily.bold, fontSize: 12, color: colors.muted, marginTop: 4 },
  input: { height: 50, borderRadius: 14, backgroundColor: '#fff', paddingHorizontal: 14, fontFamily: fontFamily.bold, fontSize: 17, color: colors.ink },
  inputBad: { borderWidth: 1.5, borderColor: colors.chip.declined.fg },
  seeCard: { backgroundColor: '#fff', borderRadius: 18, padding: 14, gap: 6, borderWidth: 1, borderColor: '#DDE6E0' },
  seeBody: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 19, color: colors.ink },
  note: { backgroundColor: colors.mint, borderRadius: 14, padding: 12 },
  noteText: { fontFamily: fontFamily.semibold, fontSize: 12, lineHeight: 17, color: colors.greenDark },
  link: { fontFamily: fontFamily.extrabold, textDecorationLine: 'underline', color: colors.greenDark },
});
