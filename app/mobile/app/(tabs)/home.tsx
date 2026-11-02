import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Modal,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppKpiCard, AppBanner, AppSearchBar, AppChipRow, AppChip, AppSectionTitle, AppEmptyState, AppErrorState, AppLoadingCards } from '../../src/appui/AppUI';
import { AppTaskCard } from '../../src/appui/AppTaskCard';
import { AppNotificationBell } from '../../src/appui/AppNotificationBell';
import { Icon } from '../../src/components/Icon';
import { obColors, obRadii } from '../../src/onboarding/onboardingTheme';
import { api } from '../../src/api/client';
import { useAsync } from '../../src/lib/useAsync';
import { OfflineNote, OutboxBanner } from '../../src/components/OfflineStatus';
import { CourierDeliveryBanner } from '../../src/components/CourierDeliveryBanner';
import { useAuth } from '../../src/auth/AuthContext';
import StoreHomeScreen from '../store';
import type { Task, Wallet, Tier } from '../../src/api/types';

/**
 * Restyled to match C:\Users\hb\Downloads\afrizone-mobile-prototype
 * (1).html's Home screen - first of the main-app screens being redone this
 * way (rollout is one screen at a time; see src/appui/AppUI.tsx's header for
 * why the shared components aren't edited in place). All the real state,
 * data-fetching, filtering, tier-eligibility bucketing and KYC banner logic
 * below is unchanged from the previous version of this file - only the JSX
 * shell and styling changed.
 *
 * No shared <Screen> wrapper here: the prototype's Home has no separate
 * header bar at all - the greeting is the first thing in the scrollable
 * content, not app chrome - so this builds its own minimal shell instead of
 * stretching the shared one (used by every other tab) to fit a layout only
 * this screen has.
 */

const ALL_TIERS: Tier[] = ['STUDENT', 'DISPATCH', 'REMOTE', 'PROMO', 'TRADE'];
const TIER_LABEL: Record<Tier, string> = {
  STUDENT: 'Student',
  DISPATCH: 'Dispatch',
  REMOTE: 'Remote',
  PROMO: 'Promo',
  TRADE: 'Trade',
};

