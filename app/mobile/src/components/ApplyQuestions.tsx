/**
 * The task's own questions, in the apply sheet (server: services/taskQuestions.ts).
 * Values are kept as the server wants them: text as strings, YES_NO as a
 * boolean, NUMBER as the typed string (the server reads it as a number).
 */
import React from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { obColors, obRadii } from '../onboarding/onboardingTheme';
import type { TaskQuestion } from '../api/types';

export type AnswerValues = Record<string, string | boolean>;

/** The first required question left blank, or null when the form can be sent. */
export function missingAnswer(questions: TaskQuestion[], values: AnswerValues): TaskQuestion | null {
  for (const q of questions) {
    if (!q.required) continue;
    const v = values[q.id];
    if (v === undefined || (typeof v === 'string' && v.trim() === '')) return q;
  }
  return null;
}

export function ApplyQuestions({
  questions,
  values,
  onChange,
}: {
  questions: TaskQuestion[];
  values: AnswerValues;
  onChange: (id: string, v: string | boolean) => void;
}) {
  if (questions.length === 0) return null;
  return (
    <View style={{ gap: 14 }}>
      {questions.map((q) => {
        const v = values[q.id];
        return (
          <View key={q.id} style={{ gap: 6 }}>
            <Text style={styles.label}>
              {q.label}
              {q.required ? <Text style={styles.req}> *</Text> : <Text style={styles.opt}> (optional)</Text>}
            </Text>
            {q.type === 'YES_NO' ? (
              <View style={styles.row}>
                {[true, false].map((b) => (
                  <Pill key={String(b)} label={b ? 'Yes' : 'No'} on={v === b} onPress={() => onChange(q.id, b)} />
                ))}
              </View>
            ) : q.type === 'CHOICE' ? (
              <View style={[styles.row, { flexWrap: 'wrap' }]}>
                {(q.options ?? []).map((o) => (
                  <Pill key={o} label={o} on={v === o} onPress={() => onChange(q.id, o)} />
                ))}
              </View>
            ) : (
              <TextInput
                value={typeof v === 'string' ? v : ''}
                onChangeText={(t) => onChange(q.id, q.type === 'NUMBER' ? t.replace(/[^0-9.\-]/g, '') : t)}
                multiline={q.type === 'LONG_TEXT'}
                keyboardType={q.type === 'NUMBER' ? 'decimal-pad' : q.type === 'LINK' ? 'url' : 'default'}
                autoCapitalize={q.type === 'LINK' ? 'none' : 'sentences'}
                autoCorrect={q.type !== 'LINK'}
                placeholder={q.type === 'LINK' ? 'https://' : ''}
                placeholderTextColor={obColors.textMut}
                maxLength={q.type === 'LONG_TEXT' ? 3000 : 500}
                style={[styles.input, q.type === 'LONG_TEXT' && styles.long]}
                accessibilityLabel={q.label}
              />
            )}
          </View>
        );
      })}
    </View>
  );
}

function Pill({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.pill, on && styles.pillOn]}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
    >
      <Text style={[styles.pillText, on && styles.pillTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13.5, fontWeight: '700', color: obColors.navy },
  req: { color: obColors.dangerInk },
  opt: { color: obColors.textMut, fontWeight: '400' },
  row: { flexDirection: 'row', gap: 8 },
  input: {
    minHeight: 44,
    backgroundColor: obColors.white,
    borderColor: obColors.line,
    borderWidth: 1,
    borderRadius: obRadii.field,
    paddingHorizontal: 12,
    fontSize: 14,
    color: obColors.text,
  },
  long: { minHeight: 90, paddingTop: 10, textAlignVertical: 'top' },
  pill: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: obColors.line,
    backgroundColor: obColors.white,
  },
  pillOn: { backgroundColor: obColors.navy, borderColor: obColors.navy },
  pillText: { fontSize: 13, color: obColors.navy, fontWeight: '600' },
  pillTextOn: { color: obColors.white },
});
