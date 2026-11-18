import React, { useState } from 'react';
import { StatePicker } from '../../src/components/StatePicker';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Icon } from '../../src/components/Icon';
import { Banner } from '../../src/components/Feedback';
import { ObScreen, ObField } from '../../src/onboarding/ObUI';
import { obColors } from '../../src/onboarding/onboardingTheme';
import { useAuth } from '../../src/auth/AuthContext';
import { useOnboarding } from '../../src/onboarding/OnboardingContext';

const emailValid = (e: string) => /^\S+@\S+\.\S+$/.test(e.trim());

/**
 * Onboarding screen 05, "Tell us about you". name+email, prefilled from
 * whatever the account already has.
 *
 * Two things the reference mock shows that this screen does not, both
 * checked before building: an avatar upload (no server field for a profile
 * photo exists anywhere in this app - api/types.ts and client.ts have none)
 * and a "Location" field (User.location is a real, read-only field returned
 * by the server, but there is no PATCH parameter anywhere to ever set it -
 * AuthContext.updateProfile only accepts name/email). Building either as a
 * working-looking control that saves nothing would be exactly the kind of
 * promise DESIGN_SPEC.md's "no dark patterns" principle rules out. The
 * circle below is decorative, matching the mock's visual weight without
 * claiming an upload that goes nowhere.
 */
export default function PersonalDetailsScreen() {
  const router = useRouter();
  const { user, updateProfile } = useAuth();
  const { state, update } = useOnboarding();

  const [name, setName] = useState(state.name || user?.name || '');
  const [email, setEmail] = useState(state.email || user?.email || '');
  const [home, setHome] = useState<string | null>((user as { state?: string | null } | null)?.state ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameOk = name.trim().length >= 2;
  const emailOk = emailValid(email);
  const canContinue = nameOk && emailOk && !!home;

  async function onContinue() {
    if (!canContinue || busy) return;
    setBusy(true);
    setError(null);
    try {
      await updateProfile({ name: name.trim(), email: email.trim(), state: home ?? undefined });
      update({ name: name.trim(), email: email.trim() });
      router.push('/(auth)/kyc-intro');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ObScreen
      onBack={() => router.back()}
      eyebrow="Individual · Step 2 of 2"
      title="Tell us about you"
      primaryLabel="Save & continue"
      onPrimary={onContinue}
      primaryDisabled={!canContinue || busy}
      primaryLoading={busy}
    >
      {error ? <Banner tone="danger" icon="alert" title="Couldn't save" message={error} /> : null}

      <View style={styles.avatarRow}>
        <View style={styles.avatar}>
          <Icon name="user" size={22} color={obColors.navy} />
          <View style={styles.avatarBadge}>
            <Icon name="edit" size={9} color={obColors.navyPress} />
          </View>
        </View>
      </View>

      <ObField label="Full name" value={name} onChangeText={setName} autoCapitalize="words" autoComplete="name" placeholder="Amaka Obi" autoFocus />
      <StatePicker value={home} onChange={setHome} />
      <ObField label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" placeholder="you@email.com" onSubmitEditing={onContinue} returnKeyType="go" />
    </ObScreen>
  );
}

const styles = StyleSheet.create({
  avatarRow: { alignItems: 'center', marginBottom: 4 },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: obColors.sand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBadge: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: obColors.gold,
    borderWidth: 2,
    borderColor: obColors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
