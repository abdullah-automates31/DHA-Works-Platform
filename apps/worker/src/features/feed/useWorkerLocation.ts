import { useEffect, useState } from 'react';

import type { Point } from './distance';

// The phone's location for the "Nearest" sort and the km filter. It asks once, only "while using the app", and only
// reads a rough position (balanced accuracy). Every failure (permission refused, location switched off, a build
// without the native module, a slow fix) simply gives `null`, and the feed falls back to the worker's chosen phases.
// expo-location is loaded lazily inside try/catch so an older build that lacks it cannot crash the screen.

type LocationModule = typeof import('expo-location');

function load(): LocationModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-location') as LocationModule;
  } catch {
    return null;
  }
}

export type LocationState = { point: Point | null; denied: boolean };

export function useWorkerLocation(enabled: boolean): LocationState {
  const [state, setState] = useState<LocationState>({ point: null, denied: false });

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void (async () => {
      try {
        const Location = load();
        if (!Location) return;
        let permission = await Location.getForegroundPermissionsAsync();
        if (!permission.granted && permission.canAskAgain) permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted) {
          if (active) setState({ point: null, denied: true });
          return;
        }
        const last = await Location.getLastKnownPositionAsync();
        if (last && active) setState({ point: { lat: last.coords.latitude, lng: last.coords.longitude }, denied: false });
        const fresh = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
        ]);
        if (fresh && active) setState({ point: { lat: fresh.coords.latitude, lng: fresh.coords.longitude }, denied: false });
      } catch {
        // keep whatever we have; the areas fallback covers the rest
      }
    })();
    return () => {
      active = false;
    };
  }, [enabled]);

  return state;
}
