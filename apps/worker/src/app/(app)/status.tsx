import { useState } from 'react';

import { PendingReview } from '@/components/PendingReview';
import { useLiveRefresh } from '@/features/live/useLiveRefresh';
import { TempScreen } from '@/components/TempScreen';
import { dateText } from '@/features/myreports/rules';
import { statusKind, type StatusKind } from '@/features/profile/routing';
import { t } from '@/i18n';
import { useMyProfile } from '@/lib/profile';

const COPY: Record<StatusKind, { title: Parameters<typeof t>[0]; body: Parameters<typeof t>[0] }> = {
  pending: { title: 'temp.status.pendingTitle', body: 'temp.status.pendingBody' },
  visit_hq: { title: 'temp.status.visitHqTitle', body: 'temp.status.visitHqBody' },
  rejected: { title: 'temp.status.rejectedTitle', body: 'temp.status.rejectedBody' },
  suspended: { title: 'temp.status.suspendedTitle', body: 'temp.status.suspendedBody' },
  wrong_role: { title: 'temp.status.wrongRoleTitle', body: 'temp.status.wrongRoleBody' },
};

// Temporary stand-in for the W04 variants (pending, visit HQ, rejected) and for states with no design
// (suspended, a customer or staff account). Shows the staff reason when there is one.
export default function StatusScreen() {
  const { state, refresh } = useMyProfile();
  const [checking, setChecking] = useState(false);
  const profile = state.status === 'ready' ? state.profile : null;
  const kind = statusKind(profile) ?? 'pending';

  // Staff decide in their own time; this reloads the profile so a decision shows without signing out and in.
  // When the status changes, the route gate in (app)/_layout moves the worker on by itself.
  async function check() {
    if (checking) return;
    setChecking(true);
    await refresh();
    setChecking(false);
  }

  // A decision (and a suspension or its end) arrives as a notification: reload at once, so the screen does not sit on "pending".
  useLiveRefresh(() => void check());

  if (kind === 'pending') {
    return <PendingReview sentAt={profile?.verification_updated_at ?? null} checking={checking} onCheck={() => void check()} />;
  }
  const showReason = kind === 'visit_hq' || kind === 'rejected' || kind === 'suspended';
  // A suspension shows the reason staff wrote and, when it has an end date, when the account opens again.
  const reason = kind === 'suspended' ? profile?.suspension_reason : profile?.verification_reason;
  const until = kind === 'suspended' ? dateText(profile?.suspended_until) : '';
  const body = until ? `${t(COPY[kind].body)} ${t('temp.status.suspendedUntil', { date: until })}` : t(COPY[kind].body);
  return (
    <TempScreen
      title={t(COPY[kind].title)}
      body={body}
      reason={showReason ? reason : null}
      reasonLabel={t('temp.status.reasonLabel')}
      action={kind === 'wrong_role' ? undefined : { label: t('temp.status.refresh'), onPress: () => void check(), loading: checking }}
    />
  );
}
