import React, { useEffect, useRef, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';
import * as Linking from 'expo-linking';
import { useFonts, Raleway_500Medium, Raleway_700Bold, Raleway_800ExtraBold } from '@expo-google-fonts/raleway';
import { AuthProvider, useAuth } from '../src/auth/AuthContext';
import { homeRouteFor } from '../src/lib/accountType';
import { obColors } from '../src/onboarding/onboardingTheme';
import Splash from '../src/components/Splash';
import {
  configureNotificationHandler,
  registerPushToken,
  subscribeToTokenRefresh,
} from '../src/lib/notifications';
import { usePresenceHeartbeat } from '../src/lib/presence';

// Configure foreground notification display before any component mounts.
configureNotificationHandler();

/**
 * Listens for notification taps and routes to the relevant screen.
 * data.screen: "tasks" | "wallet" | "home" | "task" (+ data.id) | "kyc" | "disputes" | "deliveries" | "crew"
 */
function NotificationHandler() {
  const router = useRouter();
  const { user } = useAuth();
  const responseListener = useRef<Notifications.Subscription | null>(null);
  const tokenRegistered = useRef(false);

  // Register push token once per login session.
  useEffect(() => {
    if (!user || tokenRegistered.current) return;
    tokenRegistered.current = true;
    void registerPushToken();
  }, [user]);

  // Reset flag on logout so it re-registers on next login.
  useEffect(() => {
    if (!user) tokenRegistered.current = false;
  }, [user]);

  // Re-upload token whenever the app comes to foreground (tokens can rotate).
  useEffect(() => {
    if (!user) return;
    return subscribeToTokenRefresh();
  }, [user]);

  // Handle notification taps (works from background and killed state).
  useEffect(() => {
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data as Record<string, unknown>;
        const screen = data?.screen as string | undefined;
        const id = data?.id as string | undefined;

        if (!screen) return;

        switch (screen) {
          case 'tasks':
            router.push('/(tabs)/tasks');
            break;
          case 'wallet':
            router.push('/(tabs)/wallet');
            break;
          case 'task':
            if (id) router.push(`/task/${id}`);
            break;
          case 'kyc':
            router.push('/(auth)/kyc');
            break;
          case 'disputes':
            router.push('/disputes');
            break;
          // "You have been asked to join a crew" - answered on its own screen.
          case 'crew':
            router.push('/crew');
            break;
          // "A delivery is yours to take" - the window is two minutes, so this
          // goes straight to the offer rather than to home.
          case 'deliveries':
            router.push('/deliveries');
            break;
          default:
            router.push('/(tabs)/home');
        }
      }
    );

    return () => {
      responseListener.current?.remove();
    };
  }, [router]);

  return null;
}

/**
 * Handles password-reset deep links of the form:
 *   afrizone:///reset?token=<jwt>
 * The reset screen already reads params.token, so we just navigate there.
 */
/**
 * Keeps an online courier online while the app is open (src/lib/presence.ts).
 * Couriers only: nobody else is ranked, so nobody else sends a position.
 */
function PresenceHeartbeat() {
  const { user } = useAuth();
  usePresenceHeartbeat(user?.accountType === 'COURIER');
  return null;
}

function DeepLinkHandler() {
  const router = useRouter();
  const url = Linking.useURL();

  useEffect(() => {
    if (!url) return;
    const { path, queryParams } = Linking.parse(url);
    const token = queryParams?.token;
    if (
      typeof token === 'string' &&
      token.length > 0 &&
      (path === 'reset' || (typeof path === 'string' && path.endsWith('/reset')))
    ) {
      router.push({ pathname: '/(auth)/reset', params: { token } });
    }
  }, [url, router]);

  return null;
}

/**
 * Auth gate: shows the branded splash on boot, then routes. Signed-out users
 * land on the WELCOME carousel (the front door → Sign in); signed-in users go
 * to the tabs. The splash is held for a short minimum so it's actually visible.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  // Keep the splash up for a beat so it's perceptible (not a sub-second flash).
  const [minTimeUp, setMinTimeUp] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMinTimeUp(true), 1100);
    return () => clearTimeout(t);
  }, []);

  const booting = loading || !minTimeUp;

  useEffect(() => {
    if (booting) return;
    const inAuthGroup = segments[0] === '(auth)';
    // Authenticated users may still need the KYC stepper, so don't bounce them
    // off (auth)/kyc.
    // expo-router's typed `segments` tuple is only as wide as its route
    // manifest can statically prove; widen it here since we're just doing a
    // runtime string comparison on whatever segment happens to be present.
    const onKyc = inAuthGroup && (segments as string[])[1] === 'kyc';
    if (!user && !inAuthGroup) {
      // Front door for signed-out users → welcome carousel (→ Sign in).
      router.replace('/(auth)/welcome');
    } else if (user && inAuthGroup && !onKyc) {
      // Decided by the account type the SERVER returned, never by whatever was
      // tapped on the front-door picker. Someone who chose the wrong card there
      // lands where their account actually belongs rather than being stranded
      // or told off about it.
      router.replace(homeRouteFor(user.accountType) as never);
    }
  }, [user, booting, segments, router]);

  if (booting) {
    return <Splash />;
  }
  return <>{children}</>;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Raleway_500Medium, Raleway_700Bold, Raleway_800ExtraBold });

  if (!fontsLoaded) {
    return <Splash />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar style="dark" />
          <NotificationHandler />
          <PresenceHeartbeat />
          <DeepLinkHandler />
          <AuthGate>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: obColors.bg } }}>
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen
                name="task/[id]"
                options={{ presentation: 'card' }}
              />
              <Stack.Screen
                name="job/[id]"
                options={{ presentation: 'card' }}
              />
              <Stack.Screen name="active/[id]" />
              <Stack.Screen name="security" />
              <Stack.Screen name="support" options={{ presentation: 'card' }} />
              <Stack.Screen name="contract/[id]" options={{ presentation: 'card' }} />
              <Stack.Screen name="disputes" options={{ presentation: 'card' }} />
              <Stack.Screen name="ratings" options={{ presentation: 'card' }} />
              <Stack.Screen name="timesheets" options={{ presentation: 'card' }} />
              <Stack.Screen name="payment/[id]" options={{ presentation: 'card' }} />
            </Stack>
          </AuthGate>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
