import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Logo from '../../src/components/Logo';
import { obColors } from '../../src/onboarding/onboardingTheme';

/**
 * Front door of the auth flow. Navy, per explicit direction - reverting the
 * white/peach attempt, same call as Splash.tsx right before it (this is the
 * screen that shows immediately after Splash's ~1.1s hold, so a still-white
 * welcome screen is what "still white" was actually pointing at).
 *
 * This used to read from src/theme.ts with a comment warning that obColors
 * was the green AgriPlant palette and would clash here. That stopped being
 * true when obColors became the whole app's navy/gold palette: its `navy`
 * and `gold` are the same hex values this screen already used. The screen
 * looks as it did - the only changes are that the gradient's second stop and
 * the button label now match every other gold button in the app.
 */
export default function WelcomeScreen() {
  const router = useRouter();

  return (
    <View style={styles.root}>
      <View style={styles.center}>
        <Logo size={48} tone="dark" tagline overlap />
        <Text style={styles.title}>Let's get started!</Text>
      </View>

      <View style={styles.footer}>
        <Pressable onPress={() => router.push('/(auth)/login')} style={styles.primaryBtn}>
          <LinearGradient
            colors={[obColors.gold, obColors.goldDeep]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFillObject}
          />
          <Text style={styles.primaryBtnText}>Have an account? Sign in</Text>
        </Pressable>
        <Text style={styles.forgot} onPress={() => router.push('/(auth)/forgot')}>Forgot password?</Text>
        <Text style={styles.footnote}>
          Don't have an account?{' '}
          <Text style={styles.footnoteLink} onPress={() => router.push({ pathname: '/(auth)/phone', params: { accountType: 'INDIVIDUAL' } })}>Create account</Text>
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: obColors.navy,
    justifyContent: 'space-between',
    padding: 24,
    paddingTop: 80,
    paddingBottom: 32,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 },
  title: { fontSize: 22, fontFamily: 'Raleway_800ExtraBold', color: obColors.white, textAlign: 'center' },
  footer: { gap: 14 },
  primaryBtn: { minHeight: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  primaryBtnText: { fontFamily: 'Raleway_800ExtraBold', fontSize: 15, color: obColors.navyPress },
  forgot: { color: obColors.onNavyMuted, fontSize: 13, textAlign: 'center' },
  footnote: { color: obColors.onNavyMuted, fontSize: 13, textAlign: 'center' },
  footnoteLink: { color: obColors.gold, fontWeight: '700' },
});
