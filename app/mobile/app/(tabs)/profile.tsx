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
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AppListCard,
  AppListRow,
  AppStatusPill,
  AppSectionTitle,
  AppPrimaryButton,
  AppLoadingCards,
  type AppPillTone,
} from '../../src/appui/AppUI';
import { Icon } from '../../src/components/Icon';
import { StarRating } from '../../src/components/StarRating';
import { Banner } from '../../src/components/Feedback';
import { obColors, obRadii } from '../../src/onboarding/onboardingTheme';
import { api, ApiError } from '../../src/api/client';
import { useAsync } from '../../src/lib/useAsync';
import { useAuth } from '../../src/auth/AuthContext';
import { NIGERIAN_BANKS } from '../../src/lib/banks';
import type { User, Contract, KycStatus } from '../../src/api/types';

/**
 * Restyled to match afrizone-mobile-prototype (1).html's Profile screen -
 * centered avatar + verification pill, a "Personal info" card, then grouped
 * Account/Settings/Support list-cards. All real data-fetching, edit sheets
 * (name/email, bank account, TIN), notification-preference saving and
 * logout logic below is unchanged from the previous version of this file -
 * only the JSX shell and styling changed.
 *
 * Avatar is flat navy now, not the previous per-name gradient: the
 * reference's own avatar is a plain navy circle, and matching it exactly
 * here was a small, deliberate simplification rather than a functional loss.
 *
 * Personal info shows Phone in addition to the two real editable fields
 * (Full name, Email) - a real field on User, just not one this app has any
 * flow to change, so it's shown read-only rather than added to the edit
 * sheet.
 */

