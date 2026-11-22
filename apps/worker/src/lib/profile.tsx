import type { Database } from '@dha/supabase';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';

import { useAuth } from './auth';
import { supabase } from './supabase';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];
// Only what the worker app needs. CNIC and date of birth are read to pre-fill W02 and kept in memory only.
export type MyProfile = Pick<
  ProfileRow,
  | 'role'
  | 'verification_status'
  | 'verification_reason'
  | 'verification_updated_at'
  | 'account_status'
  | 'suspension_reason'
  | 'suspended_until'
  | 'full_name'
  | 'phone'
  | 'cnic'
  | 'gender'
  | 'date_of_birth'
  | 'avatar_path'
>;

const COLUMNS =
  'role, verification_status, verification_reason, verification_updated_at, account_status, suspension_reason, suspended_until, full_name, phone, cnic, gender, date_of_birth, avatar_path';

type ProfileState =
  | { status: 'loading' }
  | { status: 'error' } // could not reach the server; the caller offers a retry
  | { status: 'ready'; profile: MyProfile | null; areas: number[] }; // profile null = signed in but no row yet

type ProfileContextValue = { state: ProfileState; refresh: () => Promise<void> };

const ProfileContext = createContext<ProfileContextValue>({
  state: { status: 'loading' },
  refresh: async () => {},
});

async function fetchProfile(userId: string): Promise<ProfileState> {
  // RLS returns only the caller's own row, so no filter value could ever expose anyone else.
  const [profile, areas] = await Promise.all([
    supabase.from('profiles').select(COLUMNS).eq('id', userId).maybeSingle(),
    supabase.from('worker_areas').select('phase'),
  ]);
  if (profile.error || areas.error) return { status: 'error' };
  return { status: 'ready', profile: profile.data, areas: (areas.data ?? []).map((a) => a.phase) };
}

// Mount it with key={userId} so a different user always starts from 'loading' instead of the last user's data.
export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [state, setState] = useState<ProfileState>({ status: 'loading' });

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void fetchProfile(userId).then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const next = await fetchProfile(userId);
    // Only the first load may show the full-screen error. If a later refresh fails (a network blip after saving
    // areas or a document), keep what is already on screen instead of replacing the whole app with an error.
    setState((current) => (next.status === 'error' && current.status === 'ready' ? current : next));
  }, [userId]);

  // Suspension must take effect at once, not when the worker next opens a screen that reloads the profile. One channel for the
  // whole signed-in session (the one exception to "a channel only while its screen is in front", docs/PERFORMANCE.md): it
  // listens for this worker's own account notices only and reloads the profile, and the route gate then moves the worker to the
  // Suspended screen. Coming back to the app from the background reloads the profile too.
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`account-${userId}-${Math.random().toString(16).slice(2, 8)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (change) => {
        const type = (change.new as { type?: unknown } | null)?.type;
        if (type === 'account_suspended' || type === 'account_reactivated') void refresh();
      })
      .subscribe();
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh();
    });
    return () => {
      appState.remove();
      void supabase.removeChannel(channel);
    };
  }, [userId, refresh]);

  const value = useMemo(() => ({ state, refresh }), [state, refresh]);
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useMyProfile(): ProfileContextValue {
  return useContext(ProfileContext);
}
