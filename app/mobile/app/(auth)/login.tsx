import React, { useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { GoogleButton } from '../../src/components/GoogleButton';
import { Banner } from '../../src/components/Feedback';
import { ObScreen, ObField, ObPasswordField, ObButton } from '../../src/onboarding/ObUI';
import { obColors } from '../../src/onboarding/onboardingTheme';
import { useAuth } from '../../src/auth/AuthContext';
import { toE164, isValidNgNumber } from '../../src/lib/format';

const COUNTRY_PREFIX = '+234'; // Nigeria default
const emailValid = (e: string) => /^\S+@\S+\.\S+$/.test(e.trim());

/**
 * Worker sign-in: phone+OTP, Google, or email + password. Restyled to match
 * afrizone-onboarding-screens.html's flat peach/navy system, same as the
 * rest of the onboarding flow - this was the one screen still flagged as a
 * seam (welcome.tsx's "Sign In" led here into the old navy-hero look).
 *
 * On password sign-in: if the backend returns `requires2fa` we push the 2FA
 * screen; otherwise we route new/never-completed users to onboarding and
 * returning users to the tabs.
 */
export default function LoginScreen() {
  const router = useRouter();
  const { requestOtp, loginPassword } = useAuth();

  // Phone OTP entry (collapsible).
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [phoneBusy, setPhoneBusy] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phoneOk = isValidNgNumber(phone);
  const canSignIn = emailValid(email) && password.length > 0;

  function routeAfterAuth(isNewUser: boolean) {
    // Reached this screen without ever visiting account-type.tsx, so there is
    // no chosen account type to stash - INDIVIDUAL, OnboardingContext's own
    // default, is also the right one: nobody signs up as a Store or Courier
    // by way of the sign-IN screen's Google button.
    router.replace(isNewUser ? '/(auth)/personal-details' : '/(tabs)/home');
  }

  async function onPhoneContinue() {
    if (!phoneOk) {
      setError('Enter a valid Nigerian mobile number.');
      return;
    }
    setPhoneBusy(true);
    setError(null);
    const e164 = toE164(COUNTRY_PREFIX, phone);
    try {
      const res = await requestOtp(e164);
      router.push({
        pathname: '/(auth)/otp',
        params: { phone: e164, devCode: res.devCode ?? '' },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send a code.');
    } finally {
      setPhoneBusy(false);
    }
  }

  async function onSignIn() {
    if (!canSignIn || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await loginPassword(email, password);
      if (res.kind === '2fa') {
        router.push({
          pathname: '/(auth)/twofactor',
          params: { challenge: res.challenge },
        });
      } else {
        routeAfterAuth(res.isNewUser);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ObScreen
      onBack={() => router.back()}
      title="Login"
      subtitle="Welcome back, sign in to continue finding work"
      primaryLabel="Sign In"
      onPrimary={onSignIn}
      primaryDisabled={!canSignIn || busy}
      primaryLoading={busy}
      footnote={
        <Text style={styles.footnoteText}>
          Don't have an account? <Text style={styles.footnoteLink} onPress={() => router.push('/(auth)/register')}>Create account</Text>
        </Text>
      }
    >
      {error ? <Banner tone="danger" icon="alert" title="Couldn't sign in" message={error} /> : null}

      {!phoneOpen ? (
        <ObButton label="Continue with phone" variant="outline" onPress={() => { setError(null); setPhoneOpen(true); }} />
      ) : (
        <View style={styles.phoneBlock}>
          <ObField
            label="Mobile number"
            value={phone}
            onChangeText={(t) => setPhone(t.replace(/[^\d\s]/g, '').slice(0, 14))}
            keyboardType="phone-pad"
            autoComplete="tel"
            placeholder="803 000 0001"
            hint={`We'll text a code to ${COUNTRY_PREFIX} ${phone || '…'}`}
            autoFocus
          />
          <ObButton label="Send code" onPress={onPhoneContinue} loading={phoneBusy} disabled={!phoneOk || phoneBusy} />
        </View>
      )}

      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>Or login with</Text>
        <View style={styles.dividerLine} />
      </View>

      <GoogleButton onSuccess={routeAfterAuth} onError={setError} />
      <ObButton label="Continue with AfriZone" variant="outline" onPress={() => router.push('/(auth)/afrizone')} />

      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>or sign in with email</Text>
        <View style={styles.dividerLine} />
      </View>

      <ObField label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" placeholder="you@email.com" />
      <ObPasswordField label="Password" value={password} onChangeText={setPassword} placeholder="Your password" autoComplete="password" onSubmitEditing={onSignIn} returnKeyType="go" />

      <Text style={styles.forgotText} onPress={() => router.push('/(auth)/forgot')}>Forgot password?</Text>
    </ObScreen>
  );
}

const styles = StyleSheet.create({
  phoneBlock: { gap: 12 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dividerLine: { flex: 1, height: 1, backgroundColor: obColors.line },
  dividerText: { color: obColors.textMut, fontSize: 13 },
  forgotText: { color: obColors.goldDeep, fontSize: 13, fontWeight: '700', alignSelf: 'flex-end' },
  footnoteText: { color: obColors.textMut, fontSize: 13, textAlign: 'center' },
  footnoteLink: { color: obColors.goldDeep, fontWeight: '700' },
});
