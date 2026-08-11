import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ScrollView,
  Modal,
  FlatList,
  Image,
  ActivityIndicator,
  Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Button } from '../../src/components/Button';
import { ProgressRail } from '../../src/components/ProgressRail';
import { Icon } from '../../src/components/Icon';
import { TierBadge } from '../../src/components/TierBadge';
import { Banner } from '../../src/components/Feedback';
import { GlassCard, GlassBackdrop, GlassBar } from '../../src/components/Glass';
import { BlurView } from 'expo-blur';
import { colors, spacing, radii, type, layout } from '../../src/theme';
import { api, ApiError } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { NIGERIAN_BANKS } from '../../src/lib/banks';
import type { Tier } from '../../src/api/types';

/**
 * Onboarding / KYC stepper (AUTH_FLOW §B). Steps (8): name+email → tier →
 * ID upload → selfie → tier docs → TIN → bank → review. Real image uploads via
 * expo-image-picker → POST /api/me/kyc/documents. Final step submits metadata
 * to POST /api/me/kyc/submit (kycStatus = PENDING).
 */
type StepKey =
  | 'name'
  | 'tier'
  | 'id'
  | 'selfie'
  | 'docs'
  | 'tin'
  | 'bank'
  | 'review'
  | 'submitted';

const STEPS: StepKey[] = [
  'name',
  'tier',
  'id',
  'selfie',
  'docs',
  'tin',
  'bank',
  'review',
  'submitted',
];
const STEP_LABEL: Record<StepKey, string> = {
  name: 'Your details',
  tier: 'Choose tier',
  id: 'ID document',
  selfie: 'Liveness',
  docs: 'Tier documents',
  tin: 'Tax ID',
  bank: 'Bank account',
  review: 'Review',
  submitted: 'Submitted',
};

// Nigeria document keywords Smile ID's Document Verification recognises
// (server/src/services/smileIdentity.ts → NG_ID_TYPES). Only used when Smile ID
// is configured server-side; harmless to always collect otherwise.
const ID_TYPES: { key: string; label: string }[] = [
  { key: 'IDENTITY_CARD', label: 'National ID' },
  { key: 'VOTER_ID', label: "Voter's Card" },
  { key: 'DRIVERS_LICENSE', label: "Driver's Licence" },
  { key: 'PASSPORT', label: 'Passport' },
];

const TIERS: { key: Tier; blurb: string; docLabel: string }[] = [
  { key: 'STUDENT', blurb: 'Campus tasks, surveys, promo.', docLabel: 'Matric number / student ID' },
  { key: 'DISPATCH', blurb: 'Parcel runs & delivery.', docLabel: "Driver's licence + vehicle papers" },
  { key: 'REMOTE', blurb: 'Online data, support, freelance.', docLabel: 'Portfolio / CV (optional)' },
  { key: 'PROMO', blurb: 'Activations & field marketing.', docLabel: 'Reference / past activation' },
  { key: 'TRADE', blurb: 'Skilled trades.', docLabel: 'Trade certification' },
];

