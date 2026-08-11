import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  Alert,
  Platform,
  Modal,
  Pressable,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { Card } from '../../src/components/Card';
import { ListRow } from '../../src/components/ListRow';
import { Button } from '../../src/components/Button';
import { TierBadge } from '../../src/components/TierBadge';
import { StatusPill, toCanonical } from '../../src/components/StatusPill';
import { Icon } from '../../src/components/Icon';
import { StarRating } from '../../src/components/StarRating';
import { Banner, LoadingState } from '../../src/components/Feedback';
import { colors, spacing, type, radii, layout } from '../../src/theme';
import { api, ApiError } from '../../src/api/client';
import { useAsync } from '../../src/lib/useAsync';
import { useAuth } from '../../src/auth/AuthContext';
import { NIGERIAN_BANKS } from '../../src/lib/banks';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { User, Contract } from '../../src/api/types';

export default function ProfileScreen() {
  const router = useRouter();
  const { user: authUser, signOut, updateUser } = useAuth();
  const [notifTasks, setNotifTasks] = useState<boolean | null>(null);
  const [notifPay, setNotifPay] = useState<boolean | null>(null);
  const [notifEmail, setNotifEmail] = useState<boolean | null>(null);
  const [notifSaveError, setNotifSaveError] = useState<string | null>(null);

  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [editBankOpen, setEditBankOpen] = useState(false);
  const [editTinOpen, setEditTinOpen] = useState(false);

  const me = useAsync<User>((signal) => api.meWorker(signal), []);
  const contracts = useAsync<Contract[]>((signal) => api.myContracts(signal), []);

  const user = me.data ?? authUser;
  const kyc = user?.kycStatus ?? 'PENDING';

  // Sync notification prefs from server once the user object is available.
  React.useEffect(() => {
    if (!user) return;
    if (notifTasks === null) setNotifTasks(user.notifTasks ?? true);
    if (notifPay === null) setNotifPay(user.notifPay ?? true);
    if (notifEmail === null) setNotifEmail(user.notifEmail ?? false);
  }, [user]);

  async function saveNotif(patch: { notifTasks?: boolean; notifPay?: boolean; notifEmail?: boolean }) {
    setNotifSaveError(null);
    try {
      await api.patchMe(patch);
    } catch {
      setNotifSaveError('Could not save — check your connection.');
    }
  }

  function confirmLogout() {
    if (Platform.OS === 'web') {
      void signOut();
      return;
    }
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => void signOut() },
    ]);
  }

  function onSaved(updated: User) {
    me.reload();
    void updateUser(updated);
  }

  return (
    <Screen
      title="Profile"
      subtitle={user?.email ?? undefined}
      onRefresh={() => { me.reload(); contracts.reload(); }}
      refreshing={me.loading && !!me.data}
    >
      {/* Identity card */}
      <Card style={styles.identity}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(user?.name ?? 'A').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
          </Text>
        </View>
        <View style={styles.identityBody}>
          <Text style={styles.name}>{user?.name ?? 'Worker'}</Text>
          <View style={styles.tiers}>
            {(user?.tiers ?? []).map((t) => <TierBadge key={t} tier={t} small />)}
          </View>
        </View>
        <View style={styles.identityRight}>
          {user?.rating != null ? (
            <Pressable
              onPress={() => router.push('/ratings')}
              style={styles.ratingBlock}
              accessibilityLabel="View my ratings"
            >
              <StarRating score={user.rating} size={13} gap={2} />
              <Text style={styles.ratingValue}>
                {user.rating.toFixed(1)}
                {user.completedCount ? (
                  <Text style={styles.ratingCount}> · {user.completedCount} tasks</Text>
                ) : null}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => setEditProfileOpen(true)}
            hitSlop={10}
            style={styles.editBtn}
            accessibilityLabel="Edit profile"
          >
            <Icon name="key" size={16} color={colors.clay} />
          </Pressable>
        </View>
      </Card>

      <Section title="Verification">
        <Card padded={false} style={styles.list}>
          <ListRow
            icon="shield"
            title="KYC status"
            subtitle={
              kyc === 'PENDING' || kyc === 'VERIFIED'
                ? 'Under review — we\'ll notify you when done'
                : kyc === 'TIER_APPROVED'
                  ? 'Verified · tap to add a tier or re-verify'
                  : 'Identity & tier verification'
            }
            right={<StatusPill status={toCanonical(kyc)} small label={kyc} />}
            onPress={
              kyc === 'PENDING' || kyc === 'VERIFIED'
                ? undefined
                : () => router.push('/(auth)/kyc')
            }
            chevron={kyc !== 'PENDING' && kyc !== 'VERIFIED'}
          />
        </Card>
      </Section>

      <Section title="Security">
        <Card padded={false} style={styles.list}>
          <ListRow
            icon="shield"
            title="Two-factor authentication"
            subtitle="Add a code from an authenticator app"
            right={
              <StatusPill
                status={user?.totpEnabled ? 'paid' : 'pending'}
                small
                label={user?.totpEnabled ? 'On' : 'Off'}
              />
            }
            onPress={() => router.push('/security')}
          />
        </Card>
      </Section>

      <Section title="Contracts">
        <Card padded={false} style={styles.list}>
          {contracts.loading && !contracts.data ? (
            <View style={{ paddingVertical: spacing.lg }}>
              <LoadingState />
            </View>
          ) : (contracts.data?.length ?? 0) === 0 ? (
            <ListRow
              icon="id"
              title="No contracts yet"
              subtitle="Service agreements appear once you're approved for a task."
              chevron={false}
            />
          ) : (
            (contracts.data ?? []).map((c, i) => (
              <View key={c.id}>
                <ContractRow contract={c} />
                {i < (contracts.data?.length ?? 0) - 1 ? <Divider /> : null}
              </View>
            ))
          )}
        </Card>
      </Section>

      <Section title="Payments & tax">
        <Card padded={false} style={styles.list}>
          <ListRow
            icon="bank"
            title="Bank account"
            subtitle={user?.bankMasked ?? 'Tap to add your payout account'}
            onPress={() => setEditBankOpen(true)}
          />
          <Divider />
          <ListRow
            icon="wallet"
            title="Tax ID (TIN)"
            subtitle={user?.tin ?? 'Tap to add your TIN for WHT statements'}
            onPress={() => setEditTinOpen(true)}
          />
        </Card>
      </Section>

      <Section title="Notifications">
        <Card style={styles.notif}>
          <NotifRow
            label="Task matches & approvals"
            value={notifTasks ?? true}
            onChange={(v) => { setNotifTasks(v); void saveNotif({ notifTasks: v }); }}
          />
          <Divider />
          <NotifRow
            label="Payments & withdrawals"
            value={notifPay ?? true}
            onChange={(v) => { setNotifPay(v); void saveNotif({ notifPay: v }); }}
          />
          <Divider />
          <NotifRow
            label="Email summaries"
            value={notifEmail ?? false}
            onChange={(v) => { setNotifEmail(v); void saveNotif({ notifEmail: v }); }}
          />
        </Card>
        {notifSaveError ? (
          <Text style={styles.notifError}>{notifSaveError}</Text>
        ) : null}
      </Section>

      <Section title="Support">
        <Card padded={false} style={styles.list}>
          <ListRow icon="alert" title="Disputes" onPress={() => router.push('/disputes')} />
          <Divider />
          <ListRow icon="clock" title="Timesheets" subtitle="Track submitted hours and approval status" onPress={() => router.push('/timesheets')} />
          <Divider />
          <ListRow icon="star" title="My ratings" subtitle="See feedback from task managers" onPress={() => router.push('/ratings')} />
          <Divider />
          <ListRow icon="bell" title="Help & support" onPress={() => router.push('/support')} />
        </Card>
      </Section>

      <View style={{ marginTop: spacing.xl }}>
        <Button label="Log out" variant="secondary" icon="logout" onPress={confirmLogout} />
      </View>
      <Text style={styles.version}>Afrizone Part Time · v1.0.0</Text>

      {/* Edit sheets */}
      <EditProfileSheet
        visible={editProfileOpen}
        user={user}
        onClose={() => setEditProfileOpen(false)}
        onSaved={onSaved}
      />
      <EditBankSheet
        visible={editBankOpen}
        user={user}
        onClose={() => setEditBankOpen(false)}
        onSaved={onSaved}
      />
      <EditTinSheet
        visible={editTinOpen}
        user={user}
        onClose={() => setEditTinOpen(false)}
        onSaved={onSaved}
      />
    </Screen>
  );
}

