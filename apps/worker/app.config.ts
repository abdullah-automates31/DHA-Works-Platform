import { existsSync } from 'node:fs';

import type { ExpoConfig } from 'expo/config';
import base from './app.base.json';
import { identityFor, resolveVariant } from './src/lib/appVariant.ts';

// One codebase, two builds. APP_VARIANT is set by the build profile in eas.json
// (development or production); unset means development. The backend (Supabase URL and key)
// comes from EXPO_PUBLIC_* values of the same environment. See docs/ENVIRONMENTS.md.
const variant = resolveVariant(process.env.APP_VARIANT);
const id = identityFor(variant);

// Firebase config for push (FCM): never committed. Local builds read ./google-services.json; EAS builds get the file
// from the GOOGLE_SERVICES_JSON file variable of their environment. One file serves both variants, because it lists
// every Android app of the Firebase project (pk.dhaworks.worker and pk.dhaworks.worker.dev).
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON ?? './google-services.json';
const hasGoogleServices = existsSync(googleServicesFile);
if (variant === 'production' && !hasGoogleServices) {
  throw new Error(`Production build without ${googleServicesFile}: push notifications would not work.`);
}
// iOS has one Firebase plist per bundle id. Not used for push yet (that needs APNs and an Apple Developer account);
// kept ready so the iOS build picks up the right one. EAS builds use GOOGLE_SERVICE_INFO_PLIST.
const googleServiceInfoPlist =
  process.env.GOOGLE_SERVICE_INFO_PLIST ??
  (variant === 'production' ? './GoogleService-Info.plist' : './GoogleService-Info.dev.plist');
const hasGoogleServiceInfoPlist = existsSync(googleServiceInfoPlist);

const config: ExpoConfig = {
  ...(base.expo as ExpoConfig),
  name: id.name,
  scheme: id.scheme,
  android: {
    ...(base.expo.android as ExpoConfig['android']),
    package: id.androidPackage,
    ...(hasGoogleServices ? { googleServicesFile } : {}),
  },
  ios: {
    bundleIdentifier: id.iosBundleId,
    ...(hasGoogleServiceInfoPlist ? { googleServicesFile: googleServiceInfoPlist } : {}),
    supportsTablet: false,
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  extra: { appVariant: variant },
};

export default config;
