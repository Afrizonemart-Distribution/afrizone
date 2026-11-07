import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppSearchBar, AppChipRow, AppChip, AppEmptyState, AppLoadingCards, AppErrorState } from '../../src/appui/AppUI';
import { obColors, obRadii } from '../../src/onboarding/onboardingTheme';
import { api } from '../../src/api/client';
import { OfflineNote } from '../../src/components/OfflineStatus';
import { useAsync } from '../../src/lib/useAsync';
import { formatNaira, payLabel } from '../../src/lib/format';
import type { Opportunity, OpportunityFeed, OpportunityType, Stage } from '../../src/api/types';

/**
 * Opportunities: quick tasks, hourly work and jobs in one list
 * (GET /api/opportunities). One filter row instead of two tabs with two
 * shapes. "For you" puts first what the worker said they are open to on their
 * Hiring profile; with nothing said, everything counts.
 */

const TYPE_CHIPS: { value: OpportunityType; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'TASKS', label: 'Quick tasks' },
  { value: 'HOURLY', label: 'Hourly' },
  { value: 'JOBS', label: 'Jobs' },
];

const TYPE_TAG: Record<Opportunity['type'], string> = {
  TASKS: 'Quick task',
  HOURLY: 'Hourly',
  JOBS: 'Job',
};

const EMPLOYMENT_LABEL: Record<string, string> = {
  FULL_TIME: 'Full-time',
  PART_TIME: 'Part-time',
  CONTRACT: 'Contract',
};

const STAGE_LABEL: Record<Stage, string> = {
  SCREENING: 'Applied',
  INTERVIEW: 'Interview',
  OFFER: 'Offer',
  HIRED: 'Hired',
  REJECTED: 'Closed',
};

/** ₦180,000 -> "₦180k" - compact form for a card's pay line. */
function compact(amount: number): string {
  if (amount >= 1000) return `₦${Math.round(amount / 1000)}k`;
  return formatNaira(amount);
}

function payLine(o: Opportunity): string | null {
  if (o.kind === 'JOB') {
    if (o.salaryMin && o.salaryMax) return `${compact(o.salaryMin)}–${compact(o.salaryMax)}/mo`;
    if (o.salaryMin || o.salaryMax) return `${compact((o.salaryMin || o.salaryMax)!)}/mo`;
    return null;
  }
  return o.payModel ? payLabel(o.payModel, o.payModel === 'FIXED' ? o.budget : o.rate, o.budget, o.unitLabel) : null;
}

