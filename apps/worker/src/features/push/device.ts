// This phone's push registration: the notification channel, the permission, and the FCM token stored against the
// signed-in worker (register_device_token / unregister_device_token). The send-push Edge Function sends through FCM.
//
// Android only for now. iOS needs APNs (an Apple Developer account); until then nothing is registered there.
// Expo Go cannot receive remote pushes (SDK 53+): use a development build. Every failure here is swallowed, because
// push must never block sign-in or sign-out.
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

import { t } from '@/i18n';
import { supabase } from '@/lib/supabase';

/** Must match the channel_id the send-push Edge Function puts on every message (and the plugin's defaultChannel). */
export const PUSH_CHANNEL_ID = 'job_updates';

const supported = Platform.OS === 'android';

/** Shows pushes that arrive while the app is open, like the ones Android draws while it is closed. */
export function showPushesInForeground(): void {
  if (!supported) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

async function deviceToken(): Promise<string | null> {
  const token = await Notifications.getDevicePushTokenAsync();
  return typeof token.data === 'string' && token.data ? token.data : null;
}

/** Channel, permission (asked once by Android 13+) and token registration. Safe to call on every app start. */
export async function registerThisDevice(): Promise<void> {
  if (!supported) return;
  try {
    await Notifications.setNotificationChannelAsync(PUSH_CHANNEL_ID, {
      name: t('push.channelName'),
      importance: AndroidImportance.HIGH,
    });
    // Registered even when the permission is refused: turning notifications on later in Settings then just works.
    await Notifications.requestPermissionsAsync();
    const token = await deviceToken();
    if (token) await registerToken(token);
  } catch {
    // Push is optional; the next app start tries again.
  }
}

export async function registerToken(token: string): Promise<void> {
  if (!supported) return;
  try {
    await supabase.rpc('register_device_token', { p_token: token, p_platform: 'android' });
  } catch {
    // Same as above.
  }
}

/** Removes this phone's token before signing out, so the next person on the phone gets no pushes for this account. */
export async function unregisterThisDevice(): Promise<void> {
  if (!supported) return;
  try {
    const token = await withTimeout(deviceToken(), 3000);
    if (token) await withTimeout(supabase.rpc('unregister_device_token', { p_token: token }), 3000);
  } catch {
    // Offline or slow: sign out anyway. The next sign-in on this phone moves the token to the new account.
  }
}

function withTimeout<T>(work: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    Promise.resolve(work).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
