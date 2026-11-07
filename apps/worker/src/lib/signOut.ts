import { unregisterThisDevice } from '@/features/push/device';

import { supabase } from './supabase';

/** Sign out on this phone. The push token is removed first, while the session can still call the server. */
export async function signOut(): Promise<void> {
  await unregisterThisDevice();
  await supabase.auth.signOut();
}
