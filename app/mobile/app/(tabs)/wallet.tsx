import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
// expo-file-system v19 (SDK 54) replaced this API with a File/Directory
// class model; the `/legacy` subpath keeps the old cacheDirectory/
// writeAsStringAsync surface this screen already relies on.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Screen } from '../../src/components/Screen';
import { WalletBalanceCard } from '../../src/components/WalletBalanceCard';
import { Card } from '../../src/components/Card';
import { Button } from '../../src/components/Button';
import { MoneyText } from '../../src/components/MoneyText';
import { Icon } from '../../src/components/Icon';
import { StatusPill } from '../../src/components/StatusPill';
import { LoadingState, ErrorState, EmptyState, Banner } from '../../src/components/Feedback';
import { colors, spacing, type, radii, layout } from '../../src/theme';
import { api, ApiError } from '../../src/api/client';
import { useAsync } from '../../src/lib/useAsync';
import { useAuth } from '../../src/auth/AuthContext';
import { formatNaira, formatDate } from '../../src/lib/format';
import type { Wallet, Transaction } from '../../src/api/types';

/** Minimum withdrawal per API_CONTRACT v3 (₦5,000). */
const WITHDRAW_MIN = 5000;

export default function WalletScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [yearSheetOpen, setYearSheetOpen] = useState(false);
  const [dlBusy, setDlBusy] = useState(false);
  const [dlError, setDlError] = useState<string | null>(null);

  // REAL: GET /api/me/wallet → derived balances
  const wallet = useAsync<Wallet>((signal) => api.myWallet(signal), []);
  // REAL: GET /api/me/transactions
  const txns = useAsync<Transaction[]>((signal) => api.myTransactions(signal), []);

  const balances = wallet.data ?? { pending: 0, available: 0, withdrawn: 0 };
  const belowMin = balances.available < WITHDRAW_MIN;

  async function downloadStatement(year: number) {
    setYearSheetOpen(false);
    setDlBusy(true);
    setDlError(null);
    try {
      const { csv, filename } = await api.taxStatement(year);
      const path = (FileSystem.cacheDirectory ?? '') + filename;
      await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: `WHT Statement ${year}` });
      } else {
        setDlError('Sharing is not available on this device.');
      }
    } catch (e) {
      setDlError(e instanceof Error ? e.message : 'Download failed.');
    } finally {
      setDlBusy(false);
    }
  }

  return (
    <Screen title="Wallet" subtitle="Your earnings, paid to your bank" onRefresh={() => { wallet.reload(); txns.reload(); }} refreshing={wallet.loading && !!wallet.data}>
      {wallet.loading && !wallet.data ? (
        <LoadingState label="Loading wallet…" />
      ) : wallet.error ? (
        <ErrorState message={wallet.error} onRetry={wallet.reload} />
      ) : (
        <>
          <WalletBalanceCard wallet={balances} />

          <View style={styles.actions}>
            <Button
              label="Withdraw"
              icon="arrow-up"
              onPress={() => setSheetOpen(true)}
              disabled={belowMin}
            />
          </View>
          {belowMin ? (
            <Text style={styles.minNote}>
              Minimum withdrawal is {formatNaira(WITHDRAW_MIN)}. Keep earning to unlock payouts.
            </Text>
          ) : null}

          {/* Money math disclosure (§3.5) */}
          <Card tinted style={styles.math}>
            <View style={styles.mathRow}>
              <Icon name="shield" size={16} color={colors.indigo} />
              <Text style={styles.mathTitle}>How your pay is calculated</Text>
            </View>
            <Text style={styles.mathLine}>Gross  →  − 5% WHT  →  Net to wallet</Text>
            <Text style={styles.mathSub}>
              Withholding tax (WHT) is remitted on your behalf. Download your annual statement below.
            </Text>
          </Card>

          <Text style={styles.section}>Transactions</Text>
          {txns.loading && !txns.data ? (
            <LoadingState />
          ) : (txns.data?.length ?? 0) === 0 ? (
            <EmptyState icon="wallet" title="No transactions yet" message="Earnings appear here once tasks are approved." />
          ) : (
            <Card padded={false} style={styles.txCard}>
              {(txns.data ?? []).map((tx, i) => (
                <View key={tx.id}>
                  <TransactionRow
                    tx={tx}
                    onPress={tx.kind === 'earning' ? () => router.push(`/payment/${tx.id}`) : undefined}
                  />
                  {i < (txns.data?.length ?? 0) - 1 ? <View style={styles.divider} /> : null}
                </View>
              ))}
            </Card>
          )}

          <Pressable
            style={styles.statement}
            accessibilityRole="button"
            onPress={() => setYearSheetOpen(true)}
            disabled={dlBusy}
          >
            <Icon name="id" size={18} color={colors.clay} />
            <Text style={styles.statementText}>Download annual tax statement</Text>
            {dlBusy
              ? <ActivityIndicator size="small" color={colors.textMuted} />
              : <Icon name="chevron-right" size={16} color={colors.textMuted} />
            }
          </Pressable>
          {dlError ? <Text style={styles.dlError}>{dlError}</Text> : null}
        </>
      )}

      <WithdrawSheet
        visible={sheetOpen}
        available={balances.available}
        onClose={() => setSheetOpen(false)}
        bankMasked={user?.bankMasked}
        onWithdrawn={() => {
          wallet.reload();
          txns.reload();
        }}
      />
      <YearSheet
        visible={yearSheetOpen}
        onClose={() => setYearSheetOpen(false)}
        onSelect={downloadStatement}
      />
    </Screen>
  );
}

