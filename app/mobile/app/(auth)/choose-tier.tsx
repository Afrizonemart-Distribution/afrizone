import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Icon } from '../../src/components/Icon';
import { TierBadge } from '../../src/components/TierBadge';
import { ObScreen } from '../../src/onboarding/ObUI';
import { obColors } from '../../src/onboarding/onboardingTheme';
import { useOnboarding } from '../../src/onboarding/OnboardingContext';
import { useTiers } from '../../src/lib/tiers';
import type { Tier } from '../../src/api/types';

/**
 * Tier picker - not one of the 12 screens in afrizone-onboarding-screens.html,
 * but load-bearing (task eligibility is tier-gated) so it stays in the flow,
 * restyled to match everything around it. Same logic as before restyling.
 */
export default function ChooseTierScreen() {
  const router = useRouter();
  const { state, update } = useOnboarding();
  const tiers = useTiers();
  const [tier, setTier] = useState<Tier | null>(state.tier);

  function onContinue() {
    if (!tier) return;
    update({ tier });
    router.push('/(auth)/id-upload');
  }

  return (
    <ObScreen
      onBack={() => router.back()}
      eyebrow="Identity · 1 of 3"
      title="Choose your work tier"
      primaryLabel="Continue"
      onPrimary={onContinue}
      primaryDisabled={!tier}
    >
      {tiers.map((t) => {
        const active = tier === t.key;
        return (
          <Pressable
            key={t.key}
            onPress={() => setTier(t.key)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            style={[styles.card, active && styles.cardSel]}
          >
            <View style={styles.head}>
              <TierBadge tier={t.key} />
              {active ? <Icon name="check-circle" size={18} color={obColors.goldDeep} /> : null}
            </View>
            {t.description ? <Text style={styles.blurb}>{t.description}</Text> : null}
          </Pressable>
        );
      })}
    </ObScreen>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: obColors.white,
    borderWidth: 1.3,
    borderColor: obColors.line,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  cardSel: { borderColor: obColors.goldDeep, backgroundColor: obColors.roleSelectedBg },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  blurb: { color: obColors.textMut, fontSize: 13, lineHeight: 18 },
});
