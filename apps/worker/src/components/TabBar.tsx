import type { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '@/i18n';
import { colors, fontFamily } from '@/theme';

import { BriefcaseIcon, HomeIcon, SearchIcon, UserIcon } from './icons';

// Bottom bar from the design: 78 high, white, a gold marker on top of the active tab (.tabs, .tb).
// The "Requests" tab of the mock is not here: direct requests are out of the MVP (docs/UI-UX.md section 8).
const ICONS = { home: HomeIcon, 'open-jobs': SearchIcon, 'my-jobs': BriefcaseIcon, profile: UserIcon } as const;
const LABELS = { home: 'tabs.home', 'open-jobs': 'tabs.openJobs', 'my-jobs': 'tabs.myJobs', profile: 'tabs.profile' } as const;
const INACTIVE = '#5B7366';

type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

export function TabBar({ state, navigateToTab }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    // The bar reaches under the system navigation bar (Android 15 draws edge to edge), so the labels sit in the
    // designed 70 high area above it: the inset is added to both the height and the bottom padding.
    <View style={[styles.bar, { height: 78 + insets.bottom, paddingBottom: 8 + insets.bottom }]}>
      {state.routes.map((route, index) => {
        const key = route.name as keyof typeof ICONS;
        const Icon = ICONS[key];
        if (!Icon) return null;
        const active = state.index === index;
        const color = active ? colors.green : INACTIVE;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => navigateToTab(route.key)}
            style={styles.tab}
          >
            {active ? <View style={styles.marker} /> : null}
            <Icon size={22} color={color} />
            <Text style={[styles.label, { color }]}>{t(LABELS[key])}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: '#fff', paddingHorizontal: 6, paddingBottom: 8 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  marker: { position: 'absolute', top: 0, width: 30, height: 4, borderBottomLeftRadius: 4, borderBottomRightRadius: 4, backgroundColor: colors.gold },
  label: { fontFamily: fontFamily.bold, fontSize: 11 },
});
