import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CheckIcon } from '@/components/icons';
import { colors, fontFamily } from '@/theme';

// A short confirmation that floats over whatever screen is open ("Saved"), so a person who tapped Save always sees that it
// worked, wherever the form is scrolled to and with the keyboard open or closed. Call showToast() from anywhere; <ToastHost />
// is mounted once in the root layout.

type Toast = { id: number; text: string };
let listener: ((toast: Toast) => void) | null = null;
let counter = 0;

/** How long a toast stays on screen, in milliseconds. */
export const TOAST_MS = 2200;

export function showToast(text: string): void {
  counter += 1;
  listener?.({ id: counter, text });
}

export function ToastHost() {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<Toast | null>(null);
  const [progress] = useState(() => new Animated.Value(0));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    listener = (next) => {
      if (timer.current) clearTimeout(timer.current);
      setToast(next);
      // Android reads the alert role by itself (accessibilityLiveRegion); iOS needs the announcement
      if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(next.text);
      progress.stopAnimation();
      Animated.timing(progress, { toValue: 1, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      timer.current = setTimeout(() => {
        Animated.timing(progress, { toValue: 0, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
          if (finished) setToast((current) => (current?.id === next.id ? null : current));
        });
      }, TOAST_MS);
    };
    return () => {
      listener = null;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [progress]);

  if (!toast) return null;
  return (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top + 10 }]}>
      <Animated.View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[styles.pill, { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] }) }] }]}
      >
        <CheckIcon size={18} color="#fff" strokeWidth={2.6} />
        <Text style={styles.text}>{toast.text}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 100, elevation: 100 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    maxWidth: '92%',
    paddingHorizontal: 18,
    borderRadius: 22,
    backgroundColor: colors.greenDark,
    shadowColor: '#0B2A1D',
    shadowOpacity: 0.25,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  text: { flexShrink: 1, fontFamily: fontFamily.extrabold, fontSize: 14, color: '#fff' },
});