export default function KycScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, updateUser, updateProfile } = useAuth();

  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex];

  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [tier, setTier] = useState<Tier | null>(null);
  const [idDocId, setIdDocId] = useState<string | null>(null);
  const [idType, setIdType] = useState<string | null>(null);
  const [selfieDocId, setSelfieDocId] = useState<string | null>(null);
  const [docsDocId, setDocsDocId] = useState<string | null>(null);
  const [tin, setTin] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [acct, setAcct] = useState('');
  const [bankPickerOpen, setBankPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedStatus, setSubmittedStatus] = useState<'PENDING' | 'VERIFIED' | 'REJECTED'>('PENDING');
  const [submittedNote, setSubmittedNote] = useState<string | null>(null);

  const selectedTier = TIERS.find((t) => t.key === tier);
  const selectedBank = NIGERIAN_BANKS.find((b) => b.code === bankCode);

  function maskedBank(): string {
    const last2 = acct.replace(/\D/g, '').slice(-2);
    const bankName = selectedBank?.name ?? 'Unknown Bank';
    return `${bankName} ••${last2}`;
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await updateProfile({ name: name.trim(), email: email.trim() });
      const result = await api.submitKyc({
        tin: tin || undefined,
        bankMasked: maskedBank(),
        bankCode: bankCode || undefined,
        bankAccountNumber: acct || undefined,
        bankName: selectedBank?.name || undefined,
        tier: tier ?? undefined,
        idType: idType ?? undefined,
      });
      await updateUser({
        kycStatus: result.kycStatus,
        kycNote: result.kycNote ?? null,
        tiers: tier ? [tier] : user?.tiers ?? [],
      });
      setSubmittedStatus(result.kycStatus === 'REJECTED' || result.kycStatus === 'VERIFIED' ? result.kycStatus : 'PENDING');
      setSubmittedNote(result.kycNote ?? null);
      setStepIndex(STEPS.indexOf('submitted'));
    } catch (e) {
      const msg =
        e instanceof ApiError || e instanceof Error
          ? e.message
          : 'Could not submit verification.';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  function next() {
    if (step === 'review') {
      void submit();
      return;
    }
    if (stepIndex < STEPS.length - 1) setStepIndex((i) => i + 1);
  }
  function back() {
    if (stepIndex === 0) router.back();
    else setStepIndex((i) => i - 1);
  }

  const emailOk = /^\S+@\S+\.\S+$/.test(email.trim());
  const canContinue = (() => {
    switch (step) {
      case 'name':
        return name.trim().length >= 2 && emailOk;
      case 'tier':
        return !!tier;
      case 'id':
        return !!idDocId && !!idType;
      case 'selfie':
        return !!selfieDocId;
      case 'docs':
        return !!docsDocId;
      case 'tin':
        return tin.length === 0 || tin.length >= 8;
      case 'bank':
        return !!bankCode && acct.replace(/\D/g, '').length === 10;
      default:
        return true;
    }
  })();

  return (
    <View style={styles.root}>
      <GlassBackdrop />

      <GlassBar edge="top" style={[styles.topbar, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={back} hitSlop={10} style={styles.backBtn} accessibilityLabel="Back">
          <Icon name="chevron-left" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.topTitle}>
          {user?.kycStatus === 'REJECTED' ? 'Re-verify' : 'Get verified'}
        </Text>
        <View style={{ width: layout.hitTarget }} />
      </GlassBar>

      {step !== 'submitted' ? (
        <View style={styles.railWrap}>
          <GlassCard tone="clay" radius={radii.card} contentStyle={{ padding: spacing.md }}>
            <ProgressRail current={stepIndex + 1} total={STEPS.length - 1} label={STEP_LABEL[step]} />
          </GlassCard>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={{
          padding: layout.screenPadding,
          paddingBottom: insets.bottom + 120,
          gap: spacing.lg,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {step !== 'submitted' ? (
          user?.kycStatus === 'REJECTED' ? (
            <Banner
              tone="danger"
              icon="shield"
              title="Previous verification rejected"
              message={
                user?.kycNote ??
                'Please update your documents and re-submit. Ensure your ID is clear and your selfie matches your ID photo.'
              }
            />
          ) : (
            <Banner
              tone="indigo"
              icon="shield"
              title="Secure verification"
              message="Your documents are uploaded securely. Name, email, tier, TIN and bank are submitted on the final step."
            />
          )
        ) : null}
        {error ? <Banner tone="danger" icon="alert" title="Couldn’t submit" message={error} /> : null}

        {step === 'name' && (
          <View style={{ gap: spacing.lg }}>
            <Field label="Full name" hint="As it appears on your ID.">
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Amaka Obi"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                autoCapitalize="words"
              />
            </Field>
            <Field label="Email" hint="For receipts and WHT statements.">
              <TextInput
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                placeholder="you@email.com"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
              />
            </Field>
          </View>
        )}

        {step === 'tier' && (
          <View style={{ gap: spacing.md }}>
            <Text style={styles.h2}>Choose your work tier</Text>
            {TIERS.map((t) => {
              const active = tier === t.key;
              return (
                <Pressable
                  key={t.key}
                  onPress={() => setTier(t.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                >
                  <GlassCard tone={active ? 'clay' : 'neutral'} contentStyle={{ gap: spacing.sm }}>
                    <View style={styles.tierHead}>
                      <TierBadge tier={t.key} />
                      {active ? <Icon name="check-circle" size={20} color={colors.clay} /> : null}
                    </View>
                    <Text style={styles.tierBlurb}>{t.blurb}</Text>
                  </GlassCard>
                </Pressable>
              );
            })}
          </View>
        )}

        {step === 'id' && (
          <View style={{ gap: spacing.lg }}>
            <Field label="ID type">
              <View style={styles.idTypeRow}>
                {ID_TYPES.map((t) => {
                  const selected = idType === t.key;
                  return (
                    <Pressable
                      key={t.key}
                      onPress={() => setIdType(t.key)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <GlassCard
                        tone={selected ? 'indigo' : 'neutral'}
                        radius={radii.pill}
                        contentStyle={styles.idTypeChipContent}
                      >
                        <Text style={[styles.idTypeChipText, selected && styles.idTypeChipTextActive]}>
                          {t.label}
                        </Text>
                      </GlassCard>
                    </Pressable>
                  );
                })}
              </View>
            </Field>
            <UploadStep
              icon="id"
              title="Upload your ID"
              sub="NIN slip, voter's card, or passport photo page."
              docType="ID"
              docId={idDocId}
              onUploaded={setIdDocId}
            />
          </View>
        )}

        {step === 'selfie' && (
          <UploadStep
            icon="camera"
            title="Take a selfie"
            sub="Clear, well-lit photo of your face. Use the front camera."
            docType="SELFIE"
            preferCamera
            docId={selfieDocId}
            onUploaded={setSelfieDocId}
          />
        )}

        {step === 'docs' && (
          <UploadStep
            icon="id"
            title={selectedTier ? `${selectedTier.key} documents` : 'Tier documents'}
            sub={selectedTier?.docLabel ?? 'Supporting documents for your tier.'}
            docType="DOCS"
            docId={docsDocId}
            onUploaded={setDocsDocId}
          />
        )}

        {step === 'tin' && (
          <Field label="Tax Identification Number (TIN)" hint="Optional — you can add this later in Profile. Required for WHT statements.">
            <TextInput
              value={tin}
              onChangeText={setTin}
              keyboardType="number-pad"
              placeholder="12345678-0001 (optional)"
              placeholderTextColor={colors.textFaint}
              style={styles.input}
            />
          </Field>
        )}

        {step === 'bank' && (
          <View style={{ gap: spacing.lg }}>
            <Field label="Bank">
              <Pressable
                onPress={() => setBankPickerOpen(true)}
                style={[styles.input, styles.bankPicker]}
                accessibilityRole="button"
                accessibilityLabel="Select bank"
              >
                <Text style={[styles.bankPickerText, !selectedBank && { color: colors.textMuted }]}>
                  {selectedBank ? selectedBank.name : 'Select your bank…'}
                </Text>
                <Icon name="chevron-down" size={18} color={colors.textMuted} />
              </Pressable>
            </Field>
            <Field label="Account number (NUBAN)" hint="10-digit Nigerian account number. Payouts go here (T+1).">
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
                <Text style={styles.acctHint}>{10 - acct.length} more digits needed</Text>
              ) : acct.length === 10 ? (
                <Text style={[styles.acctHint, { color: colors.money }]}>✓ Valid NUBAN</Text>
              ) : null}
            </Field>
          </View>
        )}

        {step === 'review' && (
          <View style={{ gap: spacing.md }}>
            <Text style={styles.h2}>Review & submit</Text>
            <GlassCard tone="gold" contentStyle={{ paddingHorizontal: spacing.lg, paddingVertical: 0 }}>
              <ReviewRow label="Name" value={name.trim() || '—'} />
              <ReviewRow label="Email" value={email.trim() || '—'} />
              <ReviewRow label="Tier" value={tier ?? '—'} />
              <ReviewRow
                label="ID"
                value={idDocId ? `✓ Uploaded (${ID_TYPES.find((t) => t.key === idType)?.label ?? idType})` : 'Missing'}
              />
              <ReviewRow label="Selfie" value={selfieDocId ? '✓ Uploaded' : 'Missing'} />
              <ReviewRow label="Tier docs" value={docsDocId ? '✓ Uploaded' : 'Missing'} />
              <ReviewRow label="TIN" value={tin || '—'} />
              <ReviewRow label="Bank" value={bankCode ? maskedBank() : '—'} last />
            </GlassCard>
            <Text style={styles.muted}>
              Submitting sets your status to <Text style={{ fontWeight: '700' }}>In review</Text>.
              An admin verifies your tier before you can apply to tasks.
            </Text>
          </View>
        )}

        {step === 'submitted' && submittedStatus === 'REJECTED' && (
          <View style={styles.submitted}>
            <GlassCard tone="danger" radius={44} style={styles.submittedIcon} contentStyle={styles.submittedIconContent}>
              <Icon name="alert" size={40} color={colors.danger} strokeWidth={3} />
            </GlassCard>
            <Text style={styles.h1}>Verification not approved</Text>
            <Text style={styles.muted}>
              {submittedNote ??
                'Your ID and selfie did not pass automated verification. Please re-check your documents and try again.'}
            </Text>
          </View>
        )}

        {step === 'submitted' && submittedStatus === 'VERIFIED' && (
          <View style={styles.submitted}>
            <GlassCard tone="indigo" radius={44} style={styles.submittedIcon} contentStyle={styles.submittedIconContent}>
              <Icon name="check" size={40} color={colors.indigo} strokeWidth={3} />
            </GlassCard>
            <Text style={styles.h1}>Identity verified</Text>
            <Text style={styles.muted}>
              Thanks{name.trim() ? `, ${name.trim().split(' ')[0]}` : ''}. Your identity has been{' '}
              <Text style={{ fontWeight: '700', color: colors.indigo }}>automatically verified</Text>.
              An admin still needs to approve your tier before you can apply to tasks.
            </Text>
          </View>
        )}

        {step === 'submitted' && submittedStatus === 'PENDING' && (
          <View style={styles.submitted}>
            <GlassCard tone="indigo" radius={44} style={styles.submittedIcon} contentStyle={styles.submittedIconContent}>
              <Icon name="check" size={40} color={colors.indigo} strokeWidth={3} />
            </GlassCard>
            <Text style={styles.h1}>Verification in review</Text>
            <Text style={styles.muted}>
              Thanks{name.trim() ? `, ${name.trim().split(' ')[0]}` : ''}. Your verification is{' '}
              <Text style={{ fontWeight: '700', color: colors.indigo }}>In review</Text>. You can
              explore tasks now; applying unlocks once an admin approves your tier.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Bank picker modal */}
      <Modal
        visible={bankPickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setBankPickerOpen(false)}
      >
        <Pressable style={styles.pickerBackdrop} onPress={() => setBankPickerOpen(false)} />
        <View style={[styles.pickerSheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <BlurView
            intensity={Platform.OS === 'android' ? 90 : 50}
            tint="light"
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.pickerGrabber} />
          <Text style={styles.pickerTitle}>Select bank</Text>
          <FlatList
            data={NIGERIAN_BANKS}
            keyExtractor={(b) => b.code}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => { setBankCode(item.code); setBankPickerOpen(false); }}
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

      <GlassBar edge="bottom" style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        {step === 'submitted' ? (
          <Button variant="premium" label="Go to Home" icon="home" onPress={() => router.replace('/(tabs)/home')} />
        ) : (
          <Button
            variant="premium"
            label={step === 'review' ? 'Submit for review' : 'Continue'}
            icon="chevron-right"
            onPress={next}
            disabled={!canContinue || busy}
            loading={busy}
          />
        )}
      </GlassBar>
    </View>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      {children}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

function ReviewRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.reviewRow, last && { borderBottomWidth: 0 }]}>
      <Text style={styles.reviewLabel}>{label}</Text>
      <Text style={styles.reviewValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function UploadStep({
  icon,
  title,
  sub,
  docType,
  preferCamera,
  docId,
  onUploaded,
}: {
  icon: 'id' | 'camera';
  title: string;
  sub: string;
  docType: 'ID' | 'SELFIE' | 'DOCS';
  preferCamera?: boolean;
  docId: string | null;
  onUploaded: (id: string) => void;
}) {
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function pick(fromCamera: boolean) {
    setUploadError(null);

    if (fromCamera) {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        setUploadError('Camera permission denied. Enable it in Settings.');
        return;
      }
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        setUploadError('Photo library permission denied. Enable it in Settings.');
        return;
      }
    }

    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: true,
      aspect: fromCamera && docType === 'SELFIE' ? [1, 1] : [4, 3],
    };

    const result = fromCamera
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);

    if (result.canceled) return;

    const asset = result.assets[0];
    setLocalUri(asset.uri);
    setUploading(true);

    try {
      const ext = asset.uri.split('.').pop() ?? 'jpg';
      const doc = await api.uploadKycDocument({
        docType,
        uri: asset.uri,
        mimeType: asset.mimeType ?? `image/${ext}`,
        filename: asset.fileName ?? `${docType.toLowerCase()}.${ext}`,
      });
      onUploaded(doc.id);
    } catch (e) {
      setUploadError(e instanceof ApiError || e instanceof Error ? e.message : 'Upload failed. Try again.');
      setLocalUri(null);
    } finally {
      setUploading(false);
    }
  }

  const done = !!docId;

  return (
    <View style={{ gap: spacing.md }}>
      <Text style={styles.h2}>{title}</Text>
      <Text style={[styles.muted, { textAlign: 'left' }]}>{sub}</Text>

      {/* Thumbnail once picked */}
      {localUri ? (
        <View style={styles.thumbWrap}>
          <Image source={{ uri: localUri }} style={styles.thumb} resizeMode="cover" />
          {uploading ? (
            <View style={styles.thumbOverlay}>
              <ActivityIndicator color={colors.text} />
              <Text style={styles.thumbOverlayText}>Uploading…</Text>
            </View>
          ) : done ? (
            <View style={[styles.thumbOverlay, { backgroundColor: 'rgba(31,157,107,0.7)' }]}>
              <Icon name="check-circle" size={32} color="#fff" />
              <Text style={[styles.thumbOverlayText, { color: '#fff' }]}>Uploaded</Text>
            </View>
          ) : null}
        </View>
      ) : (
        <GlassCard tone={done ? 'money' : 'gold'} contentStyle={styles.dropzoneContent}>
          <View style={[styles.dropzoneRing, done && styles.dropzoneRingDone]}>
            <Icon name={done ? 'check-circle' : icon} size={40} color={done ? colors.money : colors.clay} />
            <Text style={[styles.dropText, done && { color: colors.money }]}>
              {done ? '✓ Document uploaded' : 'Choose how to add your document'}
            </Text>
          </View>
        </GlassCard>
      )}

      {uploadError ? (
        <Text style={styles.uploadErr}>{uploadError}</Text>
      ) : null}

      {/* Action buttons — always shown so user can retake */}
      {!done && (
        <View style={styles.pickRow}>
          {preferCamera ? (
            <Pressable style={styles.pickBtn} onPress={() => void pick(true)} disabled={uploading}>
              <Icon name="camera" size={18} color={colors.clay} />
              <Text style={styles.pickBtnText}>Take photo</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.pickBtn} onPress={() => void pick(false)} disabled={uploading}>
            <Icon name="id" size={18} color={colors.clay} />
            <Text style={styles.pickBtnText}>
              {preferCamera ? 'Choose from library' : 'Take photo / library'}
            </Text>
          </Pressable>
          {!preferCamera ? (
            <Pressable style={styles.pickBtn} onPress={() => void pick(true)} disabled={uploading}>
              <Icon name="camera" size={18} color={colors.clay} />
              <Text style={styles.pickBtnText}>Camera</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      {done && !uploading ? (
        <Pressable onPress={() => { setLocalUri(null); void pick(preferCamera ?? false); }}>
          <Text style={styles.retakeLink}>Retake / change</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing.sm,
  },
  backBtn: {
    width: layout.hitTarget,
    height: layout.hitTarget,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -spacing.md,
  },
  topTitle: { flex: 1, textAlign: 'center', fontSize: type.size.md, fontWeight: '700', color: colors.text },
  railWrap: { paddingHorizontal: layout.screenPadding, paddingBottom: spacing.md },
  h1: { fontSize: type.size.xxl, fontWeight: '800', color: colors.text, textAlign: 'center' },
  h2: { fontSize: type.size.lg, fontWeight: '800', color: colors.text },
  label: { color: colors.textMuted, fontSize: type.size.sm, fontWeight: '600' },
  hint: { color: colors.textMuted, fontSize: type.size.sm },
  muted: { color: colors.textMuted, fontSize: type.size.base, lineHeight: 22, textAlign: 'center' },
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
  tierHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tierBlurb: { color: colors.textMuted, fontSize: type.size.base, lineHeight: 20 },
  dropzoneContent: { padding: spacing.sm },
  dropzoneRing: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: 'rgba(194,80,46,0.35)',
    borderRadius: radii.card - 4,
    paddingVertical: spacing.xxxl,
    alignItems: 'center',
    gap: spacing.md,
  },
  dropzoneRingDone: { borderColor: 'rgba(31,157,107,0.45)' },
  dropText: { color: colors.clay, fontWeight: '700', fontSize: type.size.md },
  thumbWrap: {
    width: '100%',
    height: 200,
    borderRadius: radii.card,
    overflow: 'hidden',
    position: 'relative',
  },
  thumb: { width: '100%', height: '100%' },
  thumbOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(20,15,11,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  thumbOverlayText: { color: '#fff', fontWeight: '700', fontSize: type.size.base },
  pickRow: { flexDirection: 'row', gap: spacing.sm },
  pickBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.claySoft,
    borderRadius: radii.card,
    paddingVertical: spacing.md,
  },
  pickBtnText: { color: colors.clay, fontWeight: '700', fontSize: type.size.sm },
  uploadErr: { color: colors.danger, fontSize: type.size.sm, fontWeight: '600' },
  retakeLink: { color: colors.textMuted, fontSize: type.size.sm, textDecorationLine: 'underline', textAlign: 'center' },
  reviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(36,28,21,0.08)',
    gap: spacing.lg,
  },
  reviewLabel: { color: colors.textMuted, fontSize: type.size.base },
  reviewValue: { color: colors.text, fontSize: type.size.base, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  submitted: { alignItems: 'center', gap: spacing.lg, paddingTop: spacing.xxxl },
  submittedIcon: { width: 88, height: 88 },
  submittedIconContent: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 0 },
  footer: {
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing.md,
  },
  bankPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 0,
  },
  bankPickerText: { fontSize: type.size.md, color: colors.text, flex: 1 },
  idTypeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  idTypeChipContent: { paddingVertical: 8, paddingHorizontal: 14 },
  idTypeChipText: { fontSize: type.size.sm, color: colors.text, fontWeight: '600' },
  idTypeChipTextActive: { color: colors.indigo },
  acctHint: { fontSize: type.size.sm, color: colors.textMuted, marginTop: 4 },
  // bank picker modal
  pickerBackdrop: { flex: 1, backgroundColor: 'rgba(20,15,11,0.45)' },
  pickerSheet: {
    backgroundColor: 'rgba(251,245,236,0.72)',
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: 'rgba(255,255,255,0.55)',
    padding: layout.screenPadding,
    maxHeight: '70%',
    overflow: 'hidden',
  },
  pickerGrabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 100, backgroundColor: 'rgba(36,28,21,0.2)', marginBottom: spacing.md },
  pickerTitle: { fontSize: type.size.lg, fontWeight: '800', color: colors.text, marginBottom: spacing.md },
  bankItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md },
  bankItemActive: { backgroundColor: colors.claySoft, marginHorizontal: -layout.screenPadding, paddingHorizontal: layout.screenPadding },
  bankItemText: { fontSize: type.size.base, color: colors.text },
});