// ─── Edit Profile (name + email) ─────────────────────────────────────────────

function EditProfileSheet({
  visible,
  user,
  onClose,
  onSaved,
}: {
  visible: boolean;
  user: User | null | undefined;
  onClose: () => void;
  onSaved: (u: User) => void;
}) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = name.trim().length >= 2 && /^\S+@\S+\.\S+$/.test(email.trim());

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.patchMe({ name: name.trim(), email: email.trim() });
      onSaved(updated);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.xl }]}>
          <View style={styles.grabber} />
          <Text style={styles.sheetTitle}>Edit profile</Text>
          <View style={styles.fields}>
            <SheetField label="Full name">
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Your full name"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                autoCapitalize="words"
              />
            </SheetField>
            <SheetField label="Email">
              <TextInput
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                placeholder="you@email.com"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
              />
            </SheetField>
          </View>
          {error ? <Banner tone="danger" title="Error" message={error} /> : null}
          <Button label="Save changes" onPress={save} loading={busy} disabled={!canSave || busy} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Edit Bank Account ────────────────────────────────────────────────────────

function EditBankSheet({
  visible,
  user,
  onClose,
  onSaved,
}: {
  visible: boolean;
  user: User | null | undefined;
  onClose: () => void;
  onSaved: (u: User) => void;
}) {
  const insets = useSafeAreaInsets();
  const [bankCode, setBankCode] = useState(user?.bankCode ?? '');
  const [acct, setAcct] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedBank = NIGERIAN_BANKS.find((b) => b.code === bankCode);
  const canSave = !!bankCode && acct.replace(/\D/g, '').length === 10;

  async function save() {
    setBusy(true);
    setError(null);
    const nuban = acct.replace(/\D/g, '');
    try {
      const updated = await api.patchMe({
        bankCode,
        bankAccountNumber: nuban,
        bankName: selectedBank?.name,
      });
      onSaved(updated);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.xl }]}>
          <View style={styles.grabber} />
          <Text style={styles.sheetTitle}>Payout account</Text>
          {user?.bankMasked ? (
            <Text style={styles.sheetSub}>Current: {user.bankMasked}</Text>
          ) : null}
          <View style={styles.fields}>
            <SheetField label="Bank">
              <Pressable
                onPress={() => setPickerOpen(true)}
                style={[styles.input, styles.pickerTrigger]}
                accessibilityRole="button"
              >
                <Text style={[styles.pickerTriggerText, !selectedBank && { color: colors.textMuted }]}>
                  {selectedBank ? selectedBank.name : 'Select your bank…'}
                </Text>
                <Icon name="chevron-down" size={18} color={colors.textMuted} />
              </Pressable>
            </SheetField>
            <SheetField label="Account number (NUBAN)" hint="10-digit number — payouts go here">
              <TextInput
                value={acct}
                onChangeText={(t) => setAcct(t.replace(/\D/g, '').slice(0, 10))}
                keyboardType="number-pad"
                placeholder="0123456789"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                maxLength={10}
              />
              {acct.length > 0 && acct.length < 10 ? (
                <Text style={styles.fieldHint}>{10 - acct.length} more digits needed</Text>
              ) : acct.length === 10 ? (
                <Text style={[styles.fieldHint, { color: colors.money }]}>✓ Valid NUBAN</Text>
              ) : null}
            </SheetField>
          </View>
          {error ? <Banner tone="danger" title="Error" message={error} /> : null}
          <Button label="Save account" onPress={save} loading={busy} disabled={!canSave || busy} />
        </View>
      </KeyboardAvoidingView>

      {/* Bank picker modal */}
      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPickerOpen(false)} />
        <View style={[styles.pickerSheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.grabber} />
          <Text style={styles.sheetTitle}>Select bank</Text>
          <FlatList
            data={NIGERIAN_BANKS}
            keyExtractor={(b) => b.code}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => { setBankCode(item.code); setPickerOpen(false); }}
                style={[styles.bankItem, bankCode === item.code && styles.bankItemActive]}
              >
                <Text style={[styles.bankItemText, bankCode === item.code && { color: colors.clay, fontWeight: '700' }]}>
                  {item.name}
                </Text>
                {bankCode === item.code ? <Icon name="check" size={18} color={colors.clay} /> : null}
              </Pressable>
            )}
            ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.line }} />}
          />
        </View>
      </Modal>
    </Modal>
  );
}