type PayFilter = '' | 'HOURLY' | 'FIXED';
type LocFilter = '' | 'PHYSICAL' | 'REMOTE';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  // A STORE account's "Home" is the store dashboard, not the worker task
  // feed below - accountType doesn't change without a re-login, so this
  // branch is stable for the lifetime of a mounted HomeScreen and doesn't
  // break the rules of hooks (nothing below runs for a STORE session, every
  // render, consistently).
  if (user?.accountType === 'STORE') return <StoreHomeScreen />;

  const [q, setQ] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [payFilter, setPayFilter] = useState<PayFilter>('');
  const [locFilter, setLocFilter] = useState<LocFilter>('');
  const [tierFilter, setTierFilter] = useState<Tier[]>([]);
  // The prototype's quick chip row is single-select by category (All /
  // Delivery / Promo / Warehouse...), not by tier - tier stays a real filter
  // dimension, just moved into the sheet alongside pay/location instead of
  // being the inline row, per that reference.
  const [categoryFilter, setCategoryFilter] = useState('');

  const tasks = useAsync<Task[]>((signal) => api.tasks(signal), [], { cacheKey: 'tasks' });
  const walletQ = useAsync<Wallet>((signal) => api.myWallet(signal), [], { cacheKey: 'wallet' });

  const firstName = user?.name?.split(' ')[0] ?? 'there';
  const wallet = walletQ.data ?? { pending: 0, available: 0, withdrawn: 0 };
  const kycStatus = user?.kycStatus;
  const kycRejected = kycStatus === 'REJECTED';
  const kycInReview = kycStatus === 'PENDING' || kycStatus === 'VERIFIED';
  const kycIncomplete = user
    ? kycStatus !== 'TIER_APPROVED' && !kycRejected && !kycInReview
    : false;

  const filtersActive =
    q.trim() !== '' || payFilter !== '' || locFilter !== '' || tierFilter.length > 0 || categoryFilter !== '';

  const open = useMemo(
    () => (tasks.data ?? []).filter((t) => t.status === 'OPEN'),
    [tasks.data]
  );

  // Real categories, not a fixed list - whatever's actually open right now,
  // in the order they first appear.
  const categories = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of open) {
      if (t.category && !seen.has(t.category)) {
        seen.add(t.category);
        out.push(t.category);
      }
    }
    return out;
  }, [open]);

  const filteredOpen = useMemo(() => {
    if (!filtersActive) return open;
    const qLow = q.toLowerCase().trim();
    return open.filter((t) => {
      if (qLow && !t.title.toLowerCase().includes(qLow) && !t.category.toLowerCase().includes(qLow))
        return false;
      if (categoryFilter && t.category !== categoryFilter) return false;
      if (payFilter && t.payModel !== payFilter) return false;
      if (locFilter && t.locationType !== locFilter) return false;
      if (tierFilter.length > 0 && !tierFilter.includes(t.tier)) return false;
      return true;
    });
  }, [open, q, payFilter, locFilter, tierFilter, categoryFilter, filtersActive]);

  /**
   * Three buckets, decided by the server rather than by matching tiers here.
   *
   *   ready    - the worker can apply right now.
   *   fixable  - they cannot, but everything stopping them is something they
   *              can do: upload a document, declare a skill, verify their ID.
   *   locked   - nothing they can do from the app. In practice this is the
   *              wrong tier, which an admin grants.
   *
   * The split that matters is fixable vs locked, not matched vs unmatched. A
   * task one document away is a reason to open the app tomorrow; a task in a
   * tier they do not have is not, and running them together buries the first
   * kind in the second.
   */
  const { ready, fixable, locked } = useMemo(() => {
    const out = { ready: [] as Task[], fixable: [] as Task[], locked: [] as Task[] };
    for (const t of open) {
      const el = t.eligibility;
      if (!el || el.eligible) out.ready.push(t);
      else if (el.blockers.some((b) => b.fix !== null)) out.fixable.push(t);
      else out.locked.push(t);
    }
    return out;
  }, [open]);

  function clearFilters() {
    setQ('');
    setPayFilter('');
    setLocFilter('');
    setTierFilter([]);
    setCategoryFilter('');
  }

  function toggleTier(tier: Tier) {
    setTierFilter((prev) =>
      prev.includes(tier) ? prev.filter((t) => t !== tier) : [...prev, tier]
    );
  }

  const activeChips: { label: string; onRemove: () => void }[] = [
    ...(payFilter ? [{ label: payFilter === 'HOURLY' ? 'Hourly' : 'Fixed pay', onRemove: () => setPayFilter('') }] : []),
    ...(locFilter ? [{ label: locFilter === 'REMOTE' ? 'Remote' : 'Physical', onRemove: () => setLocFilter('') }] : []),
    ...tierFilter.map((t) => ({ label: TIER_LABEL[t], onRemove: () => toggleTier(t) })),
  ];

  function renderTaskList() {
    if (tasks.loading && !tasks.data) return <AppLoadingCards count={3} />;
    if (tasks.error) return <AppErrorState message={tasks.error} onRetry={tasks.reload} />;

    if (filtersActive) {
      return (
        <>
          <AppSectionTitle title="Results" aside={filteredOpen.length > 0 ? `${filteredOpen.length} tasks` : undefined} />
          {filteredOpen.length === 0 ? (
            <AppEmptyState icon="briefcase" title="No tasks match" message="Try a different search or clear the filters." actionLabel="Clear filters" onAction={clearFilters} />
          ) : (
            <View style={styles.stack}>
              {filteredOpen.map((t) => (
                <AppTaskCard key={t.id} task={t} onPress={() => router.push(`/task/${t.id}`)} />
              ))}
            </View>
          )}
        </>
      );
    }

    return (
      <>
        <AppSectionTitle title="Ready to apply" aside={ready.length > 0 ? `${ready.length} tasks` : undefined} />
        {ready.length === 0 ? (
          <AppEmptyState
            icon="briefcase"
            title="Nothing open for you yet"
            message={
              fixable.length > 0
                ? 'There is work below you can unlock - see what it needs.'
                : 'Add a tier in Profile to see tasks matched to you.'
            }
          />
        ) : (
          <View style={styles.stack}>
            {ready.map((t) => (
              <AppTaskCard key={t.id} task={t} onPress={() => router.push(`/task/${t.id}`)} />
            ))}
          </View>
        )}

        {fixable.length > 0 ? (
          <>
            <AppSectionTitle title="You can unlock these" aside={`${fixable.length} tasks`} />
            <View style={styles.stack}>
              {fixable.map((t) => (
                <AppTaskCard key={t.id} task={t} onPress={() => router.push(`/task/${t.id}`)} />
              ))}
            </View>
          </>
        ) : null}

        {locked.length > 0 ? (
          <>
            <AppSectionTitle title="Other tiers" aside="Admin approval needed" />
            <View style={styles.stack}>
              {locked.map((t) => (
                <AppTaskCard key={t.id} task={t} onPress={() => router.push(`/task/${t.id}`)} />
              ))}
            </View>
          </>
        ) : null}
      </>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 18, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={tasks.loading && !!tasks.data}
            onRefresh={() => { tasks.reload(); walletQ.reload(); }}
            tintColor={obColors.navy}
          />
        }
      >
        <OfflineNote savedAt={tasks.savedAt} />
        <OutboxBanner />
        <View style={styles.topRow}>
          <View>
            <Text style={styles.eyebrow}>{greeting()}</Text>
            <Text style={styles.greetingName}>{firstName}</Text>
          </View>
          <AppNotificationBell />
        </View>

        {/* Above the money, above the search: a delivery is the only work
            here with a customer waiting on it. */}
        <CourierDeliveryBanner />

        <View style={styles.kpiRow}>
          <AppKpiCard icon="wallet" iconColor={obColors.navy} iconBg={obColors.sand} label="Available balance" value={wallet.available} money />
          <AppKpiCard icon="star" iconColor={obColors.goldDeep} iconBg={obColors.roleSelectedBg} label="Your rating" value={user?.rating ?? 0} decimals={1} />
        </View>
        <View style={styles.kpiRow}>
          <AppKpiCard icon="clock" iconColor={obColors.violet} iconBg={obColors.violetBg} label="Pending" value={wallet.pending} money />
          <AppKpiCard icon="check-circle" iconColor={obColors.indigo} iconBg={obColors.indigoBg} label="Tasks completed" value={user?.completedCount ?? 0} />
        </View>

        {kycRejected ? (
          <View style={{ marginBottom: 16 }}>
            <AppBanner icon="shield" title="Verification rejected" message="Re-submit with a clear ID and matching selfie." onPress={() => router.push('/(auth)/kyc')} />
          </View>
        ) : kycInReview ? (
          <View style={{ marginBottom: 16 }}>
            <AppBanner icon="shield" title="Verification in review" message="Applying unlocks once your tier is approved." />
          </View>
        ) : kycIncomplete ? (
          <View style={{ marginBottom: 16 }}>
            <AppBanner icon="shield" title="Finish verifying your ID" message="Unlocks higher-paying tasks near you" onPress={() => router.push('/(auth)/kyc')} />
          </View>
        ) : null}

        <View style={{ marginBottom: 12 }}>
          <AppSearchBar
            value={q}
            onChangeText={setQ}
            placeholder="Search tasks near you"
            onFilterPress={() => setFilterOpen(true)}
            filterActive={filtersActive}
          />
        </View>

        <AppChipRow>
          <AppChip label="All" active={categoryFilter === ''} onPress={() => setCategoryFilter('')} />
          {categories.map((c) => (
            <AppChip key={c} label={c} active={categoryFilter === c} onPress={() => setCategoryFilter(categoryFilter === c ? '' : c)} />
          ))}
        </AppChipRow>

        {activeChips.length > 0 ? (
          <View style={styles.activeChipRow}>
            {activeChips.map((chip) => (
              <Pressable key={chip.label} onPress={chip.onRemove} style={styles.activeChip}>
                <Text style={styles.activeChipText}>{chip.label}</Text>
                <Icon name="close" size={11} color={obColors.goldDeep} />
              </Pressable>
            ))}
            <Pressable onPress={clearFilters} style={styles.clearChip}>
              <Text style={styles.clearChipText}>Clear all</Text>
            </Pressable>
          </View>
        ) : null}

        {renderTaskList()}
      </ScrollView>

      <FilterSheet
        visible={filterOpen}
        payFilter={payFilter}
        locFilter={locFilter}
        tierFilter={tierFilter}
        onPayFilter={setPayFilter}
        onLocFilter={setLocFilter}
        onTierFilter={toggleTier}
        onClear={clearFilters}
        onClose={() => setFilterOpen(false)}
      />
    </View>
  );
}

