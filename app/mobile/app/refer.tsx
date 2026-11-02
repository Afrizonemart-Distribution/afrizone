import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Share, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { AppBackHeader, AppErrorState, AppLoadingCards, AppPrimaryButton } from '../src/appui/AppUI';
import { Banner } from '../src/components/Feedback';
import { obColors, obRadii } from '../src/onboarding/onboardingTheme';
import { api, ApiError } from '../src/api/client';
import { useAsync } from '../src/lib/useAsync';
import { formatDate, formatNaira } from '../src/lib/format';
import type { ReferralSummary } from '../src/api/types';

/**
 * Refer and earn (server services/referrals.ts).
 *
 * The code first and large, because it is read aloud and typed on somebody
 * else's phone. Then what it pays, said honestly: when rewards are off the
 * screen says so rather than inviting people to refer for nothing. Then who
 * they have brought in, and - for a new Tasker who has not said yet - the box
 * to enter the code of whoever brought THEM in.
 */
export default function ReferScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const summary = useAsync<ReferralSummary>((signal) => api.myReferral(signal), []);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const s = summary.data;
  const paying = !!s && (s.rewards.taskerReward > 0 || s.rewards.storeReward > 0);

  async function share() {
    if (!s) return;
    await Share.share({
      message: `Join me on AfriZone PartTime and find paid work near you. Use my code ${s.code} when you sign up.`,
    });
  }

  async function claim() {
    setBusy(true);
    setError(null);
    try {
      await api.claimReferral(code.trim());
      setCode('');
      summary.reload();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Could not add that code.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 18, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={summary.loading && !!summary.data} onRefresh={summary.reload} tintColor={obColors.navy} />
        }
      >
        <AppBackHeader title="Refer and earn" onBack={() => router.back()} />

        {summary.loading && !s ? (
          <AppLoadingCards count={2} />
        ) : summary.error || !s ? (
          <AppErrorState message={summary.error ?? 'Could not load'} onRetry={summary.reload} />
        ) : (
          <>
            <View style={styles.codeCard}>
              <Text style={styles.codeLabel}>Your code</Text>
              <Text style={styles.code} selectable>
                {s.code}
              </Text>
              <AppPrimaryButton label="Share my code" icon="arrow-up" onPress={share} />
            </View>

            <Text style={styles.section}>What it pays</Text>
            <View style={styles.card}>
              {paying ? (
                <>
                  {s.rewards.taskerReward > 0 ? (
                    <Text style={styles.line}>
                      {formatNaira(s.rewards.taskerReward)} when someone you bring in is paid for their first job
                    </Text>
                  ) : null}
                  {s.rewards.storeReward > 0 ? (
                    <Text style={styles.line}>
                      {formatNaira(s.rewards.storeReward)} when a store you bring in is approved
                    </Text>
                  ) : null}
                  <Text style={styles.hint}>Paid into your wallet, less 5% tax. They enter your code when they join.</Text>
                </>
              ) : (
                <Text style={styles.line}>Referral rewards are not running just now. Your code still records who you bring in.</Text>
              )}
            </View>

            <Text style={styles.section}>People you brought in{s.earned > 0 ? ` · ${formatNaira(s.earned)} earned` : ''}</Text>
            <View style={styles.card}>
              {s.referrals.length === 0 ? (
                <Text style={styles.hint}>Nobody yet. Share your code with someone looking for work.</Text>
              ) : (
                s.referrals.map((r, i) => (
                  <View key={r.id} style={[styles.row, i < s.referrals.length - 1 && styles.rowDivider]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowName}>{r.name}</Text>
                      <Text style={styles.hint}>
                        {r.kind === 'STORE' ? 'Store' : 'Tasker'} · since {formatDate(r.createdAt)}
                      </Text>
                    </View>
                    <Text style={[styles.rowStatus, r.status === 'EARNED' && { color: obColors.mgreen }]}>
                      {r.status === 'EARNED'
                        ? `+${formatNaira(r.net)}`
                        : r.status === 'VOID'
                        ? 'Cancelled'
                        : r.kind === 'STORE'
                        ? 'Awaiting approval'
                        : 'Awaiting first job'}
                    </Text>
                  </View>
                ))
              )}
            </View>

            <Text style={styles.section}>Who referred you</Text>
            <View style={styles.card}>
              {s.referredBy ? (
                <Text style={styles.line}>{s.referredBy.name}</Text>
              ) : (
                <>
                  <Text style={styles.hint}>
                    If somebody sent you, enter their code. It can only be added before your first job.
                  </Text>
                  <TextInput
                    value={code}
                    onChangeText={(v) => setCode(v.toUpperCase())}
                    placeholder="Their code"
                    placeholderTextColor={obColors.textMut}
                    autoCapitalize="characters"
                    style={styles.input}
                    accessibilityLabel="Referral code"
                  />
                  {error ? <Banner tone="danger" title="Not added" message={error} /> : null}
                  <AppPrimaryButton label="Add code" variant="outline" onPress={claim} loading={busy} disabled={!code.trim()} />
                </>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: obColors.bg },
  codeCard: {
    backgroundColor: obColors.white,
    borderWidth: 1,
    borderColor: obColors.line,
    borderRadius: obRadii.card,
    padding: 18,
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  codeLabel: { fontSize: 12, color: obColors.textMut },
  code: { fontSize: 32, letterSpacing: 6, fontFamily: 'Raleway_800ExtraBold', color: obColors.navy },
  section: { fontSize: 15, fontFamily: 'Raleway_800ExtraBold', color: obColors.navy, marginTop: 20, marginBottom: 8 },
  card: { backgroundColor: obColors.white, borderWidth: 1, borderColor: obColors.line, borderRadius: obRadii.card, padding: 14, gap: 8 },
  line: { fontSize: 13.5, color: obColors.text, lineHeight: 20 },
  hint: { fontSize: 12, color: obColors.textMut, lineHeight: 17 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 10 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: obColors.line },
  rowName: { fontSize: 13.5, fontWeight: '700', color: obColors.text },
  rowStatus: { fontSize: 12.5, fontWeight: '700', color: obColors.textMut },
  input: {
    minHeight: 46,
    backgroundColor: obColors.bg,
    borderColor: obColors.line,
    borderWidth: 1,
    borderRadius: obRadii.field,
    paddingHorizontal: 14,
    fontSize: 16,
    letterSpacing: 3,
    color: obColors.text,
  },
});
