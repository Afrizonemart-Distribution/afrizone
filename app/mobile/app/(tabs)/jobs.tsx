import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppSearchBar, AppChipRow, AppChip, AppEmptyState, AppLoadingCards, AppBanner } from '../../src/appui/AppUI';
import { obColors, obRadii } from '../../src/onboarding/onboardingTheme';
import { api, ApiError } from '../../src/api/client';
import { OfflineNote } from '../../src/components/OfflineStatus';
import { mock } from '../../src/api/mock';
import { useAsync } from '../../src/lib/useAsync';
import { formatNaira } from '../../src/lib/format';
import type { Job } from '../../src/api/types';

/**
 * Restyled to match afrizone-mobile-prototype (1).html's Jobs screen. The
 * prototype adds a search bar and quick-filter chips this screen didn't have
 * before - a real addition (client-side filter over the same real /api/jobs
 * data, same mock fallback as before), not fabricated.
 *
 * "Remote" isn't a real field on Job (no location-type flag, just a
 * free-text `location` string), so that chip filters on whether `location`
 * contains "remote" - a real, if loose, filter over real data rather than an
 * invented dimension. Job cards show a second "Remote"/"On-site" tag the
 * same way.
 */

const EMPLOYMENT_LABEL: Record<Job['employmentType'], string> = {
  FULL_TIME: 'Full-time',
  PART_TIME: 'Part-time',
  CONTRACT: 'Contract',
};

function isRemote(job: Job): boolean {
  return job.location.toLowerCase().includes('remote');
}

/** ₦180,000 -> "₦180k" - compact form for a card's salary line. */
function formatNairaCompact(amount: number): string {
  if (amount >= 1000) return `₦${Math.round(amount / 1000)}k`;
  return formatNaira(amount);
}

type EmpFilter = '' | Job['employmentType'] | 'REMOTE';

export default function JobsScreen() {
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [empFilter, setEmpFilter] = useState<EmpFilter>('');

  // REAL: GET /api/jobs (v2). Falls back to mock if the endpoint isn't enabled.
  const jobs = useAsync<{ rows: Job[]; mocked: boolean }>(async (signal) => {
    try {
      const rows = await api.jobs(signal);
      return { rows, mocked: false };
    } catch (e) {
      // No signal is not "the endpoint is off": let the saved copy show.
      if (e instanceof ApiError && e.status === 0) throw e;
      const rows = await mock.jobs();
      return { rows, mocked: true };
    }
  }, [], { cacheKey: 'jobs' });

  const rows = jobs.data?.rows ?? [];
  const open = useMemo(() => rows.filter((j) => j.status === 'OPEN'), [rows]);

  const filtered = useMemo(() => {
    const qLow = q.toLowerCase().trim();
    return open.filter((j) => {
      if (qLow && !j.title.toLowerCase().includes(qLow) && !j.department.toLowerCase().includes(qLow)) return false;
      if (empFilter === 'REMOTE') { if (!isRemote(j)) return false; }
      else if (empFilter && j.employmentType !== empFilter) return false;
      return true;
    });
  }, [open, q, empFilter]);

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 18, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={jobs.loading && !!jobs.data} onRefresh={jobs.reload} tintColor={obColors.navy} />}
      >
        <Text style={styles.title}>Jobs</Text>
        <View style={{ height: 14 }} />
        <OfflineNote savedAt={jobs.savedAt} />

        {jobs.data?.mocked ? (
          <View style={{ marginBottom: 16 }}>
            <AppBanner icon="wifi-off" title="Showing sample jobs" message="Live jobs are unreachable; displaying demo openings." />
          </View>
        ) : null}

        <View style={{ marginBottom: 12 }}>
          <AppSearchBar value={q} onChangeText={setQ} placeholder="Search full-time & part-time roles" />
        </View>

        <View style={{ marginBottom: 16 }}>
          <AppChipRow>
            <AppChip label="All" active={empFilter === ''} onPress={() => setEmpFilter('')} />
            <AppChip label="Full-time" active={empFilter === 'FULL_TIME'} onPress={() => setEmpFilter(empFilter === 'FULL_TIME' ? '' : 'FULL_TIME')} />
            <AppChip label="Part-time" active={empFilter === 'PART_TIME'} onPress={() => setEmpFilter(empFilter === 'PART_TIME' ? '' : 'PART_TIME')} />
            <AppChip label="Remote" active={empFilter === 'REMOTE'} onPress={() => setEmpFilter(empFilter === 'REMOTE' ? '' : 'REMOTE')} />
          </AppChipRow>
        </View>

        {jobs.loading && !jobs.data ? (
          <AppLoadingCards count={2} />
        ) : filtered.length === 0 ? (
          <AppEmptyState
            icon="briefcase"
            title={open.length === 0 ? 'No openings right now' : 'No jobs match your search'}
            message={open.length === 0 ? 'Check back soon: new roles are posted weekly.' : 'Try a different keyword or clear the filters above.'}
            actionLabel={open.length > 0 && (q || empFilter) ? 'Clear filters' : undefined}
            onAction={open.length > 0 && (q || empFilter) ? () => { setQ(''); setEmpFilter(''); } : undefined}
          />
        ) : (
          <View style={{ gap: 10 }}>
            {filtered.map((j) => (
              <JobCard key={j.id} job={j} />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function JobCard({ job }: { job: Job }) {
  const router = useRouter();
  const hasSalary = !!job.salaryMin && !!job.salaryMax;
  const remote = isRemote(job);
  return (
    <Pressable onPress={() => router.push(`/job/${job.id}`)} accessibilityRole="button" style={styles.card}>
      <View style={styles.top}>
        <Text style={styles.jobTitle} numberOfLines={2}>{job.title}</Text>
        {hasSalary ? (
          <Text style={styles.sal} numberOfLines={1}>{formatNairaCompact(job.salaryMin!)}–{formatNairaCompact(job.salaryMax!)}/mo</Text>
        ) : null}
      </View>
      <Text style={styles.co}>{job.department} · {job.location}</Text>
      <View style={styles.foot}>
        <View style={styles.metaRow}>
          <Text style={styles.tag}>{EMPLOYMENT_LABEL[job.employmentType]}</Text>
          <Text style={styles.tag}>{remote ? 'Remote' : 'On-site'}</Text>
        </View>
        <View style={styles.applyBtn}>
          <Text style={styles.applyText}>Apply</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: obColors.bg },
  title: { fontSize: 19, fontFamily: 'Raleway_800ExtraBold', color: obColors.navy },
  card: {
    backgroundColor: obColors.white,
    borderWidth: 1,
    borderColor: obColors.line,
    borderRadius: obRadii.card,
    borderTopRightRadius: obRadii.cardCut,
    padding: 14,
  },
  top: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  jobTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: obColors.text },
  sal: { fontSize: 13, fontWeight: '800', color: obColors.navy },
  co: { fontSize: 12, color: obColors.textMut, marginTop: 2 },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  metaRow: { flexDirection: 'row', gap: 6 },
  tag: { fontSize: 10.5, fontWeight: '700', color: obColors.navy, backgroundColor: obColors.sand, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' },
  applyBtn: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1.3,
    borderColor: obColors.navy,
  },
  applyText: { fontSize: 12.5, fontWeight: '700', color: obColors.navy },
});
