import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radii, type } from '../theme';
import { Icon, IconName } from './Icon';

/**
 * The 6 canonical statuses (DESIGN_SPEC §1.3) — one color + word + icon
 * everywhere. Never color-alone (§7). `status` accepts the API enum-ish values
 * and maps to a canonical key.
 */
export type CanonicalStatus =
  | 'pending'
  | 'active'
  | 'review'
  | 'available'
  | 'paid'
  | 'rejected';

const MAP: Record<
  CanonicalStatus,
  { word: string; fg: string; bg: string; icon: IconName }
> = {
  pending: { word: 'Awaiting approval', fg: colors.pending, bg: colors.pendingSoft, icon: 'clock' },
  /* `fg` is the *ink* variant, not the fill, for the three statuses whose brand
     colour is illegible as 11–13px text on its own tint: Active shipped at
     1.64:1, Available at 2.86:1, Rejected at 3.65:1. Review and Paid already
     cleared AA on their own, so they keep their fills. */
  active: { word: 'In progress', fg: colors.goldInk, bg: colors.claySoft, icon: 'play' },
  review: { word: 'Under review', fg: colors.indigo, bg: colors.indigoSoft, icon: 'shield' },
  available: { word: 'Ready to withdraw', fg: colors.moneyInk, bg: colors.moneySoft, icon: 'check-circle' },
  paid: { word: 'Paid out', fg: colors.forest, bg: colors.forestSoft, icon: 'check' },
  rejected: { word: 'Needs attention', fg: colors.dangerInk, bg: colors.dangerSoft, icon: 'alert' },
};

/** Map raw API enum strings to a canonical status. */
export function toCanonical(raw: string): CanonicalStatus {
  switch (raw.toUpperCase()) {
    case 'APPLIED':
    case 'PENDING':
    case 'SUBMITTED':
      return 'pending';
    case 'ACTIVE':
    case 'OPEN':
      return 'active';
    case 'IN_REVIEW':
    case 'REVIEW':
      return 'review';
    case 'APPROVED':
    case 'AVAILABLE':
      return 'available';
    case 'RELEASED':
    case 'PAID':
    case 'WITHDRAWN':
    case 'FILLED':
      return 'paid';
    case 'REJECTED':
    case 'DISPUTED':
    case 'CLOSED':
      return 'rejected';
    default:
      return 'pending';
  }
}

interface StatusPillProps {
  status: CanonicalStatus | string;
  /** Override the displayed word. */
  label?: string;
  small?: boolean;
}

export function StatusPill({ status, label, small }: StatusPillProps) {
  const key = (status in MAP ? status : toCanonical(String(status))) as CanonicalStatus;
  const s = MAP[key];
  return (
    <View
      style={[styles.pill, { backgroundColor: s.bg }, small && styles.small]}
      accessibilityRole="text"
      accessibilityLabel={`Status: ${label ?? s.word}`}
    >
      <Icon name={s.icon} size={small ? 12 : 14} color={s.fg} strokeWidth={2.4} />
      <Text style={[styles.text, { color: s.fg, fontSize: small ? 11 : type.size.sm }]}>
        {label ?? s.word}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
  },
  small: { paddingVertical: 3, paddingHorizontal: 8 },
  text: { fontWeight: '600' },
});
