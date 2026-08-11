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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen } from '../../src/components/Screen';
import { Card } from '../../src/components/Card';
import { Button } from '../../src/components/Button';
import { MoneyText } from '../../src/components/MoneyText';
import { Icon } from '../../src/components/Icon';
import { StatusPill } from '../../src/components/StatusPill';
import { Banner, LoadingState, ErrorState } from '../../src/components/Feedback';
import { colors, spacing, type, radii, layout } from '../../src/theme';
import { api, ApiError } from '../../src/api/client';
import { useAsync } from '../../src/lib/useAsync';
import { formatDate, formatNaira } from '../../src/lib/format';
import type { PaymentDetail } from '../../src/api/types';

export default function PaymentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [disputeOpen, setDisputeOpen] = useState(false);

  const paymentQ = useAsync<PaymentDetail>(
    (signal) => api.myPaymentDetail(id!, signal),
    [id]
  );
  const p = paymentQ.data;

  const canDispute = p?.status === 'APPROVED' || p?.status === 'RELEASED';
  const alreadyDisputed = p?.status === 'DISPUTED';
  const isPending = p?.status === 'PENDING';

  return (
    <Screen title="Payment" back scroll>
      {paymentQ.loading && !p ? (
        <LoadingState />
      ) : paymentQ.error && !p ? (
        <ErrorState message={paymentQ.error} onRetry={paymentQ.reload} />
      ) : p ? (
        <>
          {/* Task + status header */}
          <View style={styles.header}>
            <Text style={styles.taskTitle}>{p.task.title}</Text>
            <StatusPill status={p.status} />
          </View>

          {/* Gross → WHT → Net breakdown */}
          <Card style={styles.breakdown}>
            <Row label="Gross pay" value={p.gross} color={colors.text} />
            <View style={styles.separator} />
            <Row
              label={`Withholding Tax (${(p.whtRate * 100).toFixed(0)}%)`}
              value={-p.whtAmount}
              color={colors.textMuted}
              signed
            />
            <View style={styles.dividerFull} />
            <Row label="Net to wallet" value={p.net} color={colors.money} bold />
          </Card>

          {/* Filed date */}
          <Text style={styles.meta}>
            <Text style={styles.metaLabel}>Filed </Text>
            {formatDate(p.createdAt)}
          </Text>

          {/* Dispute section */}
          <View style={styles.disputeSection}>
            {isPending ? (
              <Banner
                tone="amber"
                icon="clock"
                title="Awaiting approval"
                message="Your payment will appear in your wallet balance once an admin approves it."
              />
            ) : alreadyDisputed ? (
              <>
                <Banner
                  tone="amber"
                  icon="alert"
                  title="Dispute open on this payment"
                  message="Our team is reviewing it. Check Disputes for updates."
                />
                <Button
                  label="View disputes"
                  variant="secondary"
                  icon="list"
                  onPress={() => router.push('/disputes')}
                />
              </>
            ) : canDispute ? (
              <Button
                label="Raise a dispute"
                variant="secondary"
                icon="alert"
                onPress={() => setDisputeOpen(true)}
              />
            ) : null}
          </View>
        </>
      ) : null}

      {p && (
        <DisputeSheet
          visible={disputeOpen}
          paymentId={p.id}
          taskTitle={p.task.title}
          net={p.net}
          onClose={() => setDisputeOpen(false)}
          onFiled={() => {
            setDisputeOpen(false);
            paymentQ.reload();
          }}
        />
      )}
    </Screen>
  );
}

// ── Money row ────────────────────────────────────────────────────────────────
function Row({
  label,
  value,
  color,
  bold,
  signed,
}: {
  label: string;
  value: number;
  color: string;
  bold?: boolean;
  signed?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, bold && { fontWeight: '700', color }]}>{label}</Text>
      <MoneyText
        amount={Math.abs(value)}
        size={bold ? type.size.lg : type.size.md}
        color={color}
        weight={bold ? '800' : '600'}
        signed={signed ? 'out' : undefined}
      />
    </View>
  );
}

// ── Dispute bottom sheet ──────────────────────────────────────────────────────
function DisputeSheet({
  visible,
  paymentId,
  taskTitle,
  net,
  onClose,
  onFiled,
}: {
  visible: boolean;
  paymentId: string;
  taskTitle: string;
  net: number;
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
    setBusy(true);
    setError(null);
    try {
      await api.raiseDispute({ entityType: 'PAYMENT', entityId: paymentId, reason });
      setDone(true);
      onFiled();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Could not file dispute.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
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
              <Text style={styles.sheetTitle}>Report an issue</Text>
              <Text style={styles.sheetSub}>{taskTitle}</Text>

              <View style={styles.amountRow}>
                <View>
                  <Text style={styles.amountLabel}>Net paid</Text>
                  <Text style={styles.amountValue}>{formatNaira(net)}</Text>
                </View>
              </View>

              <Text style={styles.inputLabel}>Describe the issue</Text>
              <TextInput
                style={styles.input}
                value={reason}
                onChangeText={setReason}
                placeholder="e.g. I worked 6 hours but was paid for 4."
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

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  taskTitle: {
    flex: 1,
    color: colors.text,
    fontSize: type.size.xl,
    fontWeight: '800',
    lineHeight: 26,
  },

  // Breakdown card
  breakdown: { gap: spacing.md, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { color: colors.textMuted, fontSize: type.size.base },
  separator: { height: 1, backgroundColor: colors.line, marginVertical: spacing.xs },
  dividerFull: {
    height: 2,
    backgroundColor: colors.line,
    marginVertical: spacing.xs,
  },

  meta: { color: colors.textMuted, fontSize: type.size.sm, marginBottom: spacing.xl },
  metaLabel: { color: colors.textMuted },

  disputeSection: { gap: spacing.md },

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
  amountRow: {
    backgroundColor: colors.surfaceSand,
    borderRadius: radii.card,
    padding: spacing.md,
  },
  amountLabel: { color: colors.textMuted, fontSize: type.size.xs, marginBottom: 2 },
  amountValue: { color: colors.clay, fontSize: type.size.xl, fontWeight: '800' },
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
