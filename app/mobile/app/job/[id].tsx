import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { Card } from '../../src/components/Card';
import { Button } from '../../src/components/Button';
import { Icon } from '../../src/components/Icon';
import { MoneyText } from '../../src/components/MoneyText';
import { Banner, LoadingState, ErrorState } from '../../src/components/Feedback';
import { colors, spacing, type, radii, layout } from '../../src/theme';
import { api, ApiError } from '../../src/api/client';
import { useAsync } from '../../src/lib/useAsync';
import { useAuth } from '../../src/auth/AuthContext';
import { formatDate } from '../../src/lib/format';
import type { Job, EmploymentType } from '../../src/api/types';

const TYPE_LABEL: Record<EmploymentType, string> = {
  FULL_TIME: 'Full-time',
  PART_TIME: 'Part-time',
  CONTRACT: 'Contract',
};

const TYPE_COLOR: Record<EmploymentType, string> = {
  FULL_TIME: colors.clay,
  PART_TIME: colors.money,
  CONTRACT: colors.indigo,
};

const TYPE_BG: Record<EmploymentType, string> = {
  FULL_TIME: colors.claySoft,
  PART_TIME: colors.moneySoft,
  CONTRACT: colors.indigoSoft,
};

export default function JobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [applied, setApplied] = useState(false);

  const job = useAsync<Job | null>(
    (signal) => (id ? api.jobById(id, signal) : Promise.resolve(null)),
    [id]
  );

  const j = job.data;
  const closed = j?.status !== 'OPEN';

  return (
    <Screen title="Job" back scroll>
      {job.loading && !job.data ? (
        <LoadingState />
      ) : job.error ? (
        <ErrorState message={job.error} onRetry={job.reload} />
      ) : !j ? (
        <ErrorState message="Job not found." />
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
            <Card style={styles.salaryCard}>
              <Text style={styles.salaryLabel}>Monthly salary</Text>
              <View style={styles.salaryRow}>
                {j.salaryMin ? (
                  <MoneyText amount={j.salaryMin} size={type.size.displayLg} color={colors.clay} weight="800" />
                ) : null}
                {j.salaryMin && j.salaryMax ? (
                  <Text style={styles.salarySep}> – </Text>
                ) : null}
                {j.salaryMax ? (
                  <MoneyText amount={j.salaryMax} size={type.size.displayLg} color={colors.clay} weight="800" />
                ) : null}
              </View>
            </Card>
          ) : null}

          {/* Meta grid */}
          <View style={styles.metaGrid}>
            <Meta icon="map-pin" label="Location" value={j.location} />
            {j.closingDate ? (
              <Meta icon="clock" label="Closes" value={formatDate(j.closingDate)} />
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
            <Banner
              tone="amber"
              icon="shield"
              title="Finish verification first"
              message="Job applications unlock once your KYC is Tier-Approved."
            />
          ) : null}

          {/* Apply CTA */}
          <View style={{ marginTop: spacing.xl }}>
            {applied ? (
              <Button label="Application submitted" variant="secondary" icon="check" disabled />
            ) : closed ? (
              <Button label="Applications closed" variant="secondary" disabled />
            ) : (
              <Button
                label="Apply for this role"
                icon="chevron-right"
                onPress={() => setSheetOpen(true)}
                disabled={user?.kycStatus !== 'TIER_APPROVED'}
              />
            )}
          </View>
        </>
      )}

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
    </Screen>
  );
}

function Req({ label }: { label: string }) {
  return (
    <View style={styles.reqChip}>
      <Icon name="check" size={13} color={colors.money} strokeWidth={2.5} />
      <Text style={styles.reqText}>{label}</Text>
    </View>
  );
}

function Meta({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View style={styles.metaItem}>
      <Icon name={icon} size={16} color={colors.textMuted} />
      <View>
        <Text style={styles.metaLabel}>{label}</Text>
        <Text style={styles.metaValue}>{value}</Text>
      </View>
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
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={styles.grabber} />
        <Text style={styles.sheetTitle}>Apply — {job.title}</Text>
        <Text style={styles.sheetSub}>{TYPE_LABEL[job.employmentType]} · {job.department}</Text>

        <View style={styles.sheetFields}>
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
          <SheetField label="Phone (optional)">
            <TextInput
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholder="+234 800 000 0000"
              placeholderTextColor={colors.textFaint}
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
                placeholderTextColor={colors.textFaint}
                style={styles.pitch}
                textAlignVertical="top"
              />
            </SheetField>
          ) : null}
        </View>

        {error ? <Banner tone="danger" title="Couldn't apply" message={error} /> : null}
        <Button
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
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  typeBadge: { borderRadius: radii.pill, paddingVertical: 4, paddingHorizontal: 10 },
  typeText: { fontWeight: '700', fontSize: type.size.sm },
  candidateCount: { color: colors.textMuted, fontSize: type.size.sm, fontWeight: '600' },
  title: { color: colors.text, fontSize: type.size.xxl, fontWeight: '800', marginTop: spacing.sm, lineHeight: 30 },
  dept: { color: colors.textMuted, fontSize: type.size.base, fontWeight: '600', marginBottom: spacing.md },
  salaryCard: { marginTop: spacing.sm, gap: 4 },
  salaryLabel: { color: colors.textMuted, fontSize: type.size.sm, fontWeight: '600' },
  salaryRow: { flexDirection: 'row', alignItems: 'baseline' },
  salarySep: { color: colors.clay, fontWeight: '700', fontSize: type.size.displayLg },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.lg },
  metaItem: { flexDirection: 'row', gap: spacing.sm, width: '50%', paddingVertical: spacing.sm, alignItems: 'flex-start' },
  metaLabel: { color: colors.textMuted, fontSize: type.size.xs },
  metaValue: { color: colors.text, fontSize: type.size.base, fontWeight: '700' },
  section: { color: colors.text, fontSize: type.size.lg, fontWeight: '800', marginTop: spacing.xl, marginBottom: spacing.sm },
  reqRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  reqChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.moneySoft,
    borderRadius: radii.pill,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  reqText: { color: colors.money, fontSize: type.size.sm, fontWeight: '700' },
  desc: { color: colors.text, fontSize: type.size.md, lineHeight: 24 },
  // sheet
  backdrop: { flex: 1, backgroundColor: 'rgba(20,15,11,0.45)' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    padding: layout.screenPadding,
    gap: spacing.md,
    maxHeight: '90%',
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 100, backgroundColor: colors.line, marginBottom: spacing.sm },
  sheetTitle: { color: colors.text, fontSize: type.size.xl, fontWeight: '800' },
  sheetSub: { color: colors.textMuted, fontSize: type.size.base },
  sheetFields: { gap: spacing.md },
  fieldLabel: { color: colors.textMuted, fontSize: type.size.sm, fontWeight: '600' },
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
  pitch: {
    minHeight: 90,
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radii.input,
    padding: spacing.md,
    fontSize: type.size.md,
    color: colors.text,
  },
});