// ─── Filter sheet ─────────────────────────────────────────────────────────────

function FilterSheet({
  visible,
  payFilter,
  locFilter,
  tierFilter,
  onPayFilter,
  onLocFilter,
  onTierFilter,
  onClear,
  onClose,
}: {
  visible: boolean;
  payFilter: PayFilter;
  locFilter: LocFilter;
  tierFilter: Tier[];
  onPayFilter: (v: PayFilter) => void;
  onLocFilter: (v: LocFilter) => void;
  onTierFilter: (t: Tier) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const hasFilters = payFilter !== '' || locFilter !== '' || tierFilter.length > 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={sheetStyles.backdrop} onPress={onClose} />
      <View style={[sheetStyles.sheet, { paddingBottom: insets.bottom + 20 }]}>
        <View style={sheetStyles.grabber} />
        <View style={sheetStyles.header}>
          <Text style={sheetStyles.title}>Filters</Text>
          {hasFilters ? (
            <Pressable onPress={onClear} hitSlop={8}>
              <Text style={sheetStyles.clearLink}>Clear all</Text>
            </Pressable>
          ) : null}
        </View>

        <SheetGroup label="Pay model">
          {([['', 'Any'], ['HOURLY', 'Hourly'], ['FIXED', 'Fixed']] as [PayFilter, string][]).map(([val, label]) => (
            <AppChip key={val || 'any'} label={label} active={payFilter === val} onPress={() => onPayFilter(val)} />
          ))}
        </SheetGroup>

        <SheetGroup label="Location">
          {([['', 'Any'], ['REMOTE', 'Remote'], ['PHYSICAL', 'Physical']] as [LocFilter, string][]).map(([val, label]) => (
            <AppChip key={val || 'any'} label={label} active={locFilter === val} onPress={() => onLocFilter(val)} />
          ))}
        </SheetGroup>

        <SheetGroup label="Tier">
          {ALL_TIERS.map((t) => (
            <AppChip key={t} label={TIER_LABEL[t]} active={tierFilter.includes(t)} onPress={() => onTierFilter(t)} />
          ))}
        </SheetGroup>

        <Pressable style={sheetStyles.primaryBtn} onPress={onClose}>
          <Text style={sheetStyles.primaryBtnText}>Show results</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function SheetGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8, marginBottom: 18 }}>
      <Text style={sheetStyles.groupLabel}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: obColors.bg },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  eyebrow: { fontSize: 12.5, color: obColors.textMut, fontWeight: '600' },
  greetingName: { fontSize: 21, fontFamily: 'Raleway_800ExtraBold', color: obColors.navy, marginTop: 2 },
  kpiRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  stack: { gap: 10, marginBottom: 20 },
  activeChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: -4, marginBottom: 18 },
  activeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: obColors.roleSelectedBg,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  activeChipText: { color: obColors.goldDeep, fontSize: 12, fontWeight: '700' },
  clearChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: obColors.line },
  clearChipText: { color: obColors.textMut, fontSize: 12, fontWeight: '600' },
});

const sheetStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: obColors.scrim },
  sheet: {
    backgroundColor: obColors.bg,
    borderTopLeftRadius: obRadii.hero,
    borderTopRightRadius: obRadii.hero,
    padding: 20,
    paddingTop: 6,
  },
  grabber: { width: 36, height: 4, backgroundColor: obColors.line, borderRadius: 4, alignSelf: 'center', marginBottom: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  title: { fontSize: 16, fontFamily: 'Raleway_800ExtraBold', color: obColors.navy },
  clearLink: { color: obColors.goldDeep, fontSize: 13, fontWeight: '700' },
  groupLabel: { fontSize: 11.5, fontWeight: '700', color: obColors.textMut, marginLeft: 2 },
  primaryBtn: {
    minHeight: 50,
    borderRadius: obRadii.btn,
    borderTopRightRadius: obRadii.btnCut,
    backgroundColor: obColors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  primaryBtnText: { fontFamily: 'Raleway_800ExtraBold', fontSize: 14, color: obColors.navyPress },
});
