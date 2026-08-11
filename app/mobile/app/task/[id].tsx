import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, TextInput, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { Card } from '../../src/components/Card';
import { Button } from '../../src/components/Button';
import { Icon } from '../../src/components/Icon';
import { TierBadge } from '../../src/components/TierBadge';
import { MoneyText } from '../../src/components/MoneyText';
import { Banner, LoadingState, ErrorState } from '../../src/components/Feedback';
import { colors, spacing, type, radii, layout } from '../../src/theme';
import { api, ApiError } from '../../src/api/client';
import { useAsync } from '../../src/lib/useAsync';
import { useAuth } from '../../src/auth/AuthContext';
import { payLabel, formatDate, netFromGross } from '../../src/lib/format';
import type { Task } from '../../src/api/types';

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [justApplied, setJustApplied] = useState(false);

  // REAL: GET /api/tasks/:id — includes applications[] for this task.
  const task = useAsync<Task | null>(
    (signal) => (id ? api.task(id, signal) : Promise.resolve(null)),
    [id]
  );

  const t = task.data;
  const remote = t?.locationType === 'REMOTE';
  const tierEligible = t ? (user?.tiers ?? []).includes(t.tier) : false;
  const kycOk = user?.kycStatus === 'TIER_APPROVED';
  const closed = t ? t.status !== 'OPEN' : false;

  // Check server-side application state so "Apply" button reflects reality on fresh load.
  const myApp = t?.applications?.find((a) => a.workerId === user?.id);
  const applied = justApplied || (myApp != null && myApp.status !== 'REJECTED');

  return (
    <Screen title="Task" back scroll>
      {task.loading && !task.data ? (
        <LoadingState />
      ) : task.error ? (
        <ErrorState message={task.error} onRetry={task.reload} />
      ) : !t ? (
        <ErrorState message="Task not found." />
      ) : (
        <>
          <View style={styles.headRow}>
            <TierBadge tier={t.tier} />
            <Text style={styles.category}>{t.category}</Text>
          </View>
          <Text style={styles.title}>{t.title}</Text>

          {/* Pay model prominent */}
          <Card style={styles.payCard}>
            <Text style={styles.payLabel}>{t.payModel === 'HOURLY' ? 'Hourly rate' : 'Fixed pay'}</Text>
            <View style={styles.payRow}>
              <MoneyText
                amount={t.payModel === 'HOURLY' ? t.rate : t.budget ?? t.rate}
                size={type.size.displayLg}
                color={colors.clay}
                weight="800"
              />
              <Text style={styles.payUnit}>{t.payModel === 'HOURLY' ? '/hr' : ''}</Text>
            </View>
            <Text style={styles.netHint}>
              ≈ net{' '}
              <MoneyText
                amount={netFromGross(t.payModel === 'HOURLY' ? t.rate ?? 0 : t.budget ?? 0)}
                size={type.size.sm}
                color={colors.money}
              />{' '}
              after 5% WHT
            </Text>
          </Card>

          <View style={styles.metaGrid}>
            <Meta icon={remote ? 'globe' : 'map-pin'} label="Location" value={remote ? 'Remote' : t.address || 'On-site'} />
            <Meta icon="clock" label="Closes" value={formatDate(t.deadline)} />
            <Meta icon="list" label="Slots" value={`${Math.max(0, t.slots - (t.filledCount ?? 0))} of ${t.slots} left`} />
            <Meta icon="briefcase" label="Pay model" value={payLabel(t.payModel, t.rate, t.budget)} />
          </View>

          {!remote && t.lat != null && t.lng != null ? (
            <Pressable
              style={styles.directions}
              onPress={() =>
                Linking.openURL(
                  `https://www.google.com/maps/search/?api=1&query=${t.lat},${t.lng}`
                )
              }
              accessibilityRole="button"
            >
              <Icon name="map-pin" size={15} color={colors.clay} />
              <Text style={styles.directionsText}>Get directions</Text>
              <Icon name="chevron-right" size={14} color={colors.clay} />
            </Pressable>
          ) : null}

          {!remote && t.geofenceRadius ? (
            <Card tinted style={styles.geofence}>
              <Icon name="map-pin" size={18} color={colors.clay} />
              <Text style={styles.geofenceText}>
                Geofenced check-in within {t.geofenceRadius}m of the site.
              </Text>
            </Card>
          ) : null}

          <Text style={styles.section}>About this task</Text>
          <Text style={styles.desc}>{t.description}</Text>

          {/* Eligibility messaging */}
          {!tierEligible ? (
            <Banner
              tone="amber"
              icon="shield"
              title="Tier locked"
              message={`This task needs the ${t.tier} tier. Add it in Profile to apply.`}
            />
          ) : !kycOk ? (
            <Banner
              tone="amber"
              icon="shield"
              title="Finish verification first"
              message="Applications unlock once your KYC is Tier-Approved."
            />
          ) : null}
        </>
      )}

      {/* Sticky-ish apply action */}
      {t && !task.loading ? (
        <View style={{ marginTop: spacing.xl }}>
          {applied ? (
            <Button
              label={myApp?.status === 'APPROVED' ? 'Approved — see My Tasks' : 'Applied — awaiting approval'}
              variant="secondary"
              icon={myApp?.status === 'APPROVED' ? 'check-circle' : 'check'}
              disabled
            />
          ) : closed ? (
            <Button label="Applications closed" variant="secondary" disabled />
          ) : (
            <Button
              label="Apply for this task"
              icon="chevron-right"
              onPress={() => setSheetOpen(true)}
              disabled={!tierEligible || !kycOk}
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
    </Screen>
  );
}

function Meta({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View style={styles.metaItem}>
      <Icon name={icon} size={16} color={colors.textMuted} />
      <View>
        <Text style={styles.metaLabel}>{label}</Text>
        <Text style={styles.metaValue}>{value}</Text>
      </View>
    </View>
  );
}

function ApplySheet({
  visible,
  task,
  onClose,
  onApplied,
}: {
  visible: boolean;
  task: Task;
  onClose: () => void;
  onApplied: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [pitch, setPitch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      // REAL: POST /api/applications {taskId, pitch}
      await api.apply(task.id, pitch.trim() || undefined);
      onApplied();
    } catch (e) {
      const msg = e instanceof ApiError || e instanceof Error ? e.message : 'Could not submit application.';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={styles.grabber} />
        <Text style={styles.sheetTitle}>Apply</Text>
        <Text style={styles.sheetSub}>Add a short pitch and your availability.</Text>
        <TextInput
          value={pitch}
          onChangeText={setPitch}
          multiline
          placeholder="Why you’re a good fit, and when you’re free…"
          placeholderTextColor={colors.textFaint}
          style={styles.pitch}
          accessibilityLabel="Pitch"
        />
        {error ? <Banner tone="danger" title="Couldn’t apply" message={error} /> : null}
        <Button label="Submit application" onPress={submit} loading={busy} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  category: { color: colors.textMuted, fontSize: type.size.sm, fontWeight: '600' },
  title: { color: colors.text, fontSize: type.size.xxl, fontWeight: '800', marginTop: spacing.sm, lineHeight: 30 },
  payCard: { marginTop: spacing.lg, gap: 2 },
  payLabel: { color: colors.textMuted, fontSize: type.size.sm, fontWeight: '600' },
  payRow: { flexDirection: 'row', alignItems: 'baseline' },
  payUnit: { color: colors.textMuted, fontSize: type.size.lg, fontWeight: '700' },
  netHint: { color: colors.textMuted, fontSize: type.size.sm, marginTop: 4 },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.lg },
  metaItem: { flexDirection: 'row', gap: spacing.sm, width: '50%', paddingVertical: spacing.sm, alignItems: 'flex-start' },
  metaLabel: { color: colors.textMuted, fontSize: type.size.xs },
  metaValue: { color: colors.text, fontSize: type.size.base, fontWeight: '700' },
  directions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.button,
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
  },
  directionsText: { color: colors.clay, fontWeight: '700', fontSize: type.size.sm },
  geofence: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  geofenceText: { flex: 1, color: colors.text, fontSize: type.size.sm },
  section: { color: colors.text, fontSize: type.size.lg, fontWeight: '800', marginTop: spacing.xl, marginBottom: spacing.sm },
  desc: { color: colors.text, fontSize: type.size.md, lineHeight: 24 },
  backdrop: { flex: 1, backgroundColor: 'rgba(20,15,11,0.45)' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    padding: layout.screenPadding,
    gap: spacing.md,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 100, backgroundColor: colors.line, marginBottom: spacing.sm },
  sheetTitle: { color: colors.text, fontSize: type.size.xl, fontWeight: '800' },
  sheetSub: { color: colors.textMuted, fontSize: type.size.base },
  pitch: {
    minHeight: 110,
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radii.input,
    padding: spacing.md,
    fontSize: type.size.md,
    color: colors.text,
    textAlignVertical: 'top',
  },
});
