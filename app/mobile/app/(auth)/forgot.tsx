import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '../../src/components/Button';
import { Icon } from '../../src/components/Icon';
import { Banner } from '../../src/components/Feedback';
import { SuccessCard } from '../../src/components/SuccessCard';
import { AuthShell, AuthCard } from '../../src/components/AuthShell';
import { colors, spacing, type, layout } from '../../src/theme';
import { useAuth } from '../../src/auth/AuthContext';

const emailValid = (e: string) => /^\S+@\S+\.\S+$/.test(e.trim());

/**
 * Forgot password (AUTH_FLOW §A2/§B). Enter an email → neutral confirmation
 * (no account enumeration). In sim/dev a `devToken` is returned; we surface it
 * with a link to the reset screen so the flow is testable end-to-end.
 */
export default function ForgotScreen() {
  const router = useRouter();
  const { passwordForgot } = useAuth();

  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [devToken, setDevToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    if (!emailValid(email) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await passwordForgot(email);
      setSent(true);
      setDevToken(res.devToken ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send a reset link.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell watermarkSize={280}>
      <AuthCard title="Forgot password" onBack={() => router.back()}>
        {sent ? (
          <SuccessCard
            title="Check your email"
            message="If an account exists for that email, we’ve sent a password reset link."
            actionLabel="Enter reset token"
            onAction={() =>
              router.replace({ pathname: '/(auth)/reset', params: { token: devToken ?? '' } })
            }
          >
            {devToken ? (
              <Banner tone="indigo" icon="key" title="Dev / sim mode" message={`Reset token: ${devToken}`} />
            ) : null}
          </SuccessCard>
        ) : (
          <>
            <Text style={styles.lead}>
              Enter the email on your account and we’ll send you a link to reset your password.
            </Text>

            {error ? (
              <Banner tone="danger" icon="alert" title="Couldn’t continue" message={error} />
            ) : null}

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
                  autoFocus
                  onSubmitEditing={onSubmit}
                  returnKeyType="go"
                />
              </View>
            </View>

            <Button
              label="Send reset link"
              icon="chevron-right"
              onPress={onSubmit}
              loading={busy}
              disabled={!emailValid(email) || busy}
            />
          </>
        )}

        {!sent && (
          <Pressable onPress={() => router.back()} accessibilityRole="button" style={styles.altRow}>
            <Text style={styles.altLink}>Back to sign in</Text>
          </Pressable>
        )}
      </AuthCard>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  lead: { color: colors.textMuted, fontSize: type.size.md, lineHeight: 22 },
  field: { gap: 6 },
  label: { color: colors.textMuted, fontSize: type.size.sm, fontWeight: '600' },
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
  altLink: { color: colors.clay, fontSize: type.size.base, fontWeight: '700' },
});
