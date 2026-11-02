import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, TextInput, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { AppBackHeader, AppMetaItem, AppPrimaryButton, AppErrorState, AppLoadingCards } from '../../src/appui/AppUI';
import { Icon } from '../../src/components/Icon';
import { MoneyText } from '../../src/components/MoneyText';
import { Banner } from '../../src/components/Feedback';
import { obColors, obRadii } from '../../src/onboarding/onboardingTheme';
import { api, ApiError } from '../../src/api/client';
import { useAsync } from '../../src/lib/useAsync';
import { useAuth } from '../../src/auth/AuthContext';
import { formatDate } from '../../src/lib/format';
import type { Job, EmploymentType } from '../../src/api/types';

/**
 * Restyled onto the navy/gold palette. The salary rendering, the submit
 * requirements, the KYC gate and the whole apply flow are unchanged.
 *
 * The employment-type badge keeps three distinct tones because the three
 * types are not a progression - they are different kinds of job, and the
 * colour is the fastest way to tell them apart in a list.
 */
const TYPE_LABEL: Record<EmploymentType, string> = {
  FULL_TIME: 'Full-time',
  PART_TIME: 'Part-time',
  CONTRACT: 'Contract',
};

const TYPE_COLOR: Record<EmploymentType, string> = {
  FULL_TIME: obColors.navy,
  PART_TIME: obColors.forest,
  CONTRACT: obColors.indigo,
};

const TYPE_BG: Record<EmploymentType, string> = {
  FULL_TIME: obColors.sand,
  PART_TIME: obColors.mgreenBg,
  CONTRACT: obColors.indigoBg,
};

export default function JobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [applied, setApplied] = useState(false);

  const job = useAsync<Job | null>(
    (signal) => (id ? api.jobById(id, signal) : Promise.resolve(null)),
    [id],
    { cacheKey: id ? `job:${id}` : null }
  );

  const j = job.data;
  const closed = j?.status !== 'OPEN';

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 18, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        <AppBackHeader title="Job" onBack={() => router.back()} />

        {job.loading && !job.data ? (
          <AppLoadingCards count={2} />
        ) : job.error ? (
          <AppErrorState message={job.error} onRetry={job.reload} />
        ) : !j ? (
          <AppErrorState message="Job not found." onRetry={job.reload} />
        ) : (
          <>
            {/* Header */}
            <View style={styles.headRow}>
              <View style={[styles.typeBadge, { backgroundColor: TYPE_BG[j.employmentType] }]}>
                <Text style={[styles.typeText, { color: TYPE_COLOR[j.employmentType] }]}>
                  {TYPE_LABEL[j.employmentType]}
                </Text>
              </View>
              {j.candidateCount != null ? (
                <Text style={styles.candidateCount}>{j.candidateCount} applied</Text>
              ) : null}
            </View>
            <Text style={styles.title}>{j.title}</Text>
            <Text style={styles.dept}>{j.department}</Text>

            {/* Salary card */}
            {j.salaryMin || j.salaryMax ? (
              <View style={styles.salaryCard}>
                <Text style={styles.salaryLabel}>Monthly salary</Text>
                <View style={styles.salaryRow}>
                  {j.salaryMin ? (
                    <MoneyText
                      amount={j.salaryMin}
                      size={j.salaryMax ? 22 : 28}
                      color={obColors.navy}
                      weight="800"
                    />
                  ) : null}
                  {j.salaryMin && j.salaryMax ? (
                    <Text style={styles.salarySep}> – </Text>
                  ) : null}
                  {j.salaryMax ? (
                    <MoneyText
                      amount={j.salaryMax}
                      size={j.salaryMin ? 22 : 28}
                      color={obColors.navy}
                      weight="800"
                    />
                  ) : null}
                </View>
              </View>
            ) : null}

            {/* Meta grid */}
            <View style={styles.metaGrid}>
              <AppMetaItem icon="map-pin" label="Location" value={j.location} />
              {j.closingDate ? (
                <AppMetaItem icon="clock" label="Closes" value={formatDate(j.closingDate)} />
              ) : null}
            </View>

            {/* Requirements */}
            {(j.needsCv || j.needsCover || j.needsPortfolio) ? (
              <>
                <Text style={styles.section}>What you'll need to submit</Text>
                <View style={styles.reqRow}>
                  {j.needsCv ? <Req label="CV / résumé" /> : null}
                  {j.needsCover ? <Req label="Cover letter" /> : null}
                  {j.needsPortfolio ? <Req label="Portfolio" /> : null}
                </View>
              </>
            ) : null}

            {/* Description */}
            <Text style={styles.section}>About this role</Text>
            <Text style={styles.desc}>{j.description}</Text>

            {/* KYC gate */}
            {user?.kycStatus !== 'TIER_APPROVED' ? (
              <View style={{ marginTop: 18 }}>
                <Banner
                  tone="amber"
                  icon="shield"
                  title="Finish verification first"
                  message="Job applications unlock once your KYC is Tier-Approved."
                />
              </View>
            ) : null}

            {/* Apply CTA */}
            <View style={{ marginTop: 22 }}>
              {applied ? (
                <AppPrimaryButton label="Application submitted" variant="outline" icon="check" disabled />
              ) : closed ? (
                <AppPrimaryButton label="Applications closed" variant="outline" disabled />
              ) : (
                <AppPrimaryButton
                  label="Apply for this role"
                  icon="chevron-right"
                  onPress={() => setSheetOpen(true)}
                  disabled={user?.kycStatus !== 'TIER_APPROVED'}
                />
              )}
            </View>
          </>
        )}
      </ScrollView>

      {j ? (
        <ApplySheet
          visible={sheetOpen}
          job={j}
          onClose={() => setSheetOpen(false)}
          onApplied={() => {
            setApplied(true);
            setSheetOpen(false);
          }}
        />
      ) : null}
    </View>
  );
}

