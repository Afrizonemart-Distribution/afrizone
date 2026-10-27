import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { ObScreen } from '../../src/onboarding/ObUI';
import { Banner } from '../../src/components/Feedback';
import { obColors } from '../../src/onboarding/onboardingTheme';

const LAST_UPDATED = '20 August 2026';
const SUPPORT_EMAIL = 'support@afrizonemart.com';

/**
 * Privacy Policy: a real first draft describing what AfriZone PartTime
 * actually collects and why, written for the pilot launch - not
 * lawyer-reviewed (in particular, no NDPR compliance review has been done),
 * so it stays clearly flagged as a draft rather than presented as final
 * legal copy. Have this reviewed by counsel before any wider/public rollout.
 */
export default function PrivacyScreen() {
  const router = useRouter();

  return (
    <ObScreen onBack={() => router.back()} title="Privacy Policy">
      <Banner
        tone="amber"
        icon="alert"
        title="Draft — pending legal review"
        message="This describes what the app actually collects and why, but hasn't been reviewed by a lawyer (including for NDPR compliance). Have it reviewed before a public launch."
      />

      <Text style={styles.updated}>Last updated: {LAST_UPDATED}</Text>

      <Section title="1. What we collect">
        Account details (name, email, and/or phone number); identity
        verification documents (a government-issued ID image and a selfie);
        bank account details for payouts (account number, bank name); location
        data when you clock in or out of a physical task, to confirm you're at
        the task site; and a push-notification token for your device, if you
        enable notifications.
      </Section>

      <Section title="2. How we use it">
        To verify your identity before approving you to work (KYC); to match
        you with tasks that fit your verified tier; to process payments and
        withhold the tax the law requires; to communicate with you about
        applications, approvals, and payments; and to investigate disputes or
        suspected fraud.
      </Section>

      <Section title="3. Who we share it with">
        Your bank details are shared with our payment processor (Paystack) to
        send you withdrawals. Your ID and selfie may be checked by an
        automated document-verification service as part of KYC, in addition to
        manual review by Afrizone admins. If you sign up or sign in with
        Google, we receive your name and email from Google to create or match
        your account. We don't sell your data to third parties.
      </Section>

      <Section title="4. How long we keep it">
        We keep your account and KYC data for as long as your account is
        active, and for a period after that to meet our legal and tax
        record-keeping obligations. If you ask us to delete your account, we'll
        remove what we can, except data we're required to retain by law (for
        example, payment and tax records).
      </Section>

      <Section title="5. Your choices">
        You can review and update your name and email in the app under
        Profile. To request a copy of your data, ask us to correct something,
        or ask us to delete your account, contact us using the details below.
      </Section>

      <Section title="6. Security">
        We use industry-standard measures to protect your data, including
        encrypted connections and access controls on who can view KYC
        documents. No system is perfectly secure, but we take reasonable steps
        to protect your information.
      </Section>

      <Section title="7. Children">
        AfriZone PartTime is not intended for anyone under 18. We don't
        knowingly collect data from minors.
      </Section>

      <Section title="8. Changes to this policy">
        We may update this policy as the app develops, especially as it moves
        beyond this pilot phase. We'll do our best to notify you of significant
        changes in the app.
      </Section>

      <Section title="9. Contact">
        Questions about your data or this policy? Reach us at {SUPPORT_EMAIL}.
      </Section>
    </ObScreen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>{title}</Text>
      <Text style={styles.body}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  updated: { color: obColors.textMut, fontSize: 12.5 },
  section: { gap: 5 },
  heading: { color: obColors.navy, fontSize: 14.5, fontFamily: 'Raleway_800ExtraBold' },
  body: { color: obColors.textMut, fontSize: 13.5, lineHeight: 21 },
});
