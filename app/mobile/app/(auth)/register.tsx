import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '../../src/components/Button';
import { Icon } from '../../src/components/Icon';
import { Banner } from '../../src/components/Feedback';
import { PasswordField } from '../../src/components/PasswordField';
import { AuthShell, AuthCard } from '../../src/components/AuthShell';
import { colors, spacing, type, layout } from '../../src/theme';
import { useAuth } from '../../src/auth/AuthContext';

const MIN_PASSWORD = 8;
const emailValid = (e: string) => /^\S+@\S+\.\S+$/.test(e.trim());

/**
 * Worker sign-up (AUTH_FLOW §A2): email + password (≥8) + confirm → register →
 * creates a WORKER (isNewUser:true) and routes to the KYC stepper.
 */
export default function RegisterScreen() {
  const router = useRouter();
  const { register } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameOk = name.trim().length >= 2;
  const emailOk = emailValid(email);
  const passOk = password.length >= MIN_PASSWORD;
  const matchOk = confirm.length > 0 && confirm === password;
  const canSubmit = nameOk && emailOk && passOk && matchOk;

  async function onSubmit() {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      const isNewUser = await register(name, email, password);
      router.replace(isNewUser ? '/(auth)/kyc' : '/(tabs)/home');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create your account.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell watermarkSize={280}>
      <AuthCard title="Create account" onBack={() => router.back()}>
        <Text style={styles.lead}>
          Join Afrizone as a worker. You’ll verify your identity (KYC) right after.
        </Text>

        {error ? (
          <Banner tone="danger" icon="alert" title="Couldn’t sign up" message={error} />
        ) : null}

        <View style={styles.field}>
          <Text style={styles.label}>Full name</Text>
          <View style={styles.inputRow}>
            <Icon name="user" size={18} color={colors.textMuted} />
            <TextInput
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              autoComplete="name"
              textContentType="name"
              placeholder="Amaka Obi"
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              accessibilityLabel="Full name"
              autoFocus
            />
          </View>
          <Text style={styles.hint}>As it appears on your ID.</Text>
        </View>

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
          <Text style={styles.hint}>For receipts and tax statements.</Text>
        </View>

        <PasswordField
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="Create a password"
          hint={`At least ${MIN_PASSWORD} characters.`}
        />

        <PasswordField
          label="Confirm password"
          value={confirm}
          onChangeText={setConfirm}
          placeholder="Re-enter your password"
          error={confirm.length > 0 && !matchOk ? 'Passwords don’t match.' : undefined}
          onSubmitEditing={onSubmit}
          returnKeyType="go"
        />

        <Button
          label="Sign up"
          icon="chevron-right"
          onPress={onSubmit}
          loading={busy}
          disabled={!canSubmit || busy}
        />

        <Pressable onPress={() => router.back()} accessibilityRole="button" style={styles.altRow}>
          <Text style={styles.altText}>
            Already have an account? <Text style={styles.altLink}>Sign in →</Text>
          </Text>
        </Pressable>
      </AuthCard>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  lead: { color: colors.textMuted, fontSize: type.size.md, lineHeight: 22 },
  field: { gap: 6 },
  label: { color: colors.textMuted, fontSize: type.size.sm, fontWeight: '600' },
  hint: { color: colors.textMuted, fontSize: type.size.sm },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: layout.hitTarget,
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
  },
  input: { flex: 1, fontSize: type.size.md, color: colors.text, paddingVertical: spacing.sm },
  altRow: { alignItems: 'center', paddingVertical: spacing.sm },
  altText: { color: colors.textMuted, fontSize: type.size.base },
  altLink: { color: colors.clay, fontWeight: '700' },
});