function Req({ label }: { label: string }) {
  return (
    <View style={styles.reqChip}>
      <Icon name="check" size={13} color={obColors.forest} strokeWidth={2.5} />
      <Text style={styles.reqText}>{label}</Text>
    </View>
  );
}

function ApplySheet({
  visible,
  job,
  onClose,
  onApplied,
}: {
  visible: boolean;
  job: Job;
  onClose: () => void;
  onApplied: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [cvNote, setCvNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = name.trim().length >= 2 && /^\S+@\S+\.\S+$/.test(email.trim());

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.applyJob({
        jobId: job.id,
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || null,
        cvNote: cvNote.trim() || undefined,
      });
      onApplied();
    } catch (e) {
      const msg = e instanceof ApiError || e instanceof Error ? e.message : 'Could not submit application.';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.grabber} />
        <Text style={styles.sheetTitle} numberOfLines={2}>Apply: {job.title}</Text>
        <Text style={styles.sheetSub}>{TYPE_LABEL[job.employmentType]} · {job.department}</Text>

        <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
          <View style={styles.sheetFields}>
            <SheetField label="Full name">
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Your full name"
                placeholderTextColor={obColors.textMut}
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
                placeholderTextColor={obColors.textMut}
                style={styles.input}
              />
            </SheetField>
            <SheetField label="Phone (optional)">
              <TextInput
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                placeholder="+234 800 000 0000"
                placeholderTextColor={obColors.textMut}
                style={styles.input}
              />
            </SheetField>
            {(job.needsCv || job.needsCover) ? (
              <SheetField label={job.needsCover ? 'Cover letter / pitch' : 'Notes / pitch'}>
                <TextInput
                  value={cvNote}
                  onChangeText={setCvNote}
                  multiline
                  placeholder="Tell us why you're a great fit…"
                  placeholderTextColor={obColors.textMut}
                  style={styles.pitch}
                  textAlignVertical="top"
                />
              </SheetField>
            ) : null}
          </View>
        </ScrollView>

        {error ? <Banner tone="danger" title="Couldn't apply" message={error} /> : null}
        <AppPrimaryButton
          label="Submit application"
          onPress={submit}
          loading={busy}
          disabled={!canSubmit || busy}
        />
      </View>
    </Modal>
  );
}

function SheetField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: obColors.bg },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  typeBadge: { borderRadius: obRadii.pill, paddingVertical: 4, paddingHorizontal: 10 },
  typeText: { fontWeight: '700', fontSize: 12.5 },
  candidateCount: { color: obColors.textMut, fontSize: 12.5, fontWeight: '600' },
  title: { color: obColors.navy, fontSize: 21, fontFamily: 'Raleway_800ExtraBold', marginTop: 10, lineHeight: 28 },
  dept: { color: obColors.textMut, fontSize: 13.5, fontWeight: '600', marginTop: 2 },
  salaryCard: {
    backgroundColor: obColors.white,
    borderWidth: 1,
    borderColor: obColors.line,
    borderRadius: obRadii.card,
    borderTopRightRadius: obRadii.cardCut,
    padding: 16,
    gap: 4,
    marginTop: 16,
  },
  salaryLabel: { color: obColors.textMut, fontSize: 12.5, fontWeight: '600' },
  salaryRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' },
  salarySep: { color: obColors.textMut, fontWeight: '700', fontSize: 20 },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 },
  section: { color: obColors.navy, fontSize: 15.5, fontFamily: 'Raleway_800ExtraBold', marginTop: 22, marginBottom: 8 },
  reqRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reqChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: obColors.mgreenBg,
    borderRadius: obRadii.pill,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  reqText: { color: obColors.forest, fontSize: 12.5, fontWeight: '700' },
  desc: { color: obColors.text, fontSize: 14, lineHeight: 22 },
  // sheet
  backdrop: { flex: 1, backgroundColor: obColors.scrim },
  sheet: {
    backgroundColor: obColors.bg,
    borderTopLeftRadius: obRadii.hero,
    borderTopRightRadius: obRadii.hero,
    padding: 20,
    gap: 10,
    maxHeight: '90%',
  },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 4, backgroundColor: obColors.line, marginBottom: 8 },
  sheetTitle: { color: obColors.navy, fontSize: 18, fontFamily: 'Raleway_800ExtraBold' },
  sheetSub: { color: obColors.textMut, fontSize: 13 },
  sheetFields: { gap: 12, paddingTop: 4 },
  fieldLabel: { color: obColors.textMut, fontSize: 12, fontWeight: '700' },
  input: {
    minHeight: 50,
    backgroundColor: obColors.white,
    borderColor: obColors.line,
    borderWidth: 1,
    borderRadius: obRadii.field,
    paddingHorizontal: 13,
    fontSize: 15,
    color: obColors.text,
  },
  pitch: {
    minHeight: 90,
    backgroundColor: obColors.white,
    borderColor: obColors.line,
    borderWidth: 1,
    borderRadius: obRadii.field,
    padding: 13,
    fontSize: 15,
    color: obColors.text,
  },
});