function TransactionRow({ tx, onPress }: { tx: Transaction; onPress?: () => void }) {
  const out = tx.kind === 'withdrawal';
  const row = (
    <View style={styles.txRow}>
      <View style={[styles.txIcon, { backgroundColor: out ? colors.surfaceSand : colors.moneySoft }]}>
        <Icon name={out ? 'arrow-up' : 'arrow-down'} size={18} color={out ? colors.textMuted : colors.money} />
      </View>
      <View style={styles.txBody}>
        <Text style={styles.txTitle} numberOfLines={1}>{tx.title}</Text>
        <Text style={styles.txSub}>{formatDate(tx.createdAt)} · {out ? 'Withdrawal' : 'Earning'}</Text>
      </View>
      <View style={styles.txRight}>
        <MoneyText
          amount={tx.amount}
          size={type.size.md}
          color={out ? colors.text : colors.money}
          signed={out ? 'out' : 'in'}
        />
        <View style={styles.txPillRow}>
          <StatusPill status={tx.status} small />
          {!out && <Icon name="chevron-right" size={14} color={colors.line} />}
        </View>
      </View>
    </View>
  );
  if (onPress) {
    return <Pressable onPress={onPress} accessibilityRole="button">{row}</Pressable>;
  }
  return row;
}

function WithdrawSheet({
  visible,
  available,
  onClose,
  bankMasked,
  onWithdrawn,
}: {
  visible: boolean;
  available: number;
  onClose: () => void;
  bankMasked?: string | null;
  onWithdrawn: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [amount, setAmount] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = Number(amount.replace(/\D/g, '')) || 0;
  const tooMuch = value > available;
  const tooLittle = value < WITHDRAW_MIN;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      // REAL: POST /api/wallet/withdraw {amount}
      await api.withdraw(value);
      setDone(true);
      onWithdrawn();
    } catch (e) {
      const msg = e instanceof ApiError || e instanceof Error ? e.message : 'Could not request withdrawal.';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setDone(false);
    setAmount('');
    setError(null);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={styles.grabber} />
        {done ? (
          <View style={styles.sheetDone}>
            <View style={styles.doneIcon}>
              <Icon name="check" size={34} color={colors.money} strokeWidth={3} />
            </View>
            <Text style={styles.sheetTitle}>Withdrawal queued</Text>
            <Text style={styles.sheetSub}>
              {formatNaira(value)} to {bankMasked ?? 'your bank'} — arrives T+1 (next business day).
            </Text>
            <Button label="Done" onPress={close} />
          </View>
        ) : (
          <>
            <Text style={styles.sheetTitle}>Withdraw funds</Text>
            <Text style={styles.sheetSub}>Available: {formatNaira(available)} · to {bankMasked ?? 'your bank on file'}</Text>
            <View style={styles.amountWrap}>
              <Text style={styles.naira}>₦</Text>
              <TextInput
                value={amount}
                onChangeText={(t) => setAmount(t.replace(/\D/g, ''))}
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor={colors.textFaint}
                style={styles.amountInput}
                autoFocus
              />
            </View>
            {error ? (
              <Banner tone="danger" title="Withdrawal failed" message={error} />
            ) : value > 0 && tooMuch ? (
              <Banner tone="danger" title="More than available" message="Enter an amount within your balance." />
            ) : value > 0 && tooLittle ? (
              <Banner tone="amber" title={`Below minimum (${formatNaira(WITHDRAW_MIN)})`} />
            ) : null}
            <Button
              label={`Withdraw ${value > 0 ? formatNaira(value) : ''}`.trim()}
              onPress={submit}
              loading={busy}
              disabled={value <= 0 || tooMuch || tooLittle}
            />
          </>
        )}
      </View>
    </Modal>
  );
}

