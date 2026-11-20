import { Image } from 'expo-image';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { categoryIconKey, timeAgo, whenPill } from '@/features/feed/format';
import type { FeedJob } from '@/features/feed/useFeed';
import { t } from '@/i18n';
import { stableCacheKey, stableSource } from '@/lib/image';
import { colors, fontFamily } from '@/theme';

import {
  ArrowRightIcon,
  BoltIcon,
  BrushIcon,
  ClockSmallIcon,
  FlameIcon,
  HammerIcon,
  SnowIcon,
  SparkleIcon,
  ToolIcon,
  WrenchIcon,
} from './icons';

// One card of W07 Open jobs (worker/screens/w-open.dc.html). Only what the open feed may show: no resident name,
// phone, plot or address, and the distance is only an estimate to the middle of the phase (features/feed/distance.ts).
const ICONS = { wrench: WrenchIcon, bolt: BoltIcon, snow: SnowIcon, hammer: HammerIcon, brush: BrushIcon, sparkle: SparkleIcon, flame: FlameIcon, tool: ToolIcon };
const RED = colors.chip.declined;
const PHOTO_TINTS = ['#CFE0D6', '#F6E7B4'];

// Memoised: the list re-renders when a page loads or the pull spinner flips, and the cards that did not change are skipped.
// So `onPress` must be one stable function that receives the job id, and `now` must stay the same between loads.
export const FeedJobCard = memo(function FeedJobCard({ job, onPress, now, distance }: { job: FeedJob; onPress: (id: string) => void; now: Date; distance?: string }) {
  const Icon = ICONS[categoryIconKey(job.categoryId)];
  const when = whenPill(job, now);
  const where = distance ? t('feed.whereKm', { phase: job.phase, km: distance }) : t('feed.where', { phase: job.phase });
  const urgent = job.urgency === 'asap';
  // One sentence for a screen reader: the card text is hidden behind this label, so it carries the details too.
  const label = [job.title, where, urgent ? t('feed.urgent') : t('feed.open'), when.text, timeAgo(job.postedAt, now)]
    .filter(Boolean)
    .join('. ');

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => onPress(job.id)} style={styles.card}>
      <View style={styles.head}>
        <View style={styles.iconTile}>
          <Icon size={22} color={colors.green} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={2}>
            {job.title}
          </Text>
          <Text style={styles.sub}>{where}</Text>
        </View>
        {urgent ? (
          <View style={[styles.chip, { backgroundColor: RED.bg }]}>
            <BoltIcon size={13} color={RED.fg} strokeWidth={2.6} />
            <Text style={[styles.chipText, { color: RED.fg }]}>{t('feed.urgent')}</Text>
          </View>
        ) : (
          <View style={[styles.chip, { backgroundColor: colors.mint }]}>
            <Text style={[styles.chipText, { color: colors.greenDark }]}>{t('feed.open')}</Text>
          </View>
        )}
      </View>

      {job.description ? (
        <Text style={styles.description} numberOfLines={2}>
          {job.description}
        </Text>
      ) : null}

      {when.text ? (
        <View style={[styles.when, { backgroundColor: when.urgent ? RED.bg : colors.background }]}>
          <ClockSmallIcon size={16} color={when.urgent ? RED.fg : colors.greenDark} />
          <Text style={[styles.whenText, { color: when.urgent ? RED.fg : colors.greenDark }]}>{when.text}</Text>
        </View>
      ) : null}

      <View style={styles.foot}>
        {job.photos.length > 0 ? (
          <View style={styles.photos}>
            {job.photos.map((uri, index) => (
              <Image
                key={stableCacheKey(uri)}
                source={stableSource(uri)}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={150}
                style={[styles.photo, { backgroundColor: PHOTO_TINTS[index % 2], marginLeft: index === 0 ? 0 : -8 }]}
                accessibilityLabel={t('feed.photo')}
              />
            ))}
          </View>
        ) : null}
        {job.hasVoiceNote ? (
          <View style={styles.voice}>
            <Text style={styles.voiceText}>{t('feed.voiceNote')}</Text>
          </View>
        ) : null}
        <Text style={styles.ago}>{timeAgo(job.postedAt, now)}</Text>
        <View style={styles.arrow}>
          <ArrowRightIcon size={18} color="#fff" />
        </View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 14, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconTile: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fontFamily.extrabold, fontSize: 16, lineHeight: 20, color: colors.ink },
  sub: { fontFamily: fontFamily.bold, fontSize: 12, color: colors.muted },
  chip: { height: 26, paddingHorizontal: 10, borderRadius: 13, flexDirection: 'row', alignItems: 'center', gap: 4 },
  chipText: { fontFamily: fontFamily.bold, fontSize: 12 },
  description: { fontFamily: fontFamily.regular, fontSize: 13, lineHeight: 19, color: colors.muted },
  when: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 12, paddingVertical: 7, paddingHorizontal: 10 },
  whenText: { fontFamily: fontFamily.bold, fontSize: 12 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  photos: { flexDirection: 'row' },
  photo: { width: 34, height: 34, borderRadius: 10, borderWidth: 2, borderColor: '#fff' },
  voice: { height: 26, paddingHorizontal: 10, borderRadius: 13, backgroundColor: colors.chip.wait.bg, justifyContent: 'center' },
  voiceText: { fontFamily: fontFamily.bold, fontSize: 12, color: colors.chip.wait.fg },
  ago: { flex: 1, fontFamily: fontFamily.bold, fontSize: 12, color: colors.muted },
  arrow: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
});
