import React from 'react';
import { tierName } from '../lib/tiers';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radii } from '../theme';
import type { Tier } from '../api/types';

/**
 * Tier display names + tones. Tiers: Student/Dispatch/Remote/Promo/Trade.
 *
 * `color` is the *ink* variant wherever the brand fill is illegible as 11-12px
 * text on its own tint, which is the same correction StatusPill carries: raw
 * fills gave Dispatch 1.76:1, Promo 1.70:1 and Trade 3.01:1. Student and Remote
 * clear AA on their own fills, so they keep them.
 */
const TIER_META: Partial<Record<Tier, { label: string; color: string; bg: string }>> = {
  STUDENT: { label: 'Student', color: colors.indigo, bg: colors.indigoSoft },
  DISPATCH: { label: 'Dispatch', color: colors.goldInk, bg: colors.claySoft },
  REMOTE: { label: 'Remote', color: colors.forest, bg: colors.forestSoft },
  PROMO: { label: 'Promo', color: colors.goldInk, bg: colors.amberSoft },
  TRADE: { label: 'Trade', color: colors.moneyInk, bg: colors.moneySoft },
};

export function TierBadge({ tier, small }: { tier: Tier; small?: boolean }) {
  const m = TIER_META[tier] ?? { label: tierName(tier), color: colors.textMuted, bg: colors.surfaceSand };
  return (
    <View
      style={[styles.badge, { backgroundColor: m.bg }, small && styles.small]}
      accessibilityLabel={`Tier: ${m.label}`}
    >
      <Text style={[styles.text, { color: m.color, fontSize: small ? 11 : 12 }]}>{m.label}</Text>
    </View>
  );
}

export function tierLabel(tier: Tier): string {
  return TIER_META[tier]?.label ?? tierName(tier);
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: radii.pill,
  },
  small: { paddingVertical: 2, paddingHorizontal: 7 },
  text: { fontWeight: '700', letterSpacing: 0.2 },
});