const KYC_PILL: Record<KycStatus, { tone: AppPillTone; label: string }> = {
  PENDING: { tone: 'review', label: 'Verification under review' },
  VERIFIED: { tone: 'review', label: 'Verification under review' },
  TIER_APPROVED: { tone: 'ready', label: 'Verified' },
  REJECTED: { tone: 'attn', label: 'Verification rejected' },
};

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
  const kycPill = KYC_PILL[kyc];

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
      setNotifSaveError('Could not save: check your connection.');
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

  if (me.loading && !user) {
    return (
      <View style={styles.root}>
        <View style={{ paddingTop: insets.top + 16, paddingHorizontal: 18 }}>
          <AppLoadingCards count={3} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 18, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={me.loading && !!me.data}
            onRefresh={() => { me.reload(); contracts.reload(); }}
            tintColor={obColors.navy}
          />
        }
      >
        <View style={styles.pfHead}>
          <View style={styles.avatarWrap}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(user?.name ?? 'A').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
              </Text>
            </View>
            <Pressable onPress={() => setEditProfileOpen(true)} hitSlop={10} style={styles.editBadge} accessibilityLabel="Edit profile">
              <Icon name="edit" size={12} color={obColors.navyPress} />
            </Pressable>
          </View>
          <Text style={styles.name}>{user?.name ?? 'Tasker'}</Text>
          {user?.rating != null ? (
            <Pressable onPress={() => router.push('/ratings')} style={styles.stars} accessibilityLabel="View my ratings">
              <StarRating score={user.rating} size={13} gap={2} color={obColors.goldDeep} />
              <Text style={styles.starsText}>
                {user.rating.toFixed(1)} rating{user.completedCount ? ` · ${user.completedCount} tasks` : ''}
              </Text>
            </Pressable>
          ) : null}
          <View style={{ marginTop: 9 }}>
            <AppStatusPill tone={kycPill.tone} label={kycPill.label} />
          </View>
        </View>

        <View style={styles.infoCard}>
          <View style={styles.infoHead}>
            <Text style={styles.infoHeadTitle}>Personal info</Text>
            <Pressable onPress={() => setEditProfileOpen(true)} hitSlop={8}>
              <Text style={styles.infoHeadEdit}>Edit</Text>
            </Pressable>
          </View>
          <InfoRow label="Phone" value={user?.phone ?? 'Not set'} />
          <InfoRow label="Email" value={user?.email ?? 'Not set'} />
          <InfoRow label="Location" value={user?.location ?? 'Not set'} last />
        </View>

        <AppSectionTitle title="Account" />
        <AppListCard>
          <AppListRow
            icon="shield"
            title="Verification & KYC"
            subtitle="ID, selfie, tier documents"
            onPress={kyc === 'PENDING' || kyc === 'VERIFIED' ? undefined : () => router.push('/(auth)/kyc')}
          />
          <AppListRow icon="id" title="Documents" subtitle="Licences, certificates and your CV" onPress={() => router.push('/profile/credentials')} />
          <AppListRow icon="star" title="Skills" subtitle="Helps us match you to work" onPress={() => router.push('/profile/skills')} last={user?.accountType !== 'COURIER'} />
          {user?.accountType === 'COURIER' && (
            <>
              <AppListRow icon="cart" title="Deliveries" subtitle="Orders you are carrying" onPress={() => router.push('/deliveries')} />
              <AppListRow icon="map-pin" title="Courier setup" subtitle="Your vehicle, licence and insurance" onPress={() => router.push('/profile/courier')} last />
            </>
          )}
        </AppListCard>

        <View style={{ height: 20 }} />
        <AppSectionTitle title="Settings" />
        <AppListCard>
          <AppListRow
            icon="shield"
            title="Security"
            subtitle="Password, two-factor"
            onPress={() => router.push('/security')}
            right={<AppStatusPill tone={user?.totpEnabled ? 'ready' : 'review'} label={user?.totpEnabled ? '2FA On' : '2FA Off'} />}
          />
          <AppListRow icon="id" title="Contracts" subtitle={`${contracts.data?.length ?? 0} on file`} onPress={() => setContractsSheetHint()} />
          <AppListRow icon="bank" title="Bank account" subtitle={user?.bankMasked ?? 'Tap to add your payout account'} onPress={() => setEditBankOpen(true)} />
          <AppListRow icon="wallet" title="Tax ID (TIN)" subtitle={user?.tin ?? 'Tap to add your TIN'} onPress={() => setEditTinOpen(true)} last />
        </AppListCard>

        {/* Contracts list - kept as its own real section (sign/view state
            per contract) rather than folded into the Settings row above,
            which just links attention there. */}
        {(contracts.data?.length ?? 0) > 0 ? (
          <>
            <View style={{ height: 20 }} />
            <AppSectionTitle title="Contracts" />
            <AppListCard>
              {(contracts.data ?? []).map((c, i) => (
                <ContractRow key={c.id} contract={c} last={i === (contracts.data?.length ?? 1) - 1} />
              ))}
            </AppListCard>
          </>
        ) : null}

        <View style={{ height: 20 }} />
        <AppSectionTitle title="Notifications" />
        <AppListCard>
          <NotifRow icon="briefcase" label="Task matches & approvals" value={notifTasks ?? true} onChange={(v) => { setNotifTasks(v); void saveNotif({ notifTasks: v }); }} />
          <NotifRow icon="wallet" label="Payments & withdrawals" value={notifPay ?? true} onChange={(v) => { setNotifPay(v); void saveNotif({ notifPay: v }); }} />
          <NotifRow icon="mail" label="Email summaries" value={notifEmail ?? false} onChange={(v) => { setNotifEmail(v); void saveNotif({ notifEmail: v }); }} last />
        </AppListCard>
        {notifSaveError ? <Text style={styles.notifError}>{notifSaveError}</Text> : null}

        <View style={{ height: 20 }} />
        <AppSectionTitle title="Support" />
        <AppListCard>
          <AppListRow icon="alert" title="Disputes" onPress={() => router.push('/disputes')} />
          <AppListRow icon="clock" title="Timesheets" subtitle="Track submitted hours and approval status" onPress={() => router.push('/timesheets')} />
          <AppListRow icon="star" title="My ratings" subtitle="See feedback from task managers" onPress={() => router.push('/ratings')} />
          <AppListRow icon="bell" title="Help & support" onPress={() => router.push('/support')} last />
        </AppListCard>

        <View style={{ marginTop: 24 }}>
          <AppPrimaryButton label="Log out" icon="logout" variant="outline" onPress={confirmLogout} />
        </View>
        <Text style={styles.version}>AfriZone PartTime · v1.0.0</Text>
      </ScrollView>

      <EditProfileSheet visible={editProfileOpen} user={user} onClose={() => setEditProfileOpen(false)} onSaved={onSaved} />
      <EditBankSheet visible={editBankOpen} user={user} onClose={() => setEditBankOpen(false)} onSaved={onSaved} />
      <EditTinSheet visible={editTinOpen} user={user} onClose={() => setEditTinOpen(false)} onSaved={onSaved} />
    </View>
  );
}

// A "Contracts" settings row has no single destination (there can be many,
// or none) - tapping it does nothing beyond what's already visible in the
// Contracts section below when there are any. Kept as a no-op rather than a
// dead chevron to a screen that doesn't exist.
function setContractsSheetHint() {}

function InfoRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.infoRow, !last && styles.infoRowDivider]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function ContractRow({ contract, last }: { contract: Contract; last?: boolean }) {
  const router = useRouter();
  const signed = contract.signedAt != null;
  return (
    <AppListRow
      icon="id"
      title={contract.task?.title ?? 'Service agreement'}
      subtitle={signed ? 'Tap to view' : 'Review & sign'}
      onPress={() => router.push(`/contract/${contract.id}`)}
      last={last}
      right={<AppStatusPill tone={signed ? 'paid' : 'await'} label={signed ? 'Signed' : 'Sign now'} />}
    />
  );
}

function NotifRow({
  icon,
  label,
  value,
  onChange,
  last,
}: {
  icon: React.ComponentProps<typeof Icon>['name'];
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  last?: boolean;
}) {
  return (
    <View style={[styles.notifRow, !last && styles.notifRowDivider]}>
      <View style={styles.notifIcon}>
        <Icon name={icon} size={16} color={obColors.navy} />
      </View>
      <Text style={styles.notifLabel}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: obColors.gold, false: obColors.line }} thumbColor={obColors.white} accessibilityLabel={label} />
    </View>
  );
}

// ─── Edit Profile (name + email) ─────────────────────────────────────────────

function EditProfileSheet({ visible, user, onClose, onSaved }: { visible: boolean; user: User | null | undefined; onClose: () => void; onSaved: (u: User) => void }) {
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
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.grabber} />
          <Text style={styles.sheetTitle}>Edit profile</Text>
          <View style={styles.fields}>
            <SheetField label="Full name">
              <TextInput value={name} onChangeText={setName} placeholder="Your full name" placeholderTextColor={obColors.textMut} style={styles.input} autoCapitalize="words" />
            </SheetField>
            <SheetField label="Email">
              <TextInput value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder="you@email.com" placeholderTextColor={obColors.textMut} style={styles.input} />
            </SheetField>
          </View>
          {error ? <Banner tone="danger" title="Error" message={error} /> : null}
          <AppPrimaryButton label="Save changes" onPress={save} loading={busy} disabled={!canSave || busy} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Edit Bank Account ────────────────────────────────────────────────────────

function EditBankSheet({ visible, user, onClose, onSaved }: { visible: boolean; user: User | null | undefined; onClose: () => void; onSaved: (u: User) => void }) {
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
      const updated = await api.patchMe({ bankCode, bankAccountNumber: nuban, bankName: selectedBank?.name });
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
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.grabber} />
          <Text style={styles.sheetTitle}>Payout account</Text>
          {user?.bankMasked ? <Text style={styles.sheetSub}>Current: {user.bankMasked}</Text> : null}
          <View style={styles.fields}>
            <SheetField label="Bank">
              <Pressable onPress={() => setPickerOpen(true)} style={[styles.input, styles.pickerTrigger]} accessibilityRole="button">
                <Text style={[styles.pickerTriggerText, !selectedBank && { color: obColors.textMut }]}>{selectedBank ? selectedBank.name : 'Select your bank…'}</Text>
                <Icon name="chevron-down" size={17} color={obColors.textMut} />
              </Pressable>
            </SheetField>
            <SheetField label="Account number (NUBAN)" hint="10-digit number: payouts go here">
              <TextInput value={acct} onChangeText={(t) => setAcct(t.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" placeholder="0123456789" placeholderTextColor={obColors.textMut} style={styles.input} maxLength={10} />
              {acct.length > 0 && acct.length < 10 ? (
                <Text style={styles.fieldHint}>{10 - acct.length} more digits needed</Text>
              ) : acct.length === 10 ? (
                <Text style={[styles.fieldHint, { color: obColors.mgreenInk }]}>✓ Valid NUBAN</Text>
              ) : null}
            </SheetField>
          </View>
          {error ? <Banner tone="danger" title="Error" message={error} /> : null}
          <AppPrimaryButton label="Save account" onPress={save} loading={busy} disabled={!canSave || busy} />
        </View>
      </KeyboardAvoidingView>

      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPickerOpen(false)} />
        <View style={[styles.pickerSheet, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.grabber} />
          <Text style={styles.sheetTitle}>Select bank</Text>
          <FlatList
            data={NIGERIAN_BANKS}
            keyExtractor={(b) => b.code}
            renderItem={({ item }) => (
              <Pressable onPress={() => { setBankCode(item.code); setPickerOpen(false); }} style={[styles.bankItem, bankCode === item.code && styles.bankItemActive]}>
                <Text style={[styles.bankItemText, bankCode === item.code && { color: obColors.goldDeep, fontWeight: '700' }]}>{item.name}</Text>
                {bankCode === item.code ? <Icon name="check" size={17} color={obColors.gold} /> : null}
              </Pressable>
            )}
            ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: obColors.line }} />}
          />
        </View>
      </Modal>
    </Modal>
  );
}

