import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import Logo from '../../src/components/Logo';
import { Button } from '../../src/components/Button';
import { GoogleButton } from '../../src/components/GoogleButton';
import { Banner } from '../../src/components/Feedback';
import { Icon } from '../../src/components/Icon';
import { PasswordField } from '../../src/components/PasswordField';
import { PatternDivider } from '../../src/components/Motif';
import { AuthShell, AuthCard } from '../../src/components/AuthShell';
import { colors, spacing, radii, type, layout, motif } from '../../src/theme';
import { useAuth } from '../../src/auth/AuthContext';
import { toE164, isValidNgNumber } from '../../src/lib/format';

const COUNTRY_PREFIX = '+234'; // Nigeria default

const emailValid = (e: string) => /^\S+@\S+\.\S+$/.test(e.trim());

/**
 * Worker sign-in HUB (AUTH_FLOW §A2): a single screen offering all three
 * methods — phone OTP, Google, and email+password — plus Sign up / Forgot
 * password links. Keeps the existing phone-entry step (collapsible) so the
 * passwordless OTP flow is fully preserved.
 *
 * On password sign-in: if the backend returns `requires2fa` we push the 2FA
 * screen; otherwise we route new/never-completed users to KYC and returning
 * users to the tabs.
 */
export default function LoginScreen() {
  const router = useRouter();
  const { requestOtp, loginPassword } = useAuth();

  // Phone OTP sub-step (kept from the original screen).
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [phoneBusy, setPhoneBusy] = useState(false);

  // Email + password.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const phoneOk = isValidNgNumber(phone);
  const canSignIn = emailValid(email) && password.length > 0;

  function routeAfterAuth(isNewUser: boolean) {
    router.replace(isNewUser ? '/(auth)/kyc' : '/(tabs)/home');
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
    <AuthShell watermarkSize={320}>
      <View style={styles.brand}>
        <Logo size={40} tone="dark" tagline />
      </View>

      <AuthCard>
        <Text style={styles.welcome}>Sign in</Text>
        <Text style={styles.welcomeSub}>Find tasks, get verified, get paid to your wallet.</Text>

        {error ? (
          <Banner tone="danger" icon="alert" title="Couldn’t continue" message={error} />
        ) : null}

        {/* ---- Phone OTP ---- */}
        {!phoneOpen ? (
          <Button
            label="Continue with phone"
            icon="phone"
            variant="secondary"
            onPress={() => {
              setError(null);
              setPhoneOpen(true);
            }}
          />
        ) : (
          <View style={styles.phoneBlock}>
            <Text style={styles.label}>Mobile number</Text>
            <View style={styles.phoneRow}>
              <View style={styles.prefix}>
                <Text style={styles.prefixText}>{COUNTRY_PREFIX}</Text>
              </View>
              <TextInput
                value={phone}
                onChangeText={(t) => setPhone(t.replace(/[^\d\s]/g, '').slice(0, 14))}
                keyboardType="phone-pad"
                autoComplete="tel"
                placeholder="803 000 0001"
                placeholderTextColor={colors.textFaint}
                style={styles.phoneInput}
                accessibilityLabel="Phone number"
                autoFocus
              />
            </View>
            <Button
              label="Send code"
              icon="chevron-right"
              onPress={onPhoneContinue}
              loading={phoneBusy}
              disabled={!phoneOk || phoneBusy}
            />
            <Text style={styles.hint}>By continuing you agree to our Terms & Privacy.</Text>
          </View>
        )}

        {/* ---- Google ---- */}
        <GoogleButton onSuccess={routeAfterAuth} onError={setError} />

        {/* ---- divider ---- */}
        <View style={styles.dividerRow}>
          <PatternDivider color={colors.line} opacity={motif.dividerOpacityLight} style={styles.dividerMotif} />
          <Text style={styles.dividerText}>or sign in with email</Text>
          <PatternDivider color={colors.line} opacity={motif.dividerOpacityLight} style={styles.dividerMotif} />
        </View>

        {/* ---- Email + password ---- */}
        <View style={styles.field}>
          <Text style={styles.label}>Email</Text>
          <View style={styles.inputRow}>
            <Icon name="mail" size={18} color={colors.textMuted} />
            <TextInput
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              placeholder="you@email.com"
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              accessibilityLabel="Email"
            />
          </View>
        </View>

        <PasswordField
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="Your password"
          autoComplete="password"
          onSubmitEditing={onSignIn}
          returnKeyType="go"
        />

        <Pressable
          onPress={() => router.push('/(auth)/forgot')}
          accessibilityRole="button"
          style={styles.forgotRow}
        >
          <Text style={styles.forgotText}>Forgot password?</Text>
        </Pressable>

        <Button
          label="Sign in"
          icon="chevron-right"
          onPress={onSignIn}
          loading={busy}
          disabled={!canSignIn || busy}
        />

        <Pressable
          onPress={() => router.push('/(auth)/register')}
          accessibilityRole="button"
          style={styles.altRow}
        >
          <Text style={styles.altText}>
            New to Afrizone? <Text style={styles.altLink}>Create an account →</Text>
          </Text>
        </Pressable>
      </AuthCard>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  brand: { alignItems: 'center' },
  welcome: { color: colors.text, fontSize: type.size.xl, fontWeight: '800', textAlign: 'center' },
  welcomeSub: {
    color: colors.textMuted,
    fontSize: type.size.base,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: -spacing.sm,
  },
  phoneBlock: { gap: spacing.md },
  field: { gap: 6 },
  label: { color: colors.textMuted, fontSize: type.size.sm, fontWeight: '600' },
  hint: { color: colors.textMuted, fontSize: type.size.sm },
  phoneRow: { flexDirection: 'row', gap: spacing.sm },
  prefix: {
    minHeight: layout.hitTarget,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceSand,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radii.input,
    alignItems: 'center',
    justifyContent: 'center',
  },
  prefixText: { color: colors.text, fontSize: type.size.md, fontWeight: '700' },
  phoneInput: {
    flex: 1,
    minHeight: layout.hitTarget,
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
    fontSize: type.size.md,
    color: colors.text,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: layout.hitTarget,
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
  },
  input: { flex: 1, fontSize: type.size.md, color: colors.text, paddingVertical: spacing.sm },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  dividerMotif: { flex: 1 },
  dividerText: { color: colors.textMuted, fontSize: type.size.sm },
  forgotRow: { alignSelf: 'flex-end', paddingVertical: spacing.xs },
  forgotText: { color: colors.clay, fontSize: type.size.base, fontWeight: '700' },
  altRow: { alignItems: 'center', paddingVertical: spacing.sm },
  altText: { color: colors.textMuted, fontSize: type.size.base },
  altLink: { color: colors.clay, fontWeight: '700' },
});