function YearSheet({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (year: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear - 1, currentYear - 2];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={styles.grabber} />
        <Text style={styles.sheetTitle}>Select tax year</Text>
        <Text style={styles.sheetSub}>Your WHT statement will be downloaded as a CSV file.</Text>
        <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
          {years.map((y) => (
            <Pressable
              key={y}
              style={styles.yearRow}
              onPress={() => onSelect(y)}
              accessibilityRole="button"
            >
              <Text style={styles.yearText}>{y}</Text>
              <Icon name="chevron-right" size={18} color={colors.textMuted} />
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}


const styles = StyleSheet.create({
  actions: { marginTop: spacing.lg },
  minNote: { color: colors.textMuted, fontSize: type.size.sm, marginTop: spacing.sm, textAlign: 'center' },
  math: { marginTop: spacing.lg, gap: 6 },
  mathRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  mathTitle: { color: colors.text, fontWeight: '700', fontSize: type.size.base },
  mathLine: { color: colors.text, fontWeight: '700', fontSize: type.size.md, marginTop: 2 },
  mathSub: { color: colors.textMuted, fontSize: type.size.sm, lineHeight: 18 },
  section: { color: colors.text, fontSize: type.size.lg, fontWeight: '800', marginTop: spacing.xl, marginBottom: spacing.md },
  txCard: { paddingHorizontal: spacing.lg },
  txRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  txIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  txBody: { flex: 1, gap: 2 },
  txTitle: { color: colors.text, fontSize: type.size.base, fontWeight: '700' },
  txSub: { color: colors.textMuted, fontSize: type.size.xs },
  txRight: { alignItems: 'flex-end', gap: 4 },
  txPillRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  divider: { height: 1, backgroundColor: colors.line },
  statement: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  statementText: { flex: 1, color: colors.text, fontWeight: '600', fontSize: type.size.base },
  dlError: { color: colors.danger, fontSize: type.size.sm, marginTop: spacing.xs },
  // sheet
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
  amountWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.input,
    paddingHorizontal: spacing.lg,
    marginVertical: spacing.sm,
  },
  naira: { fontSize: type.size.xxl, fontWeight: '800', color: colors.text },
  amountInput: { flex: 1, fontSize: type.size.display, fontWeight: '800', color: colors.text, paddingVertical: spacing.md },
  yearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 52,
  },
  yearText: { color: colors.text, fontSize: type.size.lg, fontWeight: '700' },
  sheetDone: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg },
  doneIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.moneySoft, alignItems: 'center', justifyContent: 'center' },
  doneWrap: { alignItems: 'center', gap: spacing.md },
});
