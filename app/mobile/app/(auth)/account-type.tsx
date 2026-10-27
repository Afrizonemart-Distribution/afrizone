/**
 * "How are you using AfriZone PartTime?" - the front door.
 *
 * WHAT THIS CHOICE DOES AND, MORE IMPORTANTLY, WHAT IT DOES NOT:
 *
 *   It picks the sign-up FLOW. Individuals sign up with a phone number and an
 *   OTP, which is how the platform has always onboarded workers; stores and
 *   couriers sign up with an email and a password, like every other credentialed
 *   account. So the answer here genuinely changes the next screen.
 *
 *   It does NOT decide which dashboard anyone lands on. That comes from the
 *   account type stored on the server, read after sign-in (see app/_layout.tsx).
 *   Someone who taps the wrong card here is not stranded and is not told off -
 *   they simply arrive where their account actually belongs. A front-door
 *   question that can lock a person out of their own account would be worse
 *   than no question at all.
 *
 * Which is also why signing in skips this screen entirely. You do not have to
 * declare what you are in order to log in; the server already knows.
 *
 * Restyled to afrizone-onboarding-screens.html's screen 02: select-then-
 * "Continue" (was tap-a-card-and-go-immediately) - the mock's own
 * interaction model, still routing the same way once confirmed.
 */
import React, { useState } from 'react';
import { useRouter } from 'expo-router';
import { ObScreen, ObRoleCard } from '../../src/onboarding/ObUI';
import type { AccountType } from '../../src/api/types';
import type { IconName } from '../../src/components/Icon';

type Option = {
  key: AccountType;
  icon: IconName;
  title: string;
  blurb: string;
  /** Where choosing this sends someone who is signing up. */
  route: string;
};

const OPTIONS: Option[] = [
  {
    key: 'INDIVIDUAL',
    icon: 'user',
    title: 'Individual',
    blurb: 'Pick up tasks, source products, get paid for the work you do.',
    // Was '/(auth)/otp' directly - that skipped collecting a phone number
    // entirely, so otp.tsx opened with no number to send a code to.
    route: '/(auth)/phone',
  },
  {
    key: 'STORE',
    icon: 'cart',
    title: 'AZM Store',
    blurb: 'Receive and fulfil orders from AfriZoneMart customers.',
    route: '/(auth)/register',
  },
  {
    key: 'COURIER',
    icon: 'map-pin',
    title: 'Courier',
    blurb: 'Pick up and deliver orders, on your own or with a courier company.',
    route: '/(auth)/register',
  },
];

export default function AccountTypeScreen() {
  const router = useRouter();
  const [selected, setSelected] = useState<Option | null>(null);

  function onContinue() {
    if (!selected) return;
    // Carried as a param rather than stored: it is a hint for the next screen,
    // not a fact about anybody yet. Nothing has been created, so there is
    // nothing worth persisting - and a stale choice left lying around is how a
    // person ends up signed up as something they picked days ago.
    router.push({ pathname: selected.route as never, params: { accountType: selected.key } as never });
  }

  return (
    <ObScreen
      onBack={() => router.back()}
      eyebrow="Get started"
      title="Join as"
      subtitle="Pick the account that fits how you'll work with AZM."
      primaryLabel="Continue"
      onPrimary={onContinue}
      primaryDisabled={!selected}
    >
      {OPTIONS.map((opt) => (
        <ObRoleCard
          key={opt.key}
          icon={opt.icon}
          title={opt.title}
          blurb={opt.blurb}
          selected={selected?.key === opt.key}
          onPress={() => setSelected(opt)}
        />
      ))}
    </ObScreen>
  );
}
