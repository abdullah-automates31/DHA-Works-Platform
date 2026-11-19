import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import { AppState, Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card, LoadError, Notice, NavRow, SectionTitle, SettingsTop, ToggleRow, settingsStyles } from '@/components/SettingsParts';
import { DetailSkeleton, SkeletonGroup } from '@/components/Skeleton';
import { parsePrefs, savePref, type PrefClient, type PrefKey, type Prefs } from '@/features/settings/rules';
import { t } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { colors, fontFamily } from '@/theme';

// The typed client, narrowed to the two functions this screen calls.
const prefClient: PrefClient = {
  rpc: (fn, args) =>
    fn === 'set_job_reminders'
      ? supabase.rpc('set_job_reminders', args as { p_value: boolean })
      : supabase.rpc('set_notification_preference', args as { p_key: string; p_value: boolean }),
};

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; prefs: Prefs };

const ROWS: { key: PrefKey; title: string; hint: string }[] = [
  { key: 'new_jobs', title: 'settings.notificationsScreen.newJobs', hint: 'settings.notificationsScreen.newJobsHint' },
  { key: 'job_updates', title: 'settings.notificationsScreen.jobUpdates', hint: 'settings.notificationsScreen.jobUpdatesHint' },
  { key: 'job_reminders', title: 'settings.notificationsScreen.jobReminders', hint: 'settings.notificationsScreen.jobRemindersHint' },
  { key: 'report_updates', title: 'settings.notificationsScreen.reportUpdates', hint: 'settings.notificationsScreen.reportUpdatesHint' },
  { key: 'announcements', title: 'settings.notificationsScreen.announcements', hint: 'settings.notificationsScreen.announcementsHint' },
];

// Settings > Notifications. Every switch is stored on the worker's own row and enforced by the database before a push is
// sent (migration 0065, and 0058 for reminders). Each switch saves the moment it moves and goes back if the server says no.
export default function NotificationsSettingsScreen() {
  const [data, setData] = useState<Load>({ status: 'loading' });
  const [busy, setBusy] = useState<PrefKey | null>(null);
  const [error, setError] = useState(false);
  const [phoneOff, setPhoneOff] = useState(false);

  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void supabase
      .from('worker_details')
      .select('notify_new_jobs, notify_job_updates, job_reminders, notify_report_updates, notify_announcements')
      .maybeSingle()
      .then(({ data: row, error: loadError }) => {
        if (!active) return;
        if (loadError) setData((current) => (current.status === 'ready' ? current : { status: 'error' }));
        else setData({ status: 'ready', prefs: parsePrefs(row) });
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  const retry = () => {
    setData({ status: 'loading' });
    setAttempt((n) => n + 1);
  };

  // Whether Android is allowed to show this app's notifications at all (the phone's own switch).
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const check = () => {
      void Notifications.getPermissionsAsync()
        .then((p) => setPhoneOff(!p.granted))
        .catch(() => undefined);
    };
    check();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
    return () => sub.remove();
  }, []);

  async function onChange(key: PrefKey, value: boolean) {
    if (data.status !== 'ready' || busy) return;
    setError(false);
    setBusy(key);
    setData({ status: 'ready', prefs: { ...data.prefs, [key]: value } });
    const ok = await savePref(prefClient, key, value);
    if (!ok) {
      setData((current) => (current.status === 'ready' ? { status: 'ready', prefs: { ...current.prefs, [key]: !value } } : current));
      setError(true);
    }
    setBusy(null);
  }

  return (
    <View style={settingsStyles.root}>
      <SettingsTop title={t('settings.notifications')} />
      {data.status === 'loading' ? (
        <SkeletonGroup>
          <DetailSkeleton />
        </SkeletonGroup>
      ) : null}
      {data.status === 'error' ? <LoadError onRetry={retry} /> : null}
      {data.status === 'ready' ? (
        <ScrollView contentContainerStyle={settingsStyles.content}>
          <Text style={settingsStyles.body}>{t('settings.notificationsScreen.intro')}</Text>
          {phoneOff ? (
            <View style={styles.phoneOff}>
              <Text style={styles.phoneOffText}>{t('settings.notificationsScreen.phoneOff')}</Text>
              <NavRow title={t('settings.notificationsScreen.openPhoneSettings')} onPress={() => void Linking.openSettings()} />
            </View>
          ) : null}
          <Card>
            {ROWS.map((row, index) => (
              <ToggleRow
                key={row.key}
                title={t(row.title as never)}
                hint={t(row.hint as never)}
                value={data.prefs[row.key]}
                busy={busy === row.key}
                onChange={(next) => void onChange(row.key, next)}
                divider={index < ROWS.length - 1}
              />
            ))}
          </Card>
          {error ? <Notice kind="error">{t('settings.errors.generic')}</Notice> : null}
          <SectionTitle>{t('settings.notificationsScreen.alwaysTitle')}</SectionTitle>
          <Text style={settingsStyles.body}>{t('settings.notificationsScreen.alwaysBody')}</Text>
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  phoneOff: { backgroundColor: colors.chip.wait.bg, borderRadius: 18, paddingHorizontal: 14, paddingTop: 12, gap: 2 },
  phoneOffText: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 19, color: colors.chip.wait.fg },
});