// ─── Edit TIN ─────────────────────────────────────────────────────────────────

function EditTinSheet({
  visible,
  user,
  onClose,
  onSaved,
}: {
  visible: boolean;
  user: User | null | undefined;
  onClose: () => void;
  onSaved: (u: User) => void;
}) {
  const insets = useSafeAreaInsets();
  const [tin, setTin] = useState(user?.tin ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = tin.trim().length === 0 || tin.trim().length >= 8;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.patchMe({ tin: tin.trim() });
      onSaved(updated);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.xl }]}>
          <View style={styles.grabber} />
          <Text style={styles.sheetTitle}>Tax ID (TIN)</Text>
          <Text style={styles.sheetSub}>Used on WHT deduction statements issued to you.</Text>
          <View style={styles.fields}>
            <SheetField label="TIN" hint="e.g. 12345678-0001">
              <TextInput
                value={tin}
                onChangeText={setTin}
                placeholder="12345678-0001"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                autoCapitalize="none"
              />
            </SheetField>
          </View>
          {error ? <Banner tone="danger" title="Error" message={error} /> : null}
          <Button label="Save TIN" onPress={save} loading={busy} disabled={!canSave || busy} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function SheetField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

function ContractRow({ contract }: { contract: Contract }) {
  const router = useRouter();
  const signed = contract.status === 'SIGNED';

  return (
    <Pressable
      style={styles.contractRow}
      onPress={() => router.push(`/contract/${contract.id}`)}
      accessibilityRole="button"
    >
      <Icon name="id" size={20} color={colors.clay} />
      <View style={styles.contractBody}>
        <Text style={styles.contractTitle} numberOfLines={2}>
          {contract.task?.title ?? 'Service agreement'}
        </Text>
        <Text style={styles.contractSub}>
          {signed ? 'Tap to view' : 'Review & sign'}
        </Text>
      </View>
      {signed ? (
        <StatusPill status="paid" small label="Signed" />
      ) : (
        <View style={styles.contractCta}>
          <Text style={styles.contractCtaText}>Sign</Text>
          <Icon name="chevron-right" size={16} color={colors.clay} />
        </View>
      )}
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: spacing.xl }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function NotifRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.notifRow}>
      <Text style={styles.notifLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.clay, false: colors.line }}
        thumbColor={colors.white}
        accessibilityLabel={label}
      />
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.gold, fontSize: type.size.lg, fontWeight: '800' },
  identityBody: { flex: 1, gap: spacing.xs },
  identityRight: { alignItems: 'center', gap: spacing.sm },
  name: { color: colors.text, fontSize: type.size.lg, fontWeight: '800' },
  tiers: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  ratingBlock: { alignItems: 'center', gap: spacing.xs },
  ratingValue: { color: colors.text, fontSize: type.size.sm, fontWeight: '700', marginTop: 1 },
  ratingCount: { color: colors.textMuted, fontSize: type.size.xs, fontWeight: '400' },
  editBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.claySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: type.size.sm,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  list: { paddingHorizontal: spacing.lg },
  contractRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  contractBody: { flex: 1, gap: 2 },
  contractTitle: { color: colors.text, fontSize: type.size.base, fontWeight: '700' },
  contractSub: { color: colors.textMuted, fontSize: type.size.xs },
  contractCta: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  contractCtaText: { color: colors.clay, fontWeight: '700', fontSize: type.size.base },
  notif: { gap: 0 },
  notifError: { color: colors.danger, fontSize: type.size.sm, marginTop: spacing.xs },
  notifRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    minHeight: 44,
  },
  notifLabel: { color: colors.text, fontSize: type.size.md, fontWeight: '600', flex: 1, paddingRight: spacing.md },
  divider: { height: 1, backgroundColor: colors.line },
  version: { color: colors.textMuted, fontSize: type.size.sm, textAlign: 'center', marginTop: spacing.lg },
  // sheets
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
  sheetSub: { color: colors.textMuted, fontSize: type.size.base, marginTop: -spacing.xs },
  fields: { gap: spacing.md },
  fieldLabel: { color: colors.textMuted, fontSize: type.size.sm, fontWeight: '600' },
  fieldHint: { color: colors.textMuted, fontSize: type.size.sm },
  input: {
    minHeight: layout.hitTarget,
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
    fontSize: type.size.md,
    color: colors.text,
  },
  pickerTrigger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pickerTriggerText: { fontSize: type.size.md, color: colors.text, flex: 1 },
  pickerSheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    padding: layout.screenPadding,
    maxHeight: '70%',
  },
  bankItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  bankItemActive: {
    backgroundColor: colors.claySoft,
    marginHorizontal: -layout.screenPadding,
    paddingHorizontal: layout.screenPadding,
  },
  bankItemText: { fontSize: type.size.base, color: colors.text },
});
