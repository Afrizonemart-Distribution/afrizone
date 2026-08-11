import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen } from '../src/components/Screen';
import { Card } from '../src/components/Card';
import { Button } from '../src/components/Button';
import { Icon } from '../src/components/Icon';
import { StatusPill } from '../src/components/StatusPill';
import { Banner, LoadingState, ErrorState, EmptyState } from '../src/components/Feedback';
import { colors, spacing, type, radii, layout } from '../src/theme';
import { api, ApiError } from '../src/api/client';
import { useAsync } from '../src/lib/useAsync';
import { formatDate } from '../src/lib/format';
import type { Timesheet } from '../src/api/types';

const STATUS_MAP: Record<string, { label: string; status: string }> = {
  SUBMITTED: { label: 'Pending',  status: 'PENDING'  },
  APPROVED:  { label: 'Approved', status: 'APPROVED' },
  DISPUTED:  { label: 'Disputed', status: 'DISPUTED' },
};

function TimesheetCard({
  ts,
  onDispute,
}: {
  ts: Timesheet;
  onDispute: (ts: Timesheet) => void;
}) {
  const cfg = STATUS_MAP[ts.status] ?? { label: ts.status, status: 'PENDING' };
  const h = ts.hours;
  const hoursLabel = `${h % 1 === 0 ? h.toFixed(0) : h.toFixed(2)} hr${h !== 1 ? 's' : ''}`;
  const canDispute = ts.status === 'SUBMITTED' || ts.status === 'APPROVED';
  const alreadyDisputed = ts.status === 'DISPUTED';

  return (
    <Card style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.taskTitle} numberOfLines={2}>{ts.task.title}</Text>
        <StatusPill status={cfg.status as any} small label={cfg.label} />
      </View>
      <View style={styles.meta}>
        <Text style={styles.hours}>{hoursLabel}</Text>
        <Text style={styles.dot}>·</Text>
        <Text style={styles.period}>
          {formatDate(ts.periodStart)} – {formatDate(ts.periodEnd)}
        </Text>
      </View>
      <Text style={styles.filed}>Filed {formatDate(ts.createdAt)}</Text>

      {alreadyDisputed ? (
        <View style={styles.disputedNote}>
          <Icon name="alert" size={13} color={colors.amber} />
          <Text style={styles.disputedText}>Dispute open — check Disputes for updates</Text>
        </View>
      ) : canDispute ? (
        <Pressable
          onPress={() => onDispute(ts)}
          style={styles.disputeBtn}
          accessibilityRole="button"
        >
          <Text style={styles.disputeBtnText}>Report an issue</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

function DisputeSheet({
  ts,
  onClose,
  onFiled,
}: {
  ts: Timesheet | null;
  onClose: () => void;
  onFiled: () => void;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setReason('');
    setBusy(false);
    setDone(false);
    setError(null);
    onClose();
  }

  async function submit() {
    if (!ts) return;
    setBusy(true);
    setError(null);
    try {
      await api.raiseDispute({ entityType: 'TIMESHEET', entityId: ts.id, reason });
      setDone(true);
      onFiled();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Could not file dispute.');
    } finally {
      setBusy(false);
    }
  }

  const h = ts?.hours ?? 0;
  const hoursLabel = `${h % 1 === 0 ? h.toFixed(0) : h.toFixed(2)} hrs`;

  return (
    <Modal visible={!!ts} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.xl }]}>
          <View style={styles.grabber} />

          {done ? (
            <View style={styles.doneWrap}>
              <View style={styles.doneIcon}>
                <Icon name="check-circle" size={32} color={colors.money} strokeWidth={2} />
              </View>
              <Text style={styles.sheetTitle}>Dispute filed</Text>
              <Text style={styles.sheetSub}>
                Our team will review within 2 business days.
              </Text>
              <Button
                label="View disputes"
                icon="list"
                onPress={() => { close(); router.push('/disputes'); }}
              />
              <Button label="Done" variant="ghost" onPress={close} />
            </View>
          ) : (
            <>
              <Text style={styles.sheetTitle}>Report a timesheet issue</Text>
              <Text style={styles.sheetSub} numberOfLines={2}>{ts?.task.title}</Text>

              <View style={styles.summaryRow}>
                <View>
                  <Text style={styles.summaryLabel}>Hours submitted</Text>
                  <Text style={styles.summaryValue}>{hoursLabel}</Text>
                </View>
                <View>
                  <Text style={styles.summaryLabel}>Period</Text>
                  <Text style={styles.summaryValue}>
                    {ts ? `${formatDate(ts.periodStart)} – ${formatDate(ts.periodEnd)}` : ''}
                  </Text>
                </View>
              </View>

              <Text style={styles.inputLabel}>Describe the issue</Text>
              <TextInput
                style={styles.input}
                value={reason}
                onChangeText={setReason}
                placeholder="e.g. I clocked 8 hours but only 6 were recorded. GPS dropped during the last shift."
                placeholderTextColor={colors.textFaint}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
              {reason.length > 0 && reason.trim().length < 10 ? (
                <Text style={styles.inputHint}>{10 - reason.trim().length} more characters needed</Text>
              ) : null}
              {error ? <Text style={styles.inputError}>{error}</Text> : null}
              <Button
                label="Submit dispute"
                icon="alert"
                onPress={submit}
                loading={busy}
                disabled={reason.trim().length < 10 || busy}
              />
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default function TimesheetsScreen() {
  const timesheets = useAsync<Timesheet[]>((signal) => api.myTimesheets(signal), []);
  const [disputeTs, setDisputeTs] = useState<Timesheet | null>(null);

  return (
    <Screen
      title="Timesheets"
      subtitle="Your submitted hour records"
      back
      onRefresh={timesheets.reload}
      refreshing={timesheets.loading && !!timesheets.data}
    >
      {timesheets.loading && !timesheets.data ? (
        <LoadingState />
      ) : timesheets.error && !timesheets.data ? (
        <ErrorState message={timesheets.error} onRetry={timesheets.reload} />
      ) : (timesheets.data ?? []).length === 0 ? (
        <EmptyState
          title="No timesheets yet"
          message="After clocking out of a task, submit your hours. They'll appear here for approval."
        />
      ) : (
        <View style={styles.list}>
          {(timesheets.data ?? []).map((ts) => (
            <TimesheetCard
              key={ts.id}
              ts={ts}
              onDispute={setDisputeTs}
            />
          ))}
        </View>
      )}

      <DisputeSheet
        ts={disputeTs}
        onClose={() => setDisputeTs(null)}
        onFiled={() => {
          setDisputeTs(null);
          timesheets.reload();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  card: { gap: spacing.xs },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  taskTitle: { flex: 1, color: colors.text, fontSize: type.size.md, fontWeight: '700' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 },
  hours: { color: colors.clay, fontSize: type.size.sm, fontWeight: '700' },
  dot: { color: colors.line, fontSize: type.size.sm },
  period: { color: colors.textMuted, fontSize: type.size.sm, flex: 1 },
  filed: { color: colors.textMuted, fontSize: type.size.xs },
  disputedNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.xs,
  },
  disputedText: { color: colors.amber, fontSize: type.size.xs, flex: 1 },
  disputeBtn: { marginTop: spacing.xs, alignSelf: 'flex-start' },
  disputeBtnText: {
    color: colors.clay,
    fontSize: type.size.sm,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },

  // Sheet
  backdrop: { flex: 1, backgroundColor: 'rgba(20,15,11,0.45)' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    padding: layout.screenPadding,
    gap: spacing.md,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 100,
    backgroundColor: colors.line,
    marginBottom: spacing.sm,
  },
  sheetTitle: { color: colors.text, fontSize: type.size.xl, fontWeight: '800' },
  sheetSub: { color: colors.textMuted, fontSize: type.size.base },
  summaryRow: {
    flexDirection: 'row',
    gap: spacing.xl,
    backgroundColor: colors.surfaceSand,
    borderRadius: radii.card,
    padding: spacing.md,
  },
  summaryLabel: { color: colors.textMuted, fontSize: type.size.xs, marginBottom: 2 },
  summaryValue: { color: colors.text, fontSize: type.size.base, fontWeight: '700' },
  inputLabel: { color: colors.text, fontWeight: '600', fontSize: type.size.base },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.input,
    padding: spacing.md,
    fontSize: type.size.base,
    color: colors.text,
    backgroundColor: colors.surface,
    minHeight: 96,
  },
  inputHint: { color: colors.textMuted, fontSize: type.size.xs },
  inputError: { color: colors.danger, fontSize: type.size.sm },
  doneWrap: { gap: spacing.md, alignItems: 'center' },
  doneIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.moneySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
