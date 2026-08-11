import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, TextInputProps } from 'react-native';
import { colors, spacing, radii, type, layout } from '../theme';
import { Icon } from './Icon';

interface PasswordFieldProps {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
  autoFocus?: boolean;
  autoComplete?: TextInputProps['autoComplete'];
  textContentType?: TextInputProps['textContentType'];
  onSubmitEditing?: () => void;
  returnKeyType?: TextInputProps['returnKeyType'];
  accessibilityLabel?: string;
}

/** Labeled password input with a lock icon and a show/hide (eye) toggle. */
export function PasswordField({
  label,
  value,
  onChangeText,
  placeholder = 'Password',
  hint,
  error,
  autoFocus,
  autoComplete,
  textContentType,
  onSubmitEditing,
  returnKeyType,
  accessibilityLabel,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputRow}>
        <Icon name="lock" size={18} color={colors.textMuted} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoComplete={autoComplete}
          textContentType={textContentType}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          accessibilityLabel={accessibilityLabel ?? label}
          autoFocus={autoFocus}
          onSubmitEditing={onSubmitEditing}
          returnKeyType={returnKeyType}
        />
        <Pressable
          onPress={() => setVisible((v) => !v)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={visible ? 'Hide password' : 'Show password'}
        >
          <Icon name={visible ? 'eye-off' : 'eye'} size={18} color={colors.textMuted} />
        </Pressable>
      </View>
      {error ? (
        <Text style={styles.errorHint}>{error}</Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { color: colors.textMuted, fontSize: type.size.sm, fontWeight: '600' },
  hint: { color: colors.textMuted, fontSize: type.size.sm },
  errorHint: { color: colors.danger, fontSize: type.size.sm },
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
});
