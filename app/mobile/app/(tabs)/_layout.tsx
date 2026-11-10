import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, IconName } from '../../src/components/Icon';
import { obColors } from '../../src/onboarding/onboardingTheme';
import { useAuth } from '../../src/auth/AuthContext';

/**
 * The prototype's `.tab-bar`: a white strip under a hairline, and the active
 * tab marked by a short gold bar above its icon (`.tab .ind`, which carries
 * the same flat-left/rounded-right cut as the cards).
 */
function tabIcon(name: IconName) {
  return ({ color, focused }: { color: string; focused: boolean }) => (
    <View style={iconStyles.wrap}>
      <View style={[iconStyles.ind, focused && iconStyles.indActive]} />
      <Icon name={name} size={20} color={color} strokeWidth={1.9} />
    </View>
  );
}

const iconStyles = StyleSheet.create({
  wrap: { width: 40, height: 26, alignItems: 'center', justifyContent: 'flex-start' },
  ind: {
    width: 16,
    height: 3,
    marginBottom: 2,
    borderTopRightRadius: 3,
    borderBottomRightRadius: 3,
    backgroundColor: 'transparent',
  },
  indActive: { backgroundColor: obColors.goldDeep },
});

export default function TabsLayout() {
  // Bottom tabs normally add the safe-area inset themselves, but overriding
  // `height` opts out of that. Without this the Android gesture bar sits on top
  // of the labels: on a Pixel 8 it struck straight through "Wallet".
  const insets = useSafeAreaInsets();
  // Jobs is full-time/part-time listings, which don't fit a store owner -
  // hidden via href:null (keeps the route registered, just not a tab button)
  // rather than removed, so a direct link still works if one ever exists.
  // Home itself renders the store dashboard for this account type instead of
  // the worker task feed (see (tabs)/home.tsx) - no separate tab needed for it.
  const { user } = useAuth();
  const isStore = user?.accountType === 'STORE';
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Navy tints the active icon and label; the gold `ind` bar above the
        // icon is what actually reads as "you are here", exactly as the
        // prototype does it. The prototype tints the label itself gold-deep,
        // which is 2.5:1 on white - the same failure this bar already had once
        // with clay at 1.90:1 (see src/theme.ts). Navy is 17:1, and the gold
        // affordance survives in the bar, which is a graphic and not 10px type.
        tabBarActiveTintColor: obColors.navy,
        tabBarInactiveTintColor: obColors.textMut,
        tabBarStyle: {
          backgroundColor: obColors.white,
          // The prototype's hairline, not the lifted/shadowed bar this had
          // before - nothing else in the restyled app carries that shadow now.
          borderTopWidth: 1,
          borderTopColor: obColors.line,
          height: 70 + insets.bottom,
          paddingBottom: 10 + insets.bottom,
          paddingTop: 8,
        },
        // This pre-existed the polish pass, not something it introduced: the
        // icon+label column (tabBarStyle.height minus its padding) landed
        // exactly at the label's minimum content height with zero slack. RN
        // Web's numberOfLines={1} implements the clamp via `overflow: hidden`,
        // and per the flexbox spec `min-height: auto` does NOT protect a flex
        // item once overflow isn't `visible` - so the moment the column was a
        // pixel short (font metrics vary slightly by platform/browser),
        // flexbox shrank the label toward 0 instead of just clipping its tail,
        // truncating it to a few-pixel sliver. Fix is height budget, not the
        // label style: `70` (was 64) + a smaller icon wrap gives the column
        // real slack instead of an exact, fragile fit. Still true after the
        // restyle, with more room than before: the 26px wrap (3px bar + 2px +
        // a 20px icon) plus a 14px label line is 40px inside a 52px content
        // box, where it used to be 42. Keep the explicit lineHeight.
        tabBarLabelStyle: { fontSize: 10, lineHeight: 14, fontWeight: '700' },
      }}
    >
      <Tabs.Screen name="home" options={{ title: 'Home', tabBarIcon: tabIcon('home') }} />
      <Tabs.Screen name="tasks" options={{ title: 'My Tasks', tabBarIcon: tabIcon('list') }} />
      <Tabs.Screen name="wallet" options={{ title: 'Wallet', tabBarIcon: tabIcon('wallet') }} />
      <Tabs.Screen name="jobs" options={{ title: 'Find work', tabBarIcon: tabIcon('briefcase'), href: isStore ? null : undefined }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: tabIcon('user') }} />
    </Tabs>
  );
}
