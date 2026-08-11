import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen } from '../../src/components/Screen';
import { Card } from '../../src/components/Card';
import { Button } from '../../src/components/Button';
import { TierBadge } from '../../src/components/TierBadge';
import { StatusPill } from '../../src/components/StatusPill';
import { LoadingState, ErrorState, Banner } from '../../src/components/Feedback';
import { Icon } from '../../src/components/Icon';
import { colors, spacing, type, radii, layout } from '../../src/theme';
import { api, ApiError } from '../../src/api/client';
import { useAsync } from '../../src/lib/useAsync';
import { useAuth } from '../../src/auth/AuthContext';
import type { ContractDetail } from '../../src/api/types';

export default function ContractDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const contractQ = useAsync<ContractDetail | null>(
    (signal) => (id ? api.myContractDetail(id, signal) : Promise.resolve(null)),
    [id]
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

  const signed = c?.status === 'SIGNED';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Custom header — Screen's built-in scroll prop doesn't let us pin a footer */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Button
          label=""
          icon="chevron-left"
          variant="ghost"
          full={false}
          onPress={() => router.back()}
        />
        <Text style={styles.headerTitle} numberOfLines={1}>
          {c?.task.title ?? 'Service agreement'}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      {contractQ.loading && !c ? (
        <LoadingState label="Loading agreement…" />
      ) : contractQ.error ? (
        <ErrorState message={contractQ.error} onRetry={contractQ.reload} />
      ) : c ? (
        <>
          <ScrollView
            contentContainerStyle={[
              styles.scroll,
              { paddingBottom: insets.bottom + 120 },
            ]}
          >
            {/* Meta card */}
            <Card style={styles.metaCard}>
              <View style={styles.metaTop}>
                <TierBadge tier={c.task.tier} small />
                <Text style={styles.category}>{c.task.category}</Text>
                <View style={{ flex: 1 }} />
                <StatusPill
                  status={signed ? 'paid' : 'pending'}
                  label={signed ? 'Signed' : 'Awaiting signature'}
                  small
                />
              </View>
              <Text style={styles.taskTitle}>{c.task.title}</Text>
              {signed && c.signedAt ? (
                <View style={styles.signedRow}>
                  <Icon name="check-circle" size={14} color={colors.money} />
                  <Text style={styles.signedText}>
                    Digitally signed {new Date(c.signedAt).toLocaleDateString('en-NG', {
                      day: 'numeric', month: 'long', year: 'numeric',
                    })}
                  </Text>
                </View>
              ) : (
                <View style={styles.signedRow}>
                  <Icon name="alert" size={14} color={colors.amber} />
                  <Text style={[styles.signedText, { color: colors.amber }]}>
                    Review and sign to confirm your engagement
                  </Text>
                </View>
              )}
            </Card>

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
          <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
            {signed ? (
              <View style={styles.signedFooter}>
                <Icon name="check-circle" size={20} color={colors.money} />
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
                  placeholderTextColor={colors.textFaint}
                  autoCapitalize="words"
                />
                <Text style={styles.footerHint}>
                  By typing your name and tapping "Sign agreement" you confirm that you have read
                  and agree to the terms above, and that this typed name is your electronic
                  signature.
                </Text>
                <Button
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    color: colors.text,
    fontSize: type.size.base,
    fontWeight: '700',
  },
  scroll: {
    padding: layout.screenPadding,
    gap: spacing.lg,
  },
  metaCard: {
    gap: spacing.sm,
  },
  metaTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  category: {
    color: colors.textMuted,
    fontSize: type.size.sm,
    fontWeight: '700',
  },
  taskTitle: {
    color: colors.text,
    fontSize: type.size.lg,
    fontWeight: '800',
    lineHeight: 26,
  },
  signedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.xs,
  },
  signedText: {
    color: colors.money,
    fontSize: type.size.sm,
    fontWeight: '600',
  },
  sections: {
    gap: spacing.xl,
  },
  section: {
    gap: spacing.xs,
  },
  sectionHeading: {
    color: colors.text,
    fontSize: type.size.base,
    fontWeight: '800',
    letterSpacing: 0.1,
  },
  sectionBody: {
    color: colors.textMuted,
    fontSize: type.size.sm,
    lineHeight: 20,
  },
  footer: {
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  footerHint: {
    color: colors.textMuted,
    fontSize: type.size.xs,
    textAlign: 'center',
    lineHeight: 16,
  },
  label: {
    color: colors.textMuted,
    fontSize: type.size.sm,
    fontWeight: '600',
  },
  signatureInput: {
    minHeight: layout.hitTarget,
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
    fontSize: type.size.md,
    fontStyle: 'italic',
    color: colors.text,
  },
  signedFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  signedFooterText: {
    color: colors.money,
    fontWeight: '700',
    fontSize: type.size.base,
  },
});
