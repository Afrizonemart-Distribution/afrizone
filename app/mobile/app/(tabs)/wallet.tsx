import * as ImagePicker from 'expo-image-picker';
import React, { useState, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, TextInput, ActivityIndicator, ScrollView, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
// expo-file-system v19 (SDK 54) replaced this API with a File/Directory
// class model; the `/legacy` subpath keeps the old cacheDirectory/
// writeAsStringAsync surface this screen already relies on.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { AppBalanceHero, AppPrimaryButton, AppListCard, AppListRow, AppChipRow, AppChip, AppEmptyState, AppErrorState, AppLoadingCards } from '../../src/appui/AppUI';
import { Icon } from '../../src/components/Icon';
import { obColors, obRadii } from '../../src/onboarding/onboardingTheme';
import { api, ApiError } from '../../src/api/client';
import { useAsync } from '../../src/lib/useAsync';
import { OfflineNote } from '../../src/components/OfflineStatus';
import { useAuth } from '../../src/auth/AuthContext';
import { formatNaira, formatDate } from '../../src/lib/format';
import type { Wallet, Transaction } from '../../src/api/types';

/**
 * Restyled to match afrizone-mobile-prototype (1).html's Wallet screen - the
 * navy balance hero, a static info row for the pay-math disclosure, and
 * grouped transactions. All real state/logic below (period filtering,
 * day-grouping, withdraw idempotency key, tax-statement download) is
 * unchanged from the previous version of this file.
 */

/** Minimum withdrawal per API_CONTRACT v3 (₦5,000). */
const WITHDRAW_MIN = 5000;

export default function WalletScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [yearSheetOpen, setYearSheetOpen] = useState(false);
  const [dlBusy, setDlBusy] = useState(false);
  const [dlError, setDlError] = useState<string | null>(null);
  const [period, setPeriod] = useState<'week' | 'month' | 'all'>('all');

  // REAL: GET /api/me/wallet → derived balances
  const wallet = useAsync<Wallet>((signal) => api.myWallet(signal), [], { cacheKey: 'wallet' });
  // REAL: GET /api/me/transactions
  const txns = useAsync<Transaction[]>((signal) => api.myTransactions(signal), [], { cacheKey: 'transactions' });

  const balances = wallet.data ?? { pending: 0, available: 0, withdrawn: 0 };
  const belowMin = balances.available < WITHDRAW_MIN;

  // This calendar month's net earnings, for the hero's third column - a real
  // figure derived from the same transactions, independent of whatever the
  // period chip below is set to.
  const thisMonthNet = useMemo(() => {
    const now = new Date();
    return (txns.data ?? []).reduce((sum, tx) => {
      const d = new Date(tx.createdAt);
      if (d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth()) return sum;
      return sum + (tx.kind === 'withdrawal' ? -tx.amount : tx.amount);
    }, 0);
  }, [txns.data]);

  const filteredTxns = useMemo(() => {
    const all = txns.data ?? [];
    if (period === 'all') return all;
    const cutoff = new Date();
    if (period === 'week') cutoff.setDate(cutoff.getDate() - 7);
    else cutoff.setMonth(cutoff.getMonth() - 1);
    return all.filter((tx) => new Date(tx.createdAt) >= cutoff);
  }, [txns.data, period]);

  const txnGroups = useMemo(() => {
    const groups: { key: string; label: string; net: number; items: Transaction[] }[] = [];
    for (const tx of filteredTxns) {
      const d = new Date(tx.createdAt);
      const key = Number.isNaN(d.getTime()) ? 'unknown' : d.toDateString();
      const signedAmount = tx.kind === 'withdrawal' ? -tx.amount : tx.amount;
      let group = groups[groups.length - 1]?.key === key ? groups[groups.length - 1] : undefined;
      if (!group) {
        group = {
          key,
          label: Number.isNaN(d.getTime())
            ? 'Earlier'
            : d.toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' }),
          net: 0,
          items: [],
        };
        groups.push(group);
      }
      group.net += signedAmount;
      group.items.push(tx);
    }
    return groups;
  }, [filteredTxns]);

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
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 18, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={wallet.loading && !!wallet.data}
            onRefresh={() => { wallet.reload(); txns.reload(); }}
            tintColor={obColors.navy}
          />
        }
      >
        <Text style={styles.title}>Wallet</Text>
        <OfflineNote savedAt={wallet.savedAt} />
        <View style={{ height: 14 }} />

        {wallet.loading && !wallet.data ? (
          <AppLoadingCards count={2} />
        ) : wallet.error ? (
          <AppErrorState message={wallet.error} onRetry={wallet.reload} />
        ) : (
          <>
            <AppBalanceHero
              label="Available balance"
              amount={formatNaira(balances.available)}
              split={[
                { label: 'Pending', value: formatNaira(balances.pending) },
                { label: 'Withdrawn', value: formatNaira(balances.withdrawn) },
                { label: 'This month', value: formatNaira(Math.abs(thisMonthNet)) },
              ]}
            >
              <AppPrimaryButton label="Withdraw funds" icon="arrow-up" onPress={() => setSheetOpen(true)} disabled={belowMin} />
            </AppBalanceHero>
            {belowMin ? (
              <Text style={styles.minNote}>
                Minimum withdrawal is {formatNaira(WITHDRAW_MIN)}. Keep earning to unlock payouts.
              </Text>
            ) : null}

            <View style={{ marginTop: 16, marginBottom: 16 }}>
              <AppListCard>
                <AppListRow
                  icon="shield"
                  title="How pay is calculated"
                  subtitle="Gross → −5% WHT → Net to wallet"
                  last
                />
              </AppListCard>
            </View>

            {(txns.data?.length ?? 0) > 0 ? (
              <View style={{ marginBottom: 16 }}>
                <AppChipRow>
                  <AppChip label="This week" active={period === 'week'} onPress={() => setPeriod('week')} />
                  <AppChip label="This month" active={period === 'month'} onPress={() => setPeriod('month')} />
                  <AppChip label="All time" active={period === 'all'} onPress={() => setPeriod('all')} />
                </AppChipRow>
              </View>
            ) : null}

            {txns.loading && !txns.data ? (
              <AppLoadingCards count={3} />
            ) : (txns.data?.length ?? 0) === 0 ? (
              <AppEmptyState icon="wallet" title="No transactions yet" message="Earnings appear here once tasks are approved." />
            ) : txnGroups.length === 0 ? (
              <AppEmptyState icon="wallet" title="Nothing in this period" message="Try a wider period to see older transactions." />
            ) : (
              txnGroups.map((group) => (
                <View key={group.key} style={{ marginBottom: 16 }}>
                  <View style={styles.dayHeader}>
                    <Text style={styles.dayLabel}>{group.label}</Text>
                    <Text style={[styles.dayNet, { color: group.net >= 0 ? obColors.mgreen : obColors.text }]}>
                      {group.net >= 0 ? '+' : '−'}{formatNaira(Math.abs(group.net))}
                    </Text>
                  </View>
                  {group.items.map((tx) => (
                    <TransactionRow key={tx.id} tx={tx} onPress={tx.kind === 'earning' ? () => router.push(`/payment/${tx.id}`) : undefined} />
                  ))}
                </View>
              ))
            )}

            <Pressable style={styles.statement} onPress={() => setYearSheetOpen(true)} disabled={dlBusy}>
              <Icon name="id" size={16} color={obColors.navy} />
              <Text style={styles.statementText}>Download annual tax statement</Text>
              {dlBusy ? <ActivityIndicator size="small" color={obColors.textMut} /> : <Icon name="chevron-right" size={15} color={obColors.textMut} />}
            </Pressable>
            {dlError ? <Text style={styles.dlError}>{dlError}</Text> : null}
          </>
        )}
      </ScrollView>

      <WithdrawSheet
        visible={sheetOpen}
        available={balances.available}
        onClose={() => setSheetOpen(false)}
        bankMasked={user?.bankMasked}
        onWithdrawn={() => { wallet.reload(); txns.reload(); }}
      />
      <YearSheet visible={yearSheetOpen} onClose={() => setYearSheetOpen(false)} onSelect={downloadStatement} />
    </View>
  );
}

