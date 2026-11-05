import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { Icon, IconName } from '../components/Icon';
import { obColors, obRadii } from '../onboarding/onboardingTheme';
import { payLabel, formatDate, formatNaira } from '../lib/format';
import type { Task } from '../api/types';

/**
 * Restyled TaskCard matching the prototype's `.task-card` - same real
 * eligibility/locked logic as the original (src/components/TaskCard.tsx,
 * left untouched for screens not yet restyled), just the glyph+row layout
 * from the prototype instead of the tier-badge-topped card with a fill
 * progress bar. Slots/fill info folds into the tag row instead of a
 * separate bar, since the prototype's card has no equivalent - dropping
 * real capacity information entirely felt like the wrong trade either way.
 *
 * No tier badge in the foot row (the original card had one): categories are
 * free-text and often equal the tier name in practice ("Promo" tier,
 * "Promo" category), which rendered as a visibly duplicated tag. Category
 * alone is what the reference card shows anyway.
 */
export function categoryIcon(category: string, remote: boolean): IconName {
  if (remote) return 'globe';
  const c = category.toLowerCase();
  if (c.includes('deliver') || c.includes('dispatch')) return 'cart';
  if (c.includes('promo')) return 'star';
  if (c.includes('warehouse') || c.includes('store')) return 'briefcase';
  return 'briefcase';
}

export function AppTaskCard({ task, onPress }: { task: Task; onPress?: () => void }) {
  const remote = task.locationType === 'REMOTE';
  const filled = task.filledCount ?? 0;

  const el = task.eligibility;
  const locked = !!el && !el.eligible;
  const lockLine = locked
    ? el!.blockers.length === 1
      ? el!.blockers[0].message
      : `${el!.blockers.length} things needed before you can apply`
    : null;

  const pay = task.payModel === 'HOURLY' ? task.rate : task.budget ?? task.rate;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        locked
          ? `${task.title}, ${payLabel(task.payModel, task.rate, task.budget, task.unitLabel)}, locked: ${lockLine}`
          : `${task.title}, ${payLabel(task.payModel, task.rate, task.budget, task.unitLabel)}`
      }
      style={({ pressed }) => [styles.card, locked && styles.cardLocked, pressed && !locked && styles.pressed]}
    >
      <View style={styles.glyph}>
        <Icon name={categoryIcon(task.category, remote)} size={19} color={obColors.navy} />
      </View>
      <View style={styles.body}>
        <View style={styles.row1}>
          <Text style={styles.title} numberOfLines={2}>{task.title}</Text>
          <Text style={styles.pay} numberOfLines={1}>
            {formatNaira(pay)}
            <Text style={styles.payUnit}>{task.payModel === 'HOURLY' ? '/hr' : ''}</Text>
          </Text>
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {locked && lockLine ? lockLine : remote ? 'Remote' : task.address || 'On-site'}
          {!locked ? ` · Closes ${formatDate(task.deadline)}` : ''}
        </Text>
        <View style={styles.foot}>
          <Text style={styles.tag}>{task.category}</Text>
          {locked ? (
            <View style={styles.lockTag}>
              <Icon name="lock" size={10} color={obColors.textMut} />
              <Text style={styles.lockTagText}>Locked</Text>
            </View>
          ) : task.slots > 0 ? (
            <Text style={styles.tag}>{filled}/{task.slots} filled</Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: obColors.white,
    borderWidth: 1,
    borderColor: obColors.line,
    borderRadius: obRadii.card,
    borderTopRightRadius: obRadii.cardCut,
    padding: 14,
  },
  cardLocked: { opacity: 0.58 },
  pressed: { opacity: 0.85 },
  glyph: {
    width: 44,
    height: 44,
    borderRadius: 13,
    backgroundColor: obColors.sand,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  body: { flex: 1, minWidth: 0, gap: 3 },
  row1: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  title: { flex: 1, fontSize: 14, fontWeight: '700', color: obColors.text, lineHeight: 19 },
  pay: { fontSize: 14, fontWeight: '800', color: obColors.navy },
  payUnit: { fontSize: 11, fontWeight: '600', color: obColors.textMut },
  meta: { fontSize: 12, color: obColors.textMut },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' },
  tag: { fontSize: 10.5, fontWeight: '700', color: obColors.navy, backgroundColor: obColors.sand, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' },
  lockTag: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 3 },
  lockTagText: { fontSize: 10.5, fontWeight: '700', color: obColors.textMut },
});
