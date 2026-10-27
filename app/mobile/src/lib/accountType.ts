/**
 * Account-type copy and routing, in one place.
 *
 * Two rules live here rather than being spread across the screens that need
 * them, because both are easy to get subtly wrong in one spot and not notice:
 *
 *   readAccountType() never returns undefined. A screen reached by deep link,
 *   a back-navigation, or a param that arrived as an array must still know what
 *   kind of account is being created. Falling back to INDIVIDUAL is safe in a
 *   way the alternatives are not: it is the least-privileged of the three, and
 *   the server validates the value again anyway.
 *
 *   homeRouteFor() is the ONLY place that decides which dashboard someone lands
 *   on, and it reads the type the SERVER returned - never the one tapped at the
 *   front door. Someone who chose the wrong card is not stranded; they simply
 *   arrive where their account actually belongs.
 */
import type { AccountType } from '../api/types';

const TYPES: AccountType[] = ['INDIVIDUAL', 'STORE', 'COURIER'];

/** A route param, of whatever shape expo-router hands over, as a real type. */
export function readAccountType(raw: unknown): AccountType {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return TYPES.includes(v as AccountType) ? (v as AccountType) : 'INDIVIDUAL';
}

export const ACCOUNT_COPY: Record<
  AccountType,
  { label: string; registerTitle: string; registerSubtitle: string }
> = {
  INDIVIDUAL: {
    label: 'Individual',
    registerTitle: 'Create Account',
    registerSubtitle: "Join AfriZone PartTime as a Tasker. You'll verify your identity (KYC) right after.",
  },
  STORE: {
    label: 'Store',
    registerTitle: 'Create a store account',
    registerSubtitle:
      'Sign up, then we will connect you to your store. Afrizone approves every store before it can take orders.',
  },
  COURIER: {
    label: 'Courier',
    registerTitle: 'Create a courier account',
    registerSubtitle:
      "Sign up to deliver orders. You'll verify your identity and add your licence right after.",
  },
};

/**
 * Where an account belongs after sign-in.
 *
 * COURIER goes to the worker dashboard on purpose, and this is the line to
 * change if that decision goes the other way. Deliveries are Tasks, so a
 * courier already sees delivery work in the same feed as everything else; a
 * separate courier app is a routing change here, not a data-model one. Keeping
 * that as one line is the whole reason this function exists rather than an
 * inline ternary at the call site.
 *
 * STORE also goes to the tab bar now, not the standalone /store screen -
 * (tabs)/home.tsx itself renders the store dashboard in place of the worker
 * task feed for a STORE account, so Home/My Tasks/Wallet/Profile all work
 * normally and a store owner still has a way to log out and manage
 * notifications. Jobs is hidden for STORE in (tabs)/_layout.tsx instead of
 * being handled here.
 */
export function homeRouteFor(accountType: AccountType | undefined): string {
  return '/(tabs)/home';
}