export default function OpportunitiesScreen() {
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [type, setType] = useState<OpportunityType>('ALL');
  const [forYouOnly, setForYouOnly] = useState(false);

  const feed = useAsync<OpportunityFeed>((signal) => api.opportunities('ALL', signal), [], {
    cacheKey: 'opportunities',
  });
  const items = feed.data?.items ?? [];
  const saidOpenTo = (feed.data?.openTo?.length ?? 0) > 0;

  const filtered = useMemo(() => {
    const qLow = q.toLowerCase().trim();
    const rows = items.filter((o) => {
      if (type !== 'ALL' && o.type !== type) return false;
      if (forYouOnly && saidOpenTo && !o.forYou) return false;
      if (qLow && !o.title.toLowerCase().includes(qLow) && !o.subtitle.toLowerCase().includes(qLow)) return false;
      return true;
    });
    // What they asked for first, newest first within each.
    return [...rows].sort((a, b) => Number(b.forYou) - Number(a.forYou));
  }, [items, q, type, forYouOnly, saidOpenTo]);

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 18, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={feed.loading && !!feed.data} onRefresh={feed.reload} tintColor={obColors.navy} />}
      >
        <Text style={styles.title}>Opportunities</Text>
        <Text style={styles.sub}>Quick tasks, hourly work and jobs at AfriZone</Text>
        <View style={{ height: 14 }} />
        <OfflineNote savedAt={feed.savedAt} />

        <View style={{ marginBottom: 12 }}>
          <AppSearchBar value={q} onChangeText={setQ} placeholder="Search tasks and roles" />
        </View>

        <View style={{ marginBottom: 16 }}>
          <AppChipRow>
            {TYPE_CHIPS.map((c) => (
              <AppChip key={c.value} label={c.label} active={type === c.value} onPress={() => setType(c.value)} />
            ))}
            {saidOpenTo ? (
              <AppChip label="For you" active={forYouOnly} onPress={() => setForYouOnly((v) => !v)} />
            ) : null}
          </AppChipRow>
        </View>

        {feed.loading && !feed.data ? (
          <AppLoadingCards count={3} />
        ) : feed.error && !feed.data ? (
          <AppErrorState message={feed.error} onRetry={feed.reload} />
        ) : filtered.length === 0 ? (
          <AppEmptyState
            icon="briefcase"
            title={items.length === 0 ? 'Nothing open right now' : 'Nothing matches'}
            message={items.length === 0 ? 'New tasks and roles are posted every week.' : 'Try another filter or keyword.'}
            actionLabel={items.length > 0 && (q || type !== 'ALL' || forYouOnly) ? 'Clear filters' : undefined}
            onAction={
              items.length > 0 && (q || type !== 'ALL' || forYouOnly)
                ? () => {
                    setQ('');
                    setType('ALL');
                    setForYouOnly(false);
                  }
                : undefined
            }
          />
        ) : (
          <View style={{ gap: 10 }}>
            {filtered.map((o) => (
              <OpportunityCard key={`${o.kind}:${o.id}`} o={o} />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function OpportunityCard({ o }: { o: Opportunity }) {
  const router = useRouter();
  const pay = payLine(o);
  const status = o.kind === 'JOB' && o.stage ? STAGE_LABEL[o.stage] : o.applied ? 'Applied' : null;
  return (
    <Pressable
      onPress={() => router.push(o.kind === 'JOB' ? `/job/${o.id}` : `/task/${o.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`${TYPE_TAG[o.type]}: ${o.title}${pay ? `, ${pay}` : ''}`}
      style={styles.card}
    >
      <View style={styles.top}>
        <Text style={styles.cardTitle} numberOfLines={2}>{o.title}</Text>
        {pay ? <Text style={styles.pay} numberOfLines={1}>{pay}</Text> : null}
      </View>
      <Text style={styles.co} numberOfLines={1}>
        {o.subtitle}
        {o.location ? ` · ${o.location}` : ''}
      </Text>
      <View style={styles.foot}>
        <View style={styles.metaRow}>
          <Text style={[styles.tag, o.kind === 'JOB' && styles.tagJob]}>{TYPE_TAG[o.type]}</Text>
          {o.employmentType ? <Text style={styles.tag}>{EMPLOYMENT_LABEL[o.employmentType] ?? o.employmentType}</Text> : null}
          <Text style={styles.tag}>{o.remote ? 'Remote' : 'On-site'}</Text>
          {o.forYou ? <Text style={[styles.tag, styles.tagForYou]}>For you</Text> : null}
        </View>
        <View style={[styles.applyBtn, status && styles.applyDone]}>
          <Text style={[styles.applyText, status && styles.applyDoneText]}>{status ?? 'View'}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: obColors.bg },
  title: { fontSize: 19, fontFamily: 'Raleway_800ExtraBold', color: obColors.navy },
  sub: { fontSize: 12.5, color: obColors.textMut, marginTop: 2 },
  card: {
    backgroundColor: obColors.white,
    borderWidth: 1,
    borderColor: obColors.line,
    borderRadius: obRadii.card,
    borderTopRightRadius: obRadii.cardCut,
    padding: 14,
  },
  top: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  cardTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: obColors.text },
  pay: { fontSize: 13, fontWeight: '800', color: obColors.navy },
  co: { fontSize: 12, color: obColors.textMut, marginTop: 2 },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, gap: 8 },
  metaRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', flex: 1 },
  tag: {
    fontSize: 10.5,
    fontWeight: '700',
    color: obColors.navy,
    backgroundColor: obColors.sand,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: 'hidden',
  },
  tagJob: { backgroundColor: obColors.indigoBg, color: obColors.indigo },
  tagForYou: { backgroundColor: obColors.mgreenBg, color: obColors.forest },
  applyBtn: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1.3,
    borderColor: obColors.navy,
  },
  applyText: { fontSize: 12.5, fontWeight: '700', color: obColors.navy },
  applyDone: { borderColor: obColors.forest, backgroundColor: obColors.mgreenBg },
  applyDoneText: { color: obColors.forest },
});
