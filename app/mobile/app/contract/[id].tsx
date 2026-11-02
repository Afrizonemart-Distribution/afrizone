import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppBackHeader, AppPrimaryButton, AppStatusPill, AppErrorState, AppLoadingCards } from '../../src/appui/AppUI';
import { Banner } from '../../src/components/Feedback';
import { Icon } from '../../src/components/Icon';
import { obColors, obRadii } from '../../src/onboarding/onboardingTheme';
import { api, ApiError } from '../../src/api/client';
import { useAsync } from '../../src/lib/useAsync';
import { useAuth } from '../../src/auth/AuthContext';
import type { ContractDetail } from '../../src/api/types';

/**
 * Restyled onto the navy/gold palette. The signature flow is unchanged,
 * including that `signed` is read from `signedAt` and never from `status` -
 * see the comment at its declaration.
 *
 * The task title moved from the header into the card, as on the active-task
 * screen: the header holds one line and a real title did not fit. TierBadge
 * left with it, for the reason it left the task cards - tier and category are
 * usually the same word and read as a duplicate.
 *
 * The signature field keeps its italic face. It is the one place in the app
 * where type is meant to look like handwriting, because what is typed there
 * IS the signature (server-side it becomes signerName + a SHA-256 hash).
 */
export default function ContractDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const contractQ = useAsync<ContractDetail | null>(
    (signal) => (id ? api.myContractDetail(id, signal) : Promise.resolve(null)),
    [id],
    { cacheKey: id ? `contract:${id}` : null }
  );
  const c = contractQ.data;

  const [signerName, setSignerName] = useState(user?.name ?? '');
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);

  const canSign = signerName.trim().length >= 2;

  async function sign() {
    if (!id || !canSign) return;
    setSigning(true);
    setSignError(null);
    try {
      await api.signContract(id, signerName.trim());
      // Reload to get updated status + signedAt in the sections
      contractQ.reload();
    } catch (e) {
      setSignError(e instanceof ApiError || e instanceof Error ? e.message : 'Could not sign contract.');
    } finally {
      setSigning(false);
    }
  }

  // Signature comes from signedAt, not status - status is the work lifecycle.
  const signed = c?.signedAt != null;

  return (
    <View style={styles.root}>
      <View style={[styles.headerWrap, { paddingTop: insets.top + 16 }]}>
        <AppBackHeader title="Service agreement" onBack={() => router.back()} />
      </View>

      {contractQ.loading && !c ? (
        <View style={styles.pad}><AppLoadingCards count={2} /></View>
      ) : contractQ.error ? (
        <View style={styles.pad}><AppErrorState message={contractQ.error} onRetry={contractQ.reload} /></View>
      ) : c ? (
        <>
          <ScrollView
            contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 140 }]}
            showsVerticalScrollIndicator={false}
          >
            {/* Meta card */}
            <View style={styles.metaCard}>
              <View style={styles.metaTop}>
                <Text style={styles.category}>{c.task.category}</Text>
                <View style={{ flex: 1 }} />
                <AppStatusPill
                  tone={signed ? 'paid' : 'await'}
                  label={signed ? 'Signed' : 'Awaiting signature'}
                />
              </View>
              <Text style={styles.taskTitle}>{c.task.title}</Text>
              {signed && c.signedAt ? (
                <View style={styles.signedRow}>
                  <Icon name="check-circle" size={14} color={obColors.forest} />
                  <Text style={styles.signedText}>
                    Digitally signed {new Date(c.signedAt).toLocaleDateString('en-NG', {
                      day: 'numeric', month: 'long', year: 'numeric',
                    })}
                  </Text>
                </View>
              ) : (
                <View style={styles.signedRow}>
                  <Icon name="alert" size={14} color={obColors.orangeInk} />
                  <Text style={styles.pendingText}>
                    Review and sign to confirm your engagement
                  </Text>
                </View>
              )}
            </View>

            {/* Contract sections */}
            <View style={styles.sections}>
              {c.sections.map((s, i) => (
                <View key={i} style={styles.section}>
                  <Text style={styles.sectionHeading}>{s.heading}</Text>
                  <Text style={styles.sectionBody}>{s.body}</Text>
                </View>
              ))}
            </View>

            {signError ? (
              <Banner tone="danger" icon="alert" title="Signing failed" message={signError} />
            ) : null}
          </ScrollView>

          {/* Pinned footer */}
          <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
            {signed ? (
              <View style={styles.signedFooter}>
                <Icon name="check-circle" size={20} color={obColors.forest} />
                <Text style={styles.signedFooterText}>Agreement signed</Text>
              </View>
            ) : (
              <>
                <Text style={styles.label}>Type your full legal name to sign</Text>
                <TextInput
                  style={styles.signatureInput}
                  value={signerName}
                  onChangeText={setSignerName}
                  placeholder="Full name"
                  placeholderTextColor={obColors.textMut}
                  autoCapitalize="words"
                />
                <Text style={styles.footerHint}>
                  By typing your name and tapping "Sign agreement" you confirm that you have read
                  and agree to the terms above, and that this typed name is your electronic
                  signature.
                </Text>
                <AppPrimaryButton
                  label="Sign agreement"
                  icon="check"
                  onPress={sign}
                  loading={signing}
                  disabled={!canSign}
                />
              </>
            )}
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: obColors.bg },
  headerWrap: { paddingHorizontal: 18 },
  pad: { paddingHorizontal: 18 },
  scroll: { paddingHorizontal: 18, gap: 20 },
  metaCard: {
    backgroundColor: obColors.white,
    borderWidth: 1,
    borderColor: obColors.line,
    borderRadius: obRadii.card,
    borderTopRightRadius: obRadii.cardCut,
    padding: 16,
    gap: 8,
  },
  metaTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  category: {
    fontSize: 10.5,
    fontWeight: '700',
    color: obColors.navy,
    backgroundColor: obColors.sand,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: 'hidden',
  },
  taskTitle: {
    color: obColors.navy,
    fontSize: 16.5,
    fontFamily: 'Raleway_800ExtraBold',
    lineHeight: 23,
  },
  signedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  signedText: { flex: 1, color: obColors.forest, fontSize: 12.5, fontWeight: '700' },
  pendingText: { flex: 1, color: obColors.amberInk, fontSize: 12.5, fontWeight: '700' },
  sections: { gap: 20 },
  section: { gap: 5 },
  sectionHeading: {
    color: obColors.navy,
    fontSize: 14.5,
    fontFamily: 'Raleway_800ExtraBold',
    letterSpacing: 0.1,
  },
  sectionBody: { color: obColors.textMut, fontSize: 13, lineHeight: 20 },
  footer: {
    backgroundColor: obColors.bg,
    borderTopWidth: 1,
    borderTopColor: obColors.line,
    paddingHorizontal: 18,
    paddingTop: 14,
    gap: 8,
  },
  footerHint: { color: obColors.textMut, fontSize: 11, textAlign: 'center', lineHeight: 16 },
  label: { color: obColors.textMut, fontSize: 12, fontWeight: '700' },
  signatureInput: {
    minHeight: 50,
    backgroundColor: obColors.white,
    borderColor: obColors.line,
    borderWidth: 1,
    borderRadius: obRadii.field,
    paddingHorizontal: 13,
    fontSize: 16,
    fontStyle: 'italic',
    color: obColors.text,
  },
  signedFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  signedFooterText: { color: obColors.forest, fontWeight: '800', fontSize: 14 },
});
