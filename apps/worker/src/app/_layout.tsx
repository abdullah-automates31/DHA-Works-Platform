import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { WebFrame } from '@/components/WebFrame';
import { showPushesInForeground } from '@/features/push/device';
import { AuthProvider, useAuth } from '@/lib/auth';
import { colors } from '@/theme';

void SplashScreen.preventAutoHideAsync();
showPushesInForeground();

function RootStack() {
  const { ready, session } = useAuth();
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  const loaded = ready && (fontsLoaded || fontError != null);

  useEffect(() => {
    // A font failure must not leave the app on the splash screen forever.
    if (loaded) void SplashScreen.hideAsync();
  }, [loaded]);

  if (!loaded) return null;

  const signedIn = session !== null;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.signIn.paper } }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="auto" />
        <WebFrame>
          <RootStack />
        </WebFrame>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
