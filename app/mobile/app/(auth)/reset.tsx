import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Button } from '../../src/components/Button';
import { Icon } from '../../src/components/Icon';
import { Banner } from '../../src/components/Feedback';
import { PasswordField } from '../../src/components/PasswordField';
import { SuccessCard } from '../../src/components/SuccessCard';
import { AuthShell, AuthCard } from '../../src/components/AuthShell';
import { colors, spacing, type, layout } from '../../src/theme';
import { useAuth } from '../../src/auth/AuthContext';

const MIN_PASSWORD = 8;

/**
 * Reset password (AUTH_FLOW §A2/§B). Paste the reset token (prefilled from the
 * dev token when arriving from Forgot) + a new password (≥8) → passwordReset →
 * success → back to the sign-in hub.
 */
export default function ResetScreen() {
  const router = useRouter();
  const { passwordReset } = useAuth();
  const params = useLocalSearchParams<{ token?: string }>();

  const [token, setToken] = useState(typeof params.token === 'string' ? params.token : '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tokenOk = token.trim().length > 0;
  const passOk = password.length >= MIN_PASSWORD;
  const canSubmit = tokenOk && passOk;

  async function onSubmit() {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      await passwordReset(token, password);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reset your password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell watermarkSize={280}>
      <AuthCard title="Reset password" onBack={() => router.back()}>
        {done ? (
          <SuccessCard
            title="Password changed!"
            message="No hassle anymore — you can now sign in with your new password."
            actionLabel="Back to sign in"
            onAction={() => router.replace('/(auth)/login')}
          />
        ) : (
          <>
            <Text style={styles.lead}>
              Enter the reset token from your email and choose a new password.
            </Text>

            {error ? (
              <Banner tone="danger" icon="alert" title="Couldn’t reset" message={error} />
            ) : null}

            <View style={styles.field}>
              <Text style={styles.label}>Reset token</Text>
              <View style={styles.inputRow}>
                <Icon name="key" size={18} color={colors.textMuted} />
                <TextInput
                  value={token}
                  onChangeText={setToken}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="Paste your token"
                  placeholderTextColor={colors.textFaint}
                  style={styles.input}
                  accessibilityLabel="Reset token"
                />
              </View>
            </View>

            <PasswordField
              label="New password"
              value={password}
              onChangeText={setPassword}
              placeholder="New password"
              hint={`At least ${MIN_PASSWORD} characters.`}
              onSubmitEditing={onSubmit}
              returnKeyType="go"
            />

            <Button
              label="Set new password"
              icon="check"
              onPress={onSubmit}
              loading={busy}
              disabled={!canSubmit || busy}
            />
          </>
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
});