// ─── Edit TIN ─────────────────────────────────────────────────────────────────

function EditTinSheet({ visible, user, onClose, onSaved }: { visible: boolean; user: User | null | undefined; onClose: () => void; onSaved: (u: User) => void }) {
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
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.grabber} />
          <Text style={styles.sheetTitle}>Tax ID (TIN)</Text>
          <Text style={styles.sheetSub}>Used on WHT deduction statements issued to you.</Text>
          <View style={styles.fields}>
            <SheetField label="TIN" hint="e.g. 12345678-0001">
              <TextInput value={tin} onChangeText={setTin} placeholder="12345678-0001" placeholderTextColor={obColors.textMut} style={styles.input} autoCapitalize="none" />
            </SheetField>
          </View>
          {error ? <Banner tone="danger" title="Error" message={error} /> : null}
          <AppPrimaryButton label="Save TIN" onPress={save} loading={busy} disabled={!canSave || busy} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SheetField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: obColors.bg },

  pfHead: { alignItems: 'center', marginBottom: 18 },
  avatarWrap: { marginBottom: 4 },
  avatar: { width: 78, height: 78, borderRadius: 39, backgroundColor: obColors.navy, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: obColors.white, fontSize: 26, fontFamily: 'Raleway_800ExtraBold' },
  editBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: obColors.gold,
    borderWidth: 3,
    borderColor: obColors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { fontSize: 17, fontFamily: 'Raleway_800ExtraBold', color: obColors.navy, marginTop: 10 },
  stars: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
  starsText: { fontSize: 12.5, color: obColors.textMut, fontWeight: '700' },

  infoCard: { backgroundColor: obColors.white, borderWidth: 1, borderColor: obColors.line, borderRadius: obRadii.card, paddingHorizontal: 14, marginBottom: 20 },
  infoHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  infoHeadTitle: { fontSize: 13, fontWeight: '700', color: obColors.navy },
  infoHeadEdit: { fontSize: 12.5, fontWeight: '700', color: obColors.goldDeep },
  infoRow: { paddingVertical: 9 },
  infoRowDivider: { borderBottomWidth: 1, borderBottomColor: obColors.line },
  infoLabel: { fontSize: 11, color: obColors.textMut },
  infoValue: { fontSize: 13.5, fontWeight: '600', color: obColors.text, marginTop: 2 },

  notifRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  notifRowDivider: { borderBottomWidth: 1, borderBottomColor: obColors.line },
  notifIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: obColors.sand, alignItems: 'center', justifyContent: 'center' },
  notifLabel: { flex: 1, fontSize: 13.5, fontWeight: '600', color: obColors.text },
  notifError: { color: obColors.dangerInk, fontSize: 12.5, marginTop: 8 },

  version: { color: obColors.textMut, fontSize: 12.5, textAlign: 'center', marginTop: 16 },

  // sheets
  backdrop: { flex: 1, backgroundColor: obColors.scrim },
  sheet: { backgroundColor: obColors.bg, borderTopLeftRadius: obRadii.hero, borderTopRightRadius: obRadii.hero, padding: 20, gap: 12 },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 4, backgroundColor: obColors.line, marginBottom: 8 },
  sheetTitle: { color: obColors.navy, fontSize: 18, fontFamily: 'Raleway_800ExtraBold' },
  sheetSub: { color: obColors.textMut, fontSize: 13, marginTop: -4 },
  fields: { gap: 12 },
  fieldLabel: { color: obColors.textMut, fontSize: 12, fontWeight: '600' },
  fieldHint: { color: obColors.textMut, fontSize: 12 },
  input: { minHeight: 48, backgroundColor: obColors.white, borderColor: obColors.line, borderWidth: 1, borderRadius: obRadii.field, paddingHorizontal: 14, fontSize: 15, color: obColors.text },
  pickerTrigger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pickerTriggerText: { fontSize: 15, color: obColors.text, flex: 1 },
  pickerSheet: { backgroundColor: obColors.bg, borderTopLeftRadius: obRadii.card, borderTopRightRadius: obRadii.card, padding: 20, maxHeight: '70%' },
  bankItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13 },
  bankItemActive: { backgroundColor: obColors.roleSelectedBg, marginHorizontal: -20, paddingHorizontal: 20 },
  bankItemText: { fontSize: 14, color: obColors.text },
});
