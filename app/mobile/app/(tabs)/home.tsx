import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { Card } from '../../src/components/Card';
import { TaskCard } from '../../src/components/TaskCard';
import { MoneyText } from '../../src/components/MoneyText';
import { Button } from '../../src/components/Button';
import { Banner, LoadingState, ErrorState, EmptyState } from '../../src/components/Feedback';
import { Icon } from '../../src/components/Icon';
import { colors, spacing, type, radii, layout } from '../../src/theme';
import { api } from '../../src/api/client';
import { useAsync } from '../../src/lib/useAsync';
import { useAuth } from '../../src/auth/AuthContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Task, Wallet, Tier } from '../../src/api/types';

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

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [q, setQ] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [payFilter, setPayFilter] = useState<PayFilter>('');
  const [locFilter, setLocFilter] = useState<LocFilter>('');
  const [tierFilter, setTierFilter] = useState<Tier[]>([]);

  const tasks = useAsync<Task[]>((signal) => api.tasks(signal), []);
  const walletQ = useAsync<Wallet>((signal) => api.myWallet(signal), []);

  const firstName = user?.name?.split(' ')[0] ?? 'there';
  const wallet = walletQ.data ?? { pending: 0, available: 0, withdrawn: 0 };
  const myTiers: Tier[] = user?.tiers ?? [];
  const kycStatus = user?.kycStatus;
  const kycRejected = kycStatus === 'REJECTED';
  const kycInReview = kycStatus === 'PENDING' || kycStatus === 'VERIFIED';
  const kycIncomplete = user
    ? kycStatus !== 'TIER_APPROVED' && !kycRejected && !kycInReview
    : false;

  const filtersActive =
    q.trim() !== '' || payFilter !== '' || locFilter !== '' || tierFilter.length > 0;

  const open = useMemo(
    () => (tasks.data ?? []).filter((t) => t.status === 'OPEN'),
    [tasks.data]
  );

  const filteredOpen = useMemo(() => {
    if (!filtersActive) return open;
    const qLow = q.toLowerCase().trim();
    return open.filter((t) => {
      if (qLow && !t.title.toLowerCase().includes(qLow) && !t.category.toLowerCase().includes(qLow))
        return false;
      if (payFilter && t.payModel !== payFilter) return false;
      if (locFilter && t.locationType !== locFilter) return false;
      if (tierFilter.length > 0 && !tierFilter.includes(t.tier)) return false;
      return true;
    });
  }, [open, q, payFilter, locFilter, tierFilter, filtersActive]);

  const matched = useMemo(() => open.filter((t) => myTiers.includes(t.tier)), [open, myTiers]);
  const others = useMemo(() => open.filter((t) => !myTiers.includes(t.tier)), [open, myTiers]);

  function clearFilters() {
    setQ('');
    setPayFilter('');
    setLocFilter('');
    setTierFilter([]);
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
    if (tasks.loading && !tasks.data) return <LoadingState label="Loading tasks…" />;
    if (tasks.error) return <ErrorState message={tasks.error} onRetry={tasks.reload} />;

    if (filtersActive) {
      return (
        <>
          <Text style={styles.sectionTitle}>
            Results{filteredOpen.length > 0 ? ` (${filteredOpen.length})` : ''}
          </Text>
          {filteredOpen.length === 0 ? (
            <EmptyState
              icon="briefcase"
              title="No tasks match"
              message="Try a different search or clear the filters."
            />
          ) : (
            <View style={styles.feed}>
              {filteredOpen.map((t) => (
                <TaskCard key={t.id} task={t} onPress={() => router.push(`/task/${t.id}`)} />
              ))}
            </View>
          )}
        </>
      );
    }

    return (
      <>
        <Text style={styles.sectionTitle}>Matched for you</Text>
        {matched.length === 0 ? (
          <EmptyState
            icon="briefcase"
            title="No matched tasks yet"
            message="Add a tier in Profile to see tasks matched to your skills."
          />
        ) : (
          <View style={styles.feed}>
            {matched.map((t) => (
              <TaskCard key={t.id} task={t} onPress={() => router.push(`/task/${t.id}`)} />
            ))}
          </View>
        )}
        {others.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>All open tasks</Text>
            <View style={styles.feed}>
              {others.map((t) => (
                <TaskCard key={t.id} task={t} onPress={() => router.push(`/task/${t.id}`)} />
              ))}
            </View>
          </>
        ) : null}
      </>
    );
  }

  return (
    <Screen
      title={`Hi, ${firstName}`}
      subtitle="Let's find you work today"
      onRefresh={() => { tasks.reload(); walletQ.reload(); }}
      refreshing={tasks.loading && !!tasks.data}
    >
      {/* Earnings snapshot */}
      <Card style={styles.snapshot} accent>
        <View style={styles.snapRow}>
          <View style={styles.snapItem}>
            <Text style={styles.snapLabel}>Available</Text>
            <MoneyText amount={wallet.available} size={type.size.xl} color={colors.money} />
          </View>
          <View style={styles.vline} />
          <View style={styles.snapItem}>
            <Text style={styles.snapLabel}>Pending</Text>
            <MoneyText amount={wallet.pending} size={type.size.xl} color={colors.pending} />
          </View>
        </View>
      </Card>

      {/* Search bar */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Icon name="search" size={18} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={q}
            onChangeText={setQ}
            placeholder="Search tasks…"
            placeholderTextColor={colors.textFaint}
            returnKeyType="search"
            clearButtonMode="while-editing"
            autoCapitalize="none"
          />
          {q.length > 0 ? (
            <Pressable onPress={() => setQ('')} hitSlop={8}>
              <Icon name="close" size={16} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={() => setFilterOpen(true)}
          style={[styles.filterBtn, filtersActive && styles.filterBtnActive]}
          accessibilityLabel="Open filters"
        >
          <Icon name="filter" size={18} color={filtersActive ? colors.white : colors.clay} />
          {filtersActive ? (
            <View style={styles.filterBadge}>
              <Text style={styles.filterBadgeText}>
                {(payFilter ? 1 : 0) + (locFilter ? 1 : 0) + tierFilter.length}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      {/* Active filter chips */}
      {activeChips.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipStrip}
          contentContainerStyle={styles.chipStripContent}
        >
          {activeChips.map((chip) => (
            <Pressable key={chip.label} onPress={chip.onRemove} style={styles.chip}>
              <Text style={styles.chipText}>{chip.label}</Text>
              <Icon name="close" size={12} color={colors.clay} />
            </Pressable>
          ))}
          <Pressable onPress={clearFilters} style={styles.clearChip}>
            <Text style={styles.clearChipText}>Clear all</Text>
          </Pressable>
        </ScrollView>
      ) : null}

      {/* KYC banners */}
      {kycRejected ? (
        <View style={{ marginTop: spacing.lg }}>
          <Banner
            tone="danger"
            icon="shield"
            title="Verification rejected"
            message="Your documents could not be verified. Please re-submit with clear, valid ID and a matching selfie."
            action="Re-verify"
            onAction={() => router.push('/(auth)/kyc')}
          />
        </View>
      ) : kycInReview ? (
        <View style={{ marginTop: spacing.lg }}>
          <Banner
            tone="indigo"
            icon="shield"
            title="Verification in review"
            message="An admin is reviewing your details. Applying to tasks unlocks once your tier is approved."
          />
        </View>
      ) : kycIncomplete ? (
        <View style={{ marginTop: spacing.lg }}>
          <Banner
            tone="amber"
            icon="shield"
            title="Finish verification to apply"
            message="Task applications unlock once your KYC is Tier-Approved."
            action="Verify"
            onAction={() => router.push('/(auth)/kyc')}
          />
        </View>
      ) : null}

      {renderTaskList()}

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
    </Screen>
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
  const hasFilters =
    payFilter !== '' || locFilter !== '' || tierFilter.length > 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={sheetStyles.backdrop} onPress={onClose} />
      <View style={[sheetStyles.sheet, { paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={sheetStyles.grabber} />
        <View style={sheetStyles.header}>
          <Text style={sheetStyles.title}>Filters</Text>
          {hasFilters ? (
            <Pressable onPress={onClear} hitSlop={8}>
              <Text style={sheetStyles.clearLink}>Clear all</Text>
            </Pressable>
          ) : null}
        </View>

        <FilterGroup label="Pay model">
          <FilterChipRow>
            {([['', 'Any'], ['HOURLY', 'Hourly'], ['FIXED', 'Fixed']] as [PayFilter, string][]).map(
              ([val, label]) => (
                <FilterChip
                  key={val || 'any'}
                  label={label}
                  active={payFilter === val}
                  onPress={() => onPayFilter(val)}
                />
              )
            )}
          </FilterChipRow>
        </FilterGroup>

        <FilterGroup label="Location">
          <FilterChipRow>
            {([['', 'Any'], ['REMOTE', 'Remote'], ['PHYSICAL', 'Physical']] as [LocFilter, string][]).map(
              ([val, label]) => (
                <FilterChip
                  key={val || 'any'}
                  label={label}
                  active={locFilter === val}
                  onPress={() => onLocFilter(val)}
                />
              )
            )}
          </FilterChipRow>
        </FilterGroup>

        <FilterGroup label="Tier">
          <FilterChipRow>
            {ALL_TIERS.map((t) => (
              <FilterChip
                key={t}
                label={TIER_LABEL[t]}
                active={tierFilter.includes(t)}
                onPress={() => onTierFilter(t)}
                multi
              />
            ))}
          </FilterChipRow>
        </FilterGroup>

        <View style={{ marginTop: spacing.md }}>
          <Button label="Show results" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={sheetStyles.group}>
      <Text style={sheetStyles.groupLabel}>{label}</Text>
      {children}
    </View>
  );
}

function FilterChipRow({ children }: { children: React.ReactNode }) {
  return <View style={sheetStyles.chipRow}>{children}</View>;
}

function FilterChip({
  label,
  active,
  onPress,
  multi,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  multi?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[sheetStyles.fchip, active && sheetStyles.fchipActive]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      {active && multi ? <Icon name="check" size={13} color={colors.white} /> : null}
      <Text style={[sheetStyles.fchipText, active && sheetStyles.fchipTextActive]}>{label}</Text>
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  snapshot: { backgroundColor: colors.surface },
  snapRow: { flexDirection: 'row', alignItems: 'center' },
  snapItem: { flex: 1, gap: 4 },
  snapLabel: { color: colors.textMuted, fontSize: type.size.sm, fontWeight: '600' },
  vline: { width: 1, height: 36, backgroundColor: colors.line, marginHorizontal: spacing.lg },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    minHeight: layout.hitTarget,
  },
  searchInput: {
    flex: 1,
    fontSize: type.size.base,
    color: colors.text,
    padding: 0,
  },
  filterBtn: {
    width: 44,
    height: 44,
    borderRadius: radii.input,
    borderColor: colors.clay,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBtnActive: {
    backgroundColor: colors.clay,
  },
  filterBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    backgroundColor: colors.gold,
    borderRadius: 99,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  filterBadgeText: { color: colors.navy, fontSize: 10, fontWeight: '800' },
  chipStrip: { marginTop: spacing.sm },
  chipStripContent: { gap: spacing.sm, paddingRight: spacing.md },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.claySoft,
    borderRadius: 99,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  chipText: { color: colors.clay, fontSize: type.size.sm, fontWeight: '700' },
  clearChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 99,
    borderColor: colors.line,
    borderWidth: 1,
  },
  clearChipText: { color: colors.textMuted, fontSize: type.size.sm, fontWeight: '600' },
  sectionTitle: {
    color: colors.text,
    fontSize: type.size.lg,
    fontWeight: '800',
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  feed: { gap: spacing.md },
});

const sheetStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(20,15,11,0.45)' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    padding: layout.screenPadding,
    gap: spacing.lg,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 100,
    backgroundColor: colors.line,
    marginBottom: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { color: colors.text, fontSize: type.size.xl, fontWeight: '800' },
  clearLink: { color: colors.clay, fontSize: type.size.base, fontWeight: '700' },
  group: { gap: spacing.sm },
  groupLabel: {
    color: colors.textMuted,
    fontSize: type.size.sm,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  fchip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: 99,
    borderColor: colors.line,
    borderWidth: 1.5,
    backgroundColor: colors.surface,
  },
  fchipActive: {
    backgroundColor: colors.clay,
    borderColor: colors.clay,
  },
  fchipText: { color: colors.text, fontSize: type.size.sm, fontWeight: '600' },
  fchipTextActive: { color: colors.white, fontWeight: '700' },
});
