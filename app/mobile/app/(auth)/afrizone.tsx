import React, { useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Banner } from '../../src/components/Feedback';
import { ObScreen, ObField, ObPasswordField } from '../../src/onboarding/ObUI';
import { obColors } from '../../src/onboarding/onboardingTheme';
import { useAuth } from '../../src/auth/AuthContext';
import { afrizoneLogin, afrizoneMfa, afrizoneIdentityToken } from '../../src/lib/afrizone';

const emailValid = (e: string) => /^\S+@\S+\.\S+$/.test(e.trim());

/**
 * Continue with AfriZone: sign in with the account you shop with on
 * afrizonemart.com (app/AFRIZONE_ACCOUNT.md).
 *
 * Two stages on one screen: AfriZone email + password, then AfriZone's own
 * 2FA code if that account has it on. After that, Part-Time's own 2FA (if this
 * worker turned it on in Profile) is the usual twofactor screen.
 *
 * The password goes to AfriZone only. Part-Time never sees or stores it.
 */
export default function AfrizoneSignInScreen() {
  const router = useRouter();
  const { afrizoneSignIn } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = mfaToken ? code.trim().length >= 6 : emailValid(email) && password.length > 0;

  async function finish(accessToken: string) {
    const identityToken = await afrizoneIdentityToken(accessToken);
    const res = await afrizoneSignIn(identityToken);
    if (res.kind === '2fa') {
      router.replace({ pathname: '/(auth)/twofactor', params: { challenge: res.challenge } });
    } else {
      router.replace(res.isNewUser ? '/(auth)/personal-details' : '/(tabs)/home');
    }
  }

  async function onSubmit() {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mfaToken) {
        await finish(await afrizoneMfa(mfaToken, code));
        return;
      }
      const res = await afrizoneLogin(email, password);
      if (res.kind === 'mfa') {
        setMfaToken(res.mfaToken);
        setPassword('');
      } else {
        await finish(res.accessToken);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign you in.');
      if (mfaToken) setCode('');
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    setMfaToken(null);
    setCode('');
    setError(null);
  }

  return (
    <ObScreen
      onBack={() => (mfaToken ? startOver() : router.back())}
      eyebrow="AfriZone account"
      title={mfaToken ? 'Enter your AfriZone code' : 'Continue with AfriZone'}
      subtitle={
        mfaToken
          ? 'Your AfriZone account has two-step sign-in on. Enter the 6-digit code from your authenticator app, or a recovery code.'
          : 'Use the email and password you shop with on afrizonemart.com.'
      }
      primaryLabel={mfaToken ? 'Verify' : 'Continue'}
      onPrimary={onSubmit}
      primaryDisabled={!canSubmit || busy}
      primaryLoading={busy}
      footnote={
        <Text style={styles.footnote}>
          Signed up on AfriZone with your phone or Google? Use those options on the{' '}
          <Text style={styles.link} onPress={() => router.back()}>
            sign-in screen
          </Text>{' '}
          instead.
        </Text>
      }
    >
      {error ? <Banner tone="danger" icon="alert" title="Couldn't sign in" message={error} /> : null}

      {mfaToken ? (
        <ObField
          label="Code"
          value={code}
          onChangeText={(t) => setCode(t.replace(/\s/g, '').slice(0, 20))}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="one-time-code"
          keyboardType="default"
          placeholder="123456"
          autoFocus
          onSubmitEditing={onSubmit}
          returnKeyType="go"
          maxLength={20}
        />
      ) : (
        <>
          <ObField
            label="AfriZone email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            placeholder="you@email.com"
          />
          <ObPasswordField
            label="AfriZone password"
            value={password}
            onChangeText={setPassword}
            placeholder="Your AfriZone password"
            autoComplete="password"
            onSubmitEditing={onSubmit}
            returnKeyType="go"
          />
        </>
      )}
    </ObScreen>
  );
}

const styles = StyleSheet.create({
  footnote: { color: obColors.textMut, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  link: { color: obColors.goldDeep, fontWeight: '700' },
});
