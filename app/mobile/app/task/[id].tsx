import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, TextInput, ScrollView } from 'react-native';
import { directionsLabel, openDirections } from '../../src/lib/directions';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { AppBackHeader, AppMetaItem, AppPrimaryButton, AppLoadingCards, AppErrorState } from '../../src/appui/AppUI';
import { categoryIcon } from '../../src/appui/AppTaskCard';
import { Icon } from '../../src/components/Icon';
import { RequirementsCard } from '../../src/components/RequirementsCard';
import { Banner } from '../../src/components/Feedback';
import { obColors, obRadii } from '../../src/onboarding/onboardingTheme';
import { api, ApiError } from '../../src/api/client';
import { useAsync } from '../../src/lib/useAsync';
import { useAuth } from '../../src/auth/AuthContext';
import { payLabel, formatDate, formatNaira, netFromGross } from '../../src/lib/format';
import type { Blocker, Task } from '../../src/api/types';

/**
 * Restyled to match afrizone-mobile-prototype (1).html's Task detail screen
 * (hero block, big pay figure, meta strip, sticky Apply button). All real
 * fetching/refetch-on-focus, eligibility, applied-state and apply-sheet
 * logic below is unchanged from the previous version of this file.
 *
 * RequirementsCard (what's missing, what's already met, tap-to-fix routing)
 * is left as-is, on the old theme - same exception as CourierDeliveryBanner
 * on Home: real, substantial, shared logic that isn't worth duplicating
 * just to reskin, and it still reads fine dropped into the new shell.
 *
 * The prototype's meta-strip shows a distance figure and an org name -
 * neither exists on Task (no client-computed distance, no org/company
 * field), so this keeps the four real meta facts (Location, Closes, Slots,
 * Pay model) instead of inventing two fields that aren't there.
 */
export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [justApplied, setJustApplied] = useState(false);

  // REAL: GET /api/tasks/:id, which includes applications[] for this task.
  const task = useAsync<Task | null>((signal) => (id ? api.task(id, signal) : Promise.resolve(null)), [id]);

  useFocusEffect(
    React.useCallback(() => {
      task.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id])
  );

  const t = task.data;
  const remote = t?.locationType === 'REMOTE';
  const closed = t ? t.status !== 'OPEN' : false;
  const eligibility = t?.eligibility ?? null;
  const canApply = eligibility ? eligibility.eligible : true;
  const myApp = t?.applications?.find((a) => a.workerId === user?.id);
  const applied = justApplied || (myApp != null && myApp.status !== 'REJECTED');

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 18, paddingBottom: 110 }} showsVerticalScrollIndicator={false}>
        <AppBackHeader title="Task details" onBack={() => router.back()} />

        {task.loading && !task.data ? (
          <AppLoadingCards count={2} />
        ) : task.error ? (
          <AppErrorState message={task.error} onRetry={task.reload} />
        ) : !t ? (
          <AppErrorState message="Task not found." onRetry={task.reload} />
        ) : (
          <>
            <View style={styles.hero}>
              <Icon name={categoryIcon(t.category, remote)} size={40} color={obColors.navy} strokeWidth={1.5} />
            </View>

            <Text style={styles.title}>{t.title}</Text>
            <Text style={styles.pay}>{formatNaira(t.payModel === 'HOURLY' ? t.rate : t.budget ?? t.rate)}{t.payModel === 'HOURLY' ? '/hr' : ''}</Text>
            <Text style={styles.netHint}>
              ≈ net {formatNaira(netFromGross(t.payModel === 'HOURLY' ? t.rate ?? 0 : t.budget ?? 0))} after 5% WHT
            </Text>

            <View style={styles.metaStrip}>
              <AppMetaItem icon={remote ? 'globe' : 'map-pin'} label="Location" value={remote ? 'Remote' : t.address || 'On-site'} />
              <AppMetaItem icon="clock" label="Closes" value={formatDate(t.deadline)} />
              <AppMetaItem icon="list" label="Slots" value={`${Math.max(0, t.slots - (t.filledCount ?? 0))} of ${t.slots} left`} />
              <AppMetaItem icon="briefcase" label="Pay model" value={payLabel(t.payModel, t.rate, t.budget)} />
            </View>

            {!remote && t.lat != null && t.lng != null ? (
              <Pressable style={styles.directions} onPress={() => void openDirections({ lat: t.lat, lng: t.lng, address: t.address })} accessibilityRole="button">
                <Icon name="map-pin" size={14} color={obColors.goldDeep} />
                <Text style={styles.directionsText}>{directionsLabel.site}</Text>
                <Icon name="chevron-right" size={13} color={obColors.goldDeep} />
              </Pressable>
            ) : null}

            {!remote && t.geofenceRadius ? (
              <View style={styles.geofence}>
                <Icon name="map-pin" size={16} color={obColors.navy} />
                <Text style={styles.geofenceText}>Geofenced check-in within {t.geofenceRadius}m of the site.</Text>
              </View>
            ) : null}

            <Text style={styles.section}>About this task</Text>
            <Text style={styles.desc}>{t.description}</Text>

            <RequirementsCard requirements={t.requirements} eligibility={eligibility} />
          </>
        )}
      </ScrollView>

      {t && !task.loading ? (
        <View style={[styles.stickyCta, { paddingBottom: insets.bottom + 12 }]}>
          {applied ? (
            <AppPrimaryButton
              label={myApp?.status === 'APPROVED' ? 'Approved: see My Tasks' : 'Applied: awaiting approval'}
              icon={myApp?.status === 'APPROVED' ? 'check-circle' : 'check'}
              variant="outline"
              disabled
            />
          ) : closed ? (
            <AppPrimaryButton label="Applications closed" variant="outline" disabled />
          ) : (
            <AppPrimaryButton
              label={canApply ? 'Apply for this task' : 'Not yet - see what is needed'}
              icon="chevron-right"
              onPress={() => setSheetOpen(true)}
              disabled={!canApply}
            />
          )}
        </View>
      ) : null}

      {t ? (
        <ApplySheet
          visible={sheetOpen}
          task={t}
          onClose={() => setSheetOpen(false)}
          onApplied={() => {
            setJustApplied(true);
            setSheetOpen(false);
            router.push('/(tabs)/tasks');
          }}
        />
      ) : null}
    </View>
  );
}

