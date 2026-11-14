import type { Database } from '@dha/supabase';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

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

  const value = useMemo(() => ({ state, refresh }), [state, refresh]);
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useMyProfile(): ProfileContextValue {
  return useContext(ProfileContext);
}
