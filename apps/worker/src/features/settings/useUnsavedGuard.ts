import { useNavigation } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';

import { t } from '@/i18n';

// Only the part of the navigation object this guard uses (expo-router's own typing does not list beforeRemove).
type GuardEvent = { preventDefault(): void; data: { action: unknown } };
type GuardNavigation = { addListener(type: 'beforeRemove', listener: (event: GuardEvent) => void): () => void; dispatch(action: unknown): void };

/**
 * Asks before the worker leaves a screen with changes they have not saved (back button, swipe or the phone's back key).
 * Pass `false` once the changes are saved, so leaving then is not questioned.
 */
export function useUnsavedGuard(dirty: boolean): void {
  const navigation = useNavigation() as unknown as GuardNavigation;
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    return navigation.addListener('beforeRemove', (event) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      Alert.alert(t('settings.unsavedTitle'), t('settings.unsavedBody'), [
        { text: t('settings.keepEditing'), style: 'cancel' },
        { text: t('settings.discard'), style: 'destructive', onPress: () => navigation.dispatch(event.data.action) },
      ]);
    });
  }, [navigation]);
}
