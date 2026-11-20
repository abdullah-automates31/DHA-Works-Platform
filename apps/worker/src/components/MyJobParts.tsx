import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  SEGMENTS,
  chipFor,
  initials,
  jobKind,
  primaryAction,
  progressSegments,
  shortName,
  visitLine,
  type JobKind,
  type MyJob,
  type TimelineStep,
} from '@/features/myjobs/rules';
import { formatRupees } from '@/features/home/format';
import { t } from '@/i18n';
import { colors, fontFamily } from '@/theme';

import { CheckIcon, UserIcon } from './icons';

// Pieces shared by W06 Home, W11 My jobs and W12 Job status (worker/screens/w-jobs.dc.html, w-status.dc.html).

export function StatusChip({ kind }: { kind: JobKind }) {
  const chip = chipFor(kind);
  return (
    <View style={[styles.chip, { backgroundColor: chip.bg }]}>
      <Text style={[styles.chipText, { color: chip.fg }]}>{chip.label}</Text>
    </View>
  );
}

/** Nine segments (.bar): the first n are green. Hidden when there is nothing to show. */
export function ProgressBar({ kind }: { kind: JobKind }) {
  const on = progressSegments(kind);
  if (on === 0) return null;
  return (
    <View style={styles.bar} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: SEGMENTS, now: on }}>
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <View key={i} style={[styles.segment, i < on && { backgroundColor: colors.green }]} />
      ))}
    </View>
  );
}

const TINTS = [
  { bg: '#F6E7B4', fg: '#5C4300' },
  { bg: '#D6E6F7', fg: '#17406B' },
];

export function Avatar({ name, index = 0, size = 32 }: { name: string | null; index?: number; size?: number }) {
  const tint = TINTS[index % 2] ?? TINTS[0]!;
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: tint.bg }]}>
      {name ? (
        <Text style={[styles.avatarText, { color: tint.fg, fontSize: size > 40 ? 14 : 11 }]}>{initials(name)}</Text>
      ) : (
        <UserIcon size={Math.round(size * 0.55)} color={tint.fg} />
      )}
    </View>
  );
}

/** "Hira F. · Phase 6" once the quote was accepted; "Customer · Phase 5" before (no name or lane is ever shown earlier). */
export function whoLine(job: MyJob): string {
  return job.residentName
    ? `${shortName(job.residentName)} · ${t('myjobs.phaseOnly', { phase: job.phase })}`
    : t('myjobs.customerPhase', { phase: job.phase });
}

/** One card of W11. No buttons: the whole card opens the job status screen (W12), where every action lives (create quote, start job, mark complete, record cash). */
// Memoised like FeedJobCard: the handler takes the job id and must be a stable function.
export const MyJobCard = memo(function MyJobCard({
  job,
  index,
  onOpen,
  now,
}: {
  job: MyJob;
  index: number;
  onOpen: (id: string) => void;
  now: Date;
}) {
  const kind = jobKind(job);
  // A rejected quote is a plain record: the card cannot be opened (and shows no details).
  const canOpen = kind !== 'not_chosen';
  const action = primaryAction(kind, job.cashRecorded === true);
  const visit = visitLine(job.scheduledStart, job.scheduledEnd, now);
  const won = job.residentName !== null;
  // One sentence for a screen reader: status, title, who and where, price and visit time.
  const label = [chipFor(kind).label, job.title, whoLine(job), job.myQuoteTotal !== null && kind !== 'interested' && kind !== 'not_chosen' ? formatRupees(job.myQuoteTotal) : '', kind === 'scheduled' ? visit : '']
    .filter(Boolean)
    .join('. ');

  return (
    <Pressable accessibilityRole={canOpen ? 'button' : 'text'} accessibilityLabel={label} onPress={() => onOpen(job.id)} disabled={!canOpen} style={styles.card}>
      <View style={styles.row}>
        <StatusChip kind={kind} />
        <Text style={styles.code}>{job.code}</Text>
      </View>
      <ProgressBar kind={kind} />
      <Text style={styles.title}>{job.title}</Text>

      {kind !== 'completed' ? (
        <View style={styles.who}>
          <Avatar name={won ? job.residentName : null} index={index} />
          <Text style={styles.whoText} numberOfLines={1}>
            {whoLine(job)}
          </Text>
          {job.myQuoteTotal !== null && kind !== 'interested' && kind !== 'not_chosen' ? (
            <Text style={styles.price}>{formatRupees(job.myQuoteTotal)}</Text>
          ) : null}
        </View>
      ) : null}

      {kind === 'scheduled' && visit ? (
        <View style={styles.visit}>
          <Text style={styles.visitText}>{visit}</Text>
        </View>
      ) : null}

      {kind === 'completed' && action === 'waiting' ? (
        <View style={styles.visit}>
          <Text style={styles.visitText}>{t('myjobs.cashRecordedWaiting')}</Text>
        </View>
      ) : null}
      {kind === 'completed' && action === 'record_cash' ? (
        <View style={styles.visit}>
          <Text style={styles.due}>{t('myjobs.dueInCash', { amount: formatRupees(job.myQuoteTotal ?? 0) })}</Text>
        </View>
      ) : null}
    </Pressable>
  );
});

/** The W12 timeline card: a dot per step, green and checked when done, gold when current, grey when still to come. */
export function TimelineCard({ steps }: { steps: TimelineStep[] }) {
  return (
    <View style={styles.timeline}>
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        const dot =
          step.state === 'done' ? colors.green : step.state === 'current' ? colors.gold : step.state === 'stop' ? colors.chip.declined.fg : '#D5E0D9';
        return (
          <View key={step.label} style={styles.step}>
            <View style={{ alignItems: 'center' }}>
              <View style={[styles.dot, { backgroundColor: dot }]}>
                {step.state === 'done' ? <CheckIcon size={13} color="#fff" strokeWidth={3} /> : null}
              </View>
              {!last ? <View style={[styles.line, step.state === 'done' && { backgroundColor: colors.green }]} /> : null}
            </View>
            <View style={{ flex: 1, paddingBottom: last ? 0 : 6 }}>
              <Text style={[styles.stepLabel, step.state === 'todo' && { color: colors.muted }]}>{step.label}</Text>
              {step.sub ? <Text style={styles.stepSub}>{step.sub}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { height: 26, paddingHorizontal: 10, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontFamily: fontFamily.bold, fontSize: 12 },
  bar: { flexDirection: 'row', gap: 3 },
  segment: { flex: 1, height: 6, borderRadius: 3, backgroundColor: '#D5E0D9' },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fontFamily.extrabold },
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 14, gap: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  code: { fontFamily: fontFamily.bold, fontSize: 12, color: colors.muted },
  title: { fontFamily: fontFamily.extrabold, fontSize: 16, color: colors.ink },
  who: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  whoText: { flex: 1, fontFamily: fontFamily.bold, fontSize: 13, color: colors.ink },
  price: { fontFamily: fontFamily.extrabold, fontSize: 14, color: colors.green },
  visit: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  visitText: { fontFamily: fontFamily.bold, fontSize: 13, color: colors.muted },
  due: { flex: 1, fontFamily: fontFamily.bold, fontSize: 13, color: colors.muted },
  timeline: { backgroundColor: '#fff', borderRadius: 20, paddingVertical: 14, paddingHorizontal: 16 },
  step: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  dot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  line: { width: 2, height: 22, backgroundColor: '#D5E0D9' },
  stepLabel: { fontFamily: fontFamily.extrabold, fontSize: 13, lineHeight: 18, color: colors.ink },
  stepSub: { fontFamily: fontFamily.semibold, fontSize: 12, color: colors.muted },
});
