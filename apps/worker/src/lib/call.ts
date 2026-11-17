import { Alert, Linking } from 'react-native';

import { t } from '@/i18n';

/** Opens the phone dialer with the number. If the device cannot place a call, says so and shows the number. */
export async function callPhone(phone: string): Promise<void> {
  try {
    await Linking.openURL('tel:' + phone);
  } catch {
    Alert.alert(t('myjobs.callFailedTitle'), t('myjobs.callFailedBody', { phone }));
  }
}