function TransactionRow({ tx, onPress }: { tx: Transaction; onPress?: () => void }) {
  const out = tx.kind === 'withdrawal';
  const row = (
    <View style={styles.txRow}>
      <View style={[styles.txIcon, { backgroundColor: out ? obColors.sand : obColors.mgreenBg }]}>
        <Icon name={out ? 'arrow-up' : 'arrow-down'} size={14} color={out ? obColors.navy : obColors.mgreen} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.txTitle} numberOfLines={1}>{tx.title}</Text>
        <Text style={styles.txSub}>{formatDate(tx.createdAt)} · {out ? 'Withdrawal' : 'Earning'}</Text>
      </View>
      <Text style={[styles.txAmt, { color: out ? obColors.text : obColors.mgreen }]}>
        {out ? '−' : '+'}{formatNaira(tx.amount)}
      </Text>
    </View>
  );
  if (onPress) return <Pressable onPress={onPress} accessibilityRole="button">{row}</Pressable>;
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
  /** Set once the server says this amount needs a selfie; holds its message. */
  const [needSelfie, setNeedSelfie] = useState<string | null>(null);
  /** The withdrawal went in for a face check rather than straight to the bank. */
  const [inReview, setInReview] = useState(false);
  const value = Number(amount.replace(/\D/g, '')) || 0;
  const displayAmount = value > 0 ? value.toLocaleString('en-NG') : '';
  const tooMuch = value > available;
  const tooLittle = value < WITHDRAW_MIN;

  // Identifies ONE intended withdrawal, and must survive a retry.
  //
  // If the request fails, the worker taps again - and on a patchy connection
  // the first attempt may actually have succeeded, with only the response
  // lost. Reusing the key makes the server return that original withdrawal
  // instead of creating a second one and paying them twice. Generated once per
  // intent (below, on first submit) and cleared in close(), so a genuinely
  // separate withdrawal gets a fresh key.
  const idemKeyRef = useRef<string | null>(null);

  async function submit(selfieDocumentId?: string) {
    setBusy(true);
    setError(null);
    if (!idemKeyRef.current) {
      idemKeyRef.current = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
    try {
      const w = await api.withdraw(value, idemKeyRef.current, selfieDocumentId);
      setInReview((w as { status?: string }).status === 'REVIEW');
      setNeedSelfie(null);
      setDone(true);
      onWithdrawn();
    } catch (e) {
      const body = e instanceof ApiError && e.body && typeof e.body === 'object' ? (e.body as { code?: string }) : null;
      if (body?.code === 'SELFIE_REQUIRED') {
        setNeedSelfie(e instanceof Error ? e.message : 'This withdrawal needs a quick selfie.');
      } else {
        const msg = e instanceof ApiError || e instanceof Error ? e.message : 'Could not request withdrawal.';
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  /**
   * Front camera only, never the gallery: the point is a face taken now, for
   * this withdrawal, that a person compares with the verified one.
   */
  async function selfieThenSubmit() {
    setError(null);
    try {
      const cam = await ImagePicker.requestCameraPermissionsAsync();
      if (cam.status !== 'granted') {
        setError('Allow the camera in Settings to take the selfie.');
        return;
      }
      const shot = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        cameraType: ImagePicker.CameraType.front,
        quality: 0.6,
        allowsEditing: false,
        exif: false,
      });
      if (shot.canceled) return;
      setBusy(true);
      const asset = shot.assets[0];
      const doc = await api.uploadKycDocument({
        docType: 'PAYOUT_SELFIE',
        uri: asset.uri,
        mimeType: asset.mimeType ?? 'image/jpeg',
        filename: `payout-selfie-${Date.now()}.jpg`,
      });
      await submit(doc.id);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : 'Could not send the selfie.');
    }
  }

  function close() {
    setDone(false);
    setAmount('');
    setError(null);
    setNeedSelfie(null);
    setInReview(false);
    // A new sheet is a new withdrawal intent, so it must not reuse the key -
    // otherwise the server would treat a genuine second withdrawal as a retry
    // of the first and return the old row instead of paying out again.
    idemKeyRef.current = null;
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.grabber} />
        {done ? (
          <View style={styles.sheetDone}>
            <View style={styles.doneIcon}>
              <Icon name="check" size={30} color={obColors.mgreen} strokeWidth={3} />
            </View>
            <Text style={styles.sheetTitle}>{inReview ? 'Selfie sent for checking' : 'Withdrawal queued'}</Text>
            <Text style={styles.sheetSub}>
              {inReview
                ? `${formatNaira(value)} is set aside. We compare your selfie with your verified photo, usually within a working day, then send it to ${bankMasked ?? 'your bank'}.`
                : `${formatNaira(value)} to ${bankMasked ?? 'your bank'}: arrives T+1 (next business day).`}
            </Text>
            <AppPrimaryButton label="Done" onPress={close} variant="outline" />
          </View>
        ) : (
          <>
            <Text style={styles.sheetTitle}>Withdraw funds</Text>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Amount (available: {formatNaira(available)})</Text>
              <View style={styles.amountBox}>
                <Text style={styles.naira}>₦</Text>
                <TextInput
                  value={displayAmount}
                  onChangeText={(t) => setAmount(t.replace(/\D/g, ''))}
                  keyboardType="number-pad"
                  placeholder="0.00"
                  placeholderTextColor={obColors.textMut}
                  style={styles.amountInput}
                  autoFocus
                />
              </View>
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Withdraw to</Text>
              <View style={styles.fieldBox}>
                <Text style={styles.fieldBoxText}>{bankMasked ?? 'No bank on file'}</Text>
              </View>
            </View>
            {error ? (
              <Text style={styles.errText}>{error}</Text>
            ) : value > 0 && tooMuch ? (
              <Text style={styles.errText}>More than your available balance.</Text>
            ) : value > 0 && tooLittle ? (
              <Text style={styles.warnText}>Below minimum ({formatNaira(WITHDRAW_MIN)}).</Text>
            ) : null}
            {needSelfie ? (
              <Text style={styles.warnText}>
                {needSelfie} It keeps your money safe if your phone or account is ever used by someone else.
              </Text>
            ) : null}
            <View style={{ marginTop: 8 }}>
              <AppPrimaryButton
                label={needSelfie ? 'Take selfie and withdraw' : 'Confirm withdrawal'}
                onPress={() => (needSelfie ? selfieThenSubmit() : submit())}
                loading={busy}
                disabled={value <= 0 || tooMuch || tooLittle || !bankMasked}
              />
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

function YearSheet({ visible, onClose, onSelect }: { visible: boolean; onClose: () => void; onSelect: (year: number) => void }) {
  const insets = useSafeAreaInsets();
  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear - 1, currentYear - 2];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.grabber} />
        <Text style={styles.sheetTitle}>Select tax year</Text>
        <Text style={styles.sheetSub}>Your WHT statement will be downloaded as a CSV file.</Text>
        <View style={{ gap: 8, marginTop: 12 }}>
          {years.map((y) => (
            <Pressable key={y} style={styles.yearRow} onPress={() => onSelect(y)} accessibilityRole="button">
              <Text style={styles.yearText}>{y}</Text>
              <Icon name="chevron-right" size={16} color={obColors.textMut} />
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: obColors.bg },
  title: { fontSize: 19, fontFamily: 'Raleway_800ExtraBold', color: obColors.navy },
  minNote: { color: obColors.textMut, fontSize: 12.5, marginTop: 8, textAlign: 'center' },
  dayHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8, paddingHorizontal: 2 },
  dayLabel: { fontSize: 11.5, color: obColors.textMut, fontWeight: '700' },
  dayNet: { fontSize: 11.5, fontWeight: '700' },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: obColors.white,
    borderWidth: 1,
    borderColor: obColors.line,
    borderRadius: 14,
    padding: 13,
    marginBottom: 8,
  },
  txIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  txTitle: { fontSize: 13, fontWeight: '700', color: obColors.text },
  txSub: { fontSize: 11, color: obColors.textMut, marginTop: 1 },
  txAmt: { fontSize: 13, fontWeight: '800', fontFamily: 'Raleway_800ExtraBold' },
  statement: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
    padding: 14,
    borderRadius: obRadii.card,
    borderWidth: 1,
    borderColor: obColors.line,
    backgroundColor: obColors.white,
  },
  statementText: { flex: 1, color: obColors.text, fontWeight: '600', fontSize: 13.5 },
  dlError: { color: obColors.dangerInk, fontSize: 12.5, marginTop: 6 },
  // sheet
  backdrop: { flex: 1, backgroundColor: obColors.scrim },
  sheet: {
    backgroundColor: obColors.bg,
    borderTopLeftRadius: obRadii.hero,
    borderTopRightRadius: obRadii.hero,
    padding: 20,
    gap: 10,
  },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 4, backgroundColor: obColors.line, marginBottom: 8 },
  sheetTitle: { color: obColors.navy, fontSize: 18, fontFamily: 'Raleway_800ExtraBold' },
  sheetSub: { color: obColors.textMut, fontSize: 13 },
  field: { marginTop: 12 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: obColors.textMut, marginBottom: 6 },
  fieldBox: {
    backgroundColor: obColors.white,
    borderWidth: 1,
    borderColor: obColors.line,
    borderRadius: obRadii.field,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  fieldBoxText: { fontSize: 15, fontWeight: '700', color: obColors.text },
  amountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: obColors.white,
    borderWidth: 1,
    borderColor: obColors.line,
    borderRadius: obRadii.field,
    paddingHorizontal: 16,
  },
  naira: { fontSize: 22, fontWeight: '800', color: obColors.text },
  amountInput: { flex: 1, fontSize: 26, fontWeight: '800', color: obColors.text, paddingVertical: 12 },
  errText: { color: obColors.dangerInk, fontSize: 12.5 },
  warnText: { color: obColors.amberInk, fontSize: 12.5 },
  yearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: obColors.white,
    borderRadius: obRadii.card,
    borderWidth: 1,
    borderColor: obColors.line,
    paddingHorizontal: 16,
    paddingVertical: 13,
    minHeight: 50,
  },
  yearText: { color: obColors.text, fontSize: 15, fontWeight: '700' },
  sheetDone: { alignItems: 'center', gap: 10, paddingVertical: 12 },
  doneIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: obColors.mgreenBg, alignItems: 'center', justifyContent: 'center' },
});