function ApplySheet({ visible, task, onClose, onApplied }: { visible: boolean; task: Task; onClose: () => void; onApplied: () => void }) {
  const insets = useSafeAreaInsets();
  const [pitch, setPitch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<Blocker[]>([]);

  // A crew, when the task takes one (server services/crew.ts). The lead names
  // each person by phone and a share; whatever is left of the budget is the
  // lead's own, shown live so nobody submits a split they have not seen.
  const crewMax = task.payModel === 'FIXED' ? task.crewMax ?? 0 : 0;
  const [withCrew, setWithCrew] = useState(false);
  const [members, setMembers] = useState<{ phone: string; share: string }[]>([{ phone: '', share: '' }]);
  const budget = task.budget ?? 0;
  const membersTotal = members.reduce((sum, m) => sum + (Number(m.share) || 0), 0);
  const leadShare = budget - membersTotal;

  function setMember(i: number, key: 'phone' | 'share', value: string) {
    setMembers((prev) => prev.map((m, j) => (j === i ? { ...m, [key]: value } : m)));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setBlockers([]);
    try {
      const crew = withCrew
        ? {
            leadShare,
            members: members
              .filter((m) => m.phone.trim())
              .map((m) => ({ phone: m.phone.trim(), share: Number(m.share) || 0 })),
          }
        : undefined;
      // REAL: POST /api/applications {taskId, pitch, crew?}
      await api.apply(task.id, pitch.trim() || undefined, crew);
      onApplied();
    } catch (e) {
      const msg = e instanceof ApiError || e instanceof Error ? e.message : 'Could not submit application.';
      setError(msg);
      const body = e instanceof ApiError && e.body && typeof e.body === 'object' ? (e.body as { blockers?: Blocker[] }) : null;
      if (body?.blockers && body.blockers.length > 1) setBlockers(body.blockers);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.grabber} />
        <Text style={styles.sheetTitle}>Apply</Text>
        <Text style={styles.sheetSub}>Add a short pitch and your availability.</Text>
        <TextInput
          value={pitch}
          onChangeText={setPitch}
          multiline
          placeholder="Why you're a good fit, and when you're free…"
          placeholderTextColor={obColors.textMut}
          style={styles.pitch}
          accessibilityLabel="Pitch"
        />
        {crewMax >= 2 ? (
          <View style={styles.crewBox}>
            <Pressable
              onPress={() => setWithCrew((v) => !v)}
              style={styles.crewToggle}
              accessibilityRole="switch"
              accessibilityState={{ checked: withCrew }}
            >
              <Icon name={withCrew ? 'check-circle' : 'briefcase'} size={16} color={obColors.navy} />
              <Text style={styles.crewToggleText}>
                {withCrew ? 'Applying with a crew' : `Bring a crew (up to ${crewMax - 1} others)`}
              </Text>
            </Pressable>
            {withCrew ? (
              <>
                {members.map((m, i) => (
                  <View key={i} style={styles.crewRow}>
                    <TextInput
                      value={m.phone}
                      onChangeText={(v) => setMember(i, 'phone', v)}
                      placeholder="Their phone number"
                      placeholderTextColor={obColors.textMut}
                      keyboardType="phone-pad"
                      style={[styles.crewInput, { flex: 3 }]}
                      accessibilityLabel={`Crew member ${i + 1} phone`}
                    />
                    <TextInput
                      value={m.share}
                      onChangeText={(v) => setMember(i, 'share', v.replace(/[^0-9]/g, ''))}
                      placeholder="₦ share"
                      placeholderTextColor={obColors.textMut}
                      keyboardType="number-pad"
                      style={[styles.crewInput, { flex: 2 }]}
                      accessibilityLabel={`Crew member ${i + 1} share`}
                    />
                  </View>
                ))}
                {members.length < crewMax - 1 ? (
                  <Pressable onPress={() => setMembers((prev) => [...prev, { phone: '', share: '' }])} hitSlop={8}>
                    <Text style={styles.crewAdd}>+ Add another person</Text>
                  </Pressable>
                ) : null}
                <Text style={[styles.crewLead, leadShare <= 0 && { color: obColors.dangerInk }]}>
                  {leadShare > 0
                    ? `Your share: ${formatNaira(leadShare)} of ${formatNaira(budget)}`
                    : `The shares are more than the ${formatNaira(budget)} budget`}
                </Text>
                <Text style={styles.crewHint}>
                  Each person accepts their share in their own app before the team decides. Afrizone pays everyone directly.
                </Text>
              </>
            ) : null}
          </View>
        ) : null}
        {error ? <Banner tone="danger" title="Couldn't apply" message={error} /> : null}
        {blockers.length > 1
          ? blockers.slice(1).map((b, i) => (
              <Text key={`${b.code}-${b.ref ?? i}`} style={styles.blockerLine}>• {b.message}</Text>
            ))
          : null}
        <AppPrimaryButton
          label={withCrew ? 'Send to my crew' : 'Submit application'}
          onPress={submit}
          loading={busy}
          disabled={withCrew && leadShare <= 0}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: obColors.bg },
  hero: {
    height: 130,
    borderRadius: obRadii.card,
    borderTopRightRadius: obRadii.cardCut,
    backgroundColor: obColors.sand,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: { fontSize: 19, fontFamily: 'Raleway_800ExtraBold', color: obColors.navy, lineHeight: 25 },
  pay: { fontSize: 22, fontFamily: 'Raleway_800ExtraBold', color: obColors.navy, marginTop: 8 },
  netHint: { fontSize: 12.5, color: obColors.textMut, marginTop: 3 },
  metaStrip: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 14 },
  directions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 13,
    backgroundColor: obColors.white,
    borderWidth: 1,
    borderColor: obColors.line,
    borderRadius: obRadii.btn,
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  directionsText: { color: obColors.goldDeep, fontWeight: '700', fontSize: 12.5 },
  geofence: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 12, backgroundColor: obColors.sand, borderRadius: obRadii.card, padding: 12 },
  geofenceText: { flex: 1, color: obColors.text, fontSize: 12.5 },
  section: { fontSize: 15.5, fontFamily: 'Raleway_800ExtraBold', color: obColors.navy, marginTop: 20, marginBottom: 8 },
  desc: { fontSize: 14, color: obColors.text, lineHeight: 22 },
  stickyCta: { paddingHorizontal: 18, paddingTop: 10, backgroundColor: obColors.bg },
  backdrop: { flex: 1, backgroundColor: obColors.scrim },
  sheet: { backgroundColor: obColors.bg, borderTopLeftRadius: obRadii.hero, borderTopRightRadius: obRadii.hero, padding: 20, gap: 10 },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 4, backgroundColor: obColors.line, marginBottom: 8 },
  sheetTitle: { color: obColors.navy, fontSize: 18, fontFamily: 'Raleway_800ExtraBold' },
  sheetSub: { color: obColors.textMut, fontSize: 13 },
  pitch: {
    minHeight: 100,
    backgroundColor: obColors.white,
    borderColor: obColors.line,
    borderWidth: 1,
    borderRadius: obRadii.field,
    padding: 14,
    fontSize: 14,
    color: obColors.text,
    textAlignVertical: 'top',
  },
  crewBox: { backgroundColor: obColors.white, borderWidth: 1, borderColor: obColors.line, borderRadius: obRadii.field, padding: 12, gap: 8 },
  crewToggle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  crewToggleText: { fontSize: 13.5, fontWeight: '700', color: obColors.navy },
  crewRow: { flexDirection: 'row', gap: 8 },
  crewInput: { minHeight: 44, backgroundColor: obColors.bg, borderColor: obColors.line, borderWidth: 1, borderRadius: obRadii.field, paddingHorizontal: 12, fontSize: 14, color: obColors.text },
  crewAdd: { color: obColors.goldDeep, fontWeight: '700', fontSize: 12.5 },
  crewLead: { fontSize: 13, fontWeight: '700', color: obColors.text },
  crewHint: { fontSize: 11.5, color: obColors.textMut, lineHeight: 16 },
  blockerLine: { color: obColors.dangerInk, fontSize: 12.5, lineHeight: 18, marginTop: 2 },
});
