import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { AppBackHeader, AppEmptyState, AppErrorState, AppLoadingCards, AppPrimaryButton } from '../src/appui/AppUI';
import { Banner } from '../src/components/Feedback';
import { obColors, obRadii } from '../src/onboarding/onboardingTheme';
import { api, ApiError } from '../src/api/client';
import { useAsync } from '../src/lib/useAsync';
import { formatDate, formatNaira } from '../src/lib/format';
import type { CrewInvite } from '../src/api/types';

/**
 * Crews this Tasker has been asked to join (server services/crew.ts).
 *
 * Each card says who is asking, for what job, and the one figure that matters:
 * this person's own share. Nobody is put on a crew for an amount they did not
 * see here and say yes to. Declining withdraws the lead's whole application,
 * and the card says so before the button is pressed, because that is the
 * consequence a member would not otherwise guess.
 */
export default function CrewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const invites = useAsync<CrewInvite[]>((signal) => api.crewInvites(signal), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function answer(id: string, accept: boolean) {
    setBusy(`${id}:${accept}`);
    setError(null);
    try {
      await api.answerCrewInvite(id, accept);
      invites.reload();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Could not send your answer.');
    } finally {
      setBusy(null);
    }
  }

  const rows = invites.data ?? [];

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 18, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={invites.loading && !!invites.data} onRefresh={invites.reload} tintColor={obColors.navy} />
        }
      >
        <AppBackHeader title="Crew invites" onBack={() => router.back()} />
        <Text style={styles.subtitle}>Jobs another Tasker wants you on</Text>

        {error ? <Banner tone="danger" title="Something went wrong" message={error} /> : null}

        {invites.loading && !invites.data ? (
          <AppLoadingCards count={2} />
        ) : invites.error ? (
          <AppErrorState message={invites.error} onRetry={invites.reload} />
        ) : rows.length === 0 ? (
          <AppEmptyState
            icon="briefcase"
            title="No crew invites"
            message="When a lead Tasker asks you to join their crew for a job, it appears here."
          />
        ) : (
          rows.map((i) => (
            <View key={i.id} style={styles.card}>
              <Text style={styles.share}>{formatNaira(i.share)}</Text>
              <Text style={styles.shareHint}>
                Your share{i.task.budget ? ` of a ${formatNaira(i.task.budget)} job` : ''}, paid to you by Afrizone
              </Text>
              <Text style={styles.title}>{i.task.title}</Text>
              <Text style={styles.meta}>
                {i.lead.name} is leading · {formatDate(i.task.startDate)} to {formatDate(i.task.endDate)}
              </Text>
              {i.task.address ? <Text style={styles.meta}>{i.task.address}</Text> : null}

              {i.status === 'INVITED' ? (
                <>
                  <Text style={styles.note}>
                    If you decline, {i.lead.name}&apos;s application is withdrawn and they can apply again with someone else.
                  </Text>
                  <View style={styles.actions}>
                    <View style={{ flex: 1 }}>
                      <AppPrimaryButton
                        label="Decline"
                        variant="outline"
                        loading={busy === `${i.id}:false`}
                        disabled={busy !== null}
                        onPress={() => answer(i.id, false)}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <AppPrimaryButton
                        label="Accept"
                        loading={busy === `${i.id}:true`}
                        disabled={busy !== null}
                        onPress={() => answer(i.id, true)}
                      />
                    </View>
                  </View>
                </>
              ) : (
                <Text style={styles.accepted}>You accepted. Waiting for the team to approve the crew.</Text>
              )}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: obColors.bg },
  subtitle: { color: obColors.textMut, fontSize: 13, marginBottom: 16 },
  card: {
    backgroundColor: obColors.white,
    borderWidth: 1,
    borderColor: obColors.line,
    borderRadius: obRadii.card,
    padding: 16,
    marginBottom: 12,
  },
  share: { fontSize: 22, fontFamily: 'Raleway_800ExtraBold', color: obColors.navy },
  shareHint: { fontSize: 12, color: obColors.textMut, marginTop: 2 },
  title: { fontSize: 15, fontWeight: '700', color: obColors.text, marginTop: 12 },
  meta: { fontSize: 12.5, color: obColors.textMut, marginTop: 3 },
  note: { fontSize: 12, color: obColors.textMut, marginTop: 12, lineHeight: 17 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  accepted: { fontSize: 12.5, fontWeight: '700', color: obColors.mgreen, marginTop: 12 },
});
