import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { registerThisDevice, registerToken } from './device';
import { pushDataOf, pushHref } from './rules.ts';

/**
 * For the signed-in app: keeps this phone registered for pushes and opens the right screen when one is tapped
 * (also when the tap started the app). [ready] waits until the profile gate knows which screens are allowed.
 */
export function usePushNotifications(ready: boolean): void {
  const router = useRouter();

  useEffect(() => {
    if (!ready || Platform.OS !== 'android') return;
    void registerThisDevice();
    const tokens = Notifications.addPushTokenListener((token) => {
      if (typeof token.data === 'string') void registerToken(token.data);
    });
    return () => tokens.remove();
  }, [ready]);

  useEffect(() => {
    if (!ready || Platform.OS !== 'android') return;
    const open = (response: Notifications.NotificationResponse) => {
      router.push(pushHref(pushDataOf(response)));
      Notifications.clearLastNotificationResponse();
    };
    // A tap that launched the app arrives before this listener exists.
    const launchedBy = Notifications.getLastNotificationResponse();
    if (launchedBy) open(launchedBy);
    const taps = Notifications.addNotificationResponseReceivedListener(open);
    return () => taps.remove();
  }, [ready, router]);
}
