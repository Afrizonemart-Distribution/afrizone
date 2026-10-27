/**
 * The orders a rider is carrying (MART_INTEGRATION.md §3.1, §4).
 *
 * THIS IS THE SCREEN SOMEBODY USES STANDING OUTSIDE A SHOP, so it says the
 * shortest true thing at every point and puts the one action that matters where
 * a thumb already is. Live jobs first; finished ones below and quieter.
 *
 * THE CUSTOMER'S DOOR AND NUMBER APPEAR HERE and nowhere else in the app. They
 * are on the job, not on the posting: a public task listing every courier can
 * read is not somewhere a stranger's address belongs, and §5 only lets us hold
 * them for as long as it takes to deliver one order.
 *
 * THE CODE HAS THREE OUTCOMES, NOT TWO, and this is the part worth being
 * careful about. Right, wrong, or we could not ask. A rider told the customer
 * read it out wrong, when in fact nothing was checked, ends up arguing on a
 * doorstep about a check that never ran - so the unreachable case is worded as
 * ours, and says not to leave the goods.
 *
 * AVAILABLE WORK SITS ABOVE CARRIED WORK (MART_INTEGRATION.md §6 D4). A courier
 * may now take a delivery themselves rather than applying and waiting for an
 * admin, and the first question somebody opens this screen with on a slow
 * afternoon is "what can I pick up", not "what am I holding".
 *
 * GOING ONLINE PUTS A RIDER FIRST IN LINE. While online, an order from a shop
 * they are among the best placed for is held for them alone for a couple of
 * minutes before anyone else may take it, and the card counts that down. The
 * toggle sits above everything because it decides whether any of that happens.
 *
 * A JOB THAT CANNOT BE CLAIMED IS STILL SHOWN, with the reason on it. An empty
 * screen looks the same whether there is no work or the phone would not say
 * where it is, and a rider deciding whether to go home needs those to look
 * different. The reason is the server's sentence, never one composed here.
 *
 * Restyled onto the navy/gold palette. Every judgement above survives it,
 * including the two buttons that keep a pill shape and a lift while the rest
 * of the app uses the cut rectangle. One thing did change on purpose: the
 * directions link was raw `clay` gold at about 1.9:1 on white, so its words
 * are now amberInk and the glyph keeps the gold.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, Linking, ScrollView, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { canPoint, directionsLabel, openDirections, openPlace, type Place } from '../src/lib/directions';
import * as Location from 'expo-location';
import { LinearGradient } from 'expo-linear-gradient';
import { AppBackHeader, AppPrimaryButton, AppEmptyState, AppErrorState, AppLoadingCards } from '../src/appui/AppUI';
import { Icon, IconName } from '../src/components/Icon';
import { obColors, obRadii } from '../src/onboarding/onboardingTheme';
import { api, ApiError } from '../src/api/client';
import { goOffline, goOnline, useBackgroundPresence, usePresence } from '../src/lib/presence';
import EvidencePanel from '../src/components/EvidencePanel';
import { useAsync } from '../src/lib/useAsync';
import type { Delivery, DeliveryOffer, DeliveryStatus } from '../src/api/types';

/** Whole Naira. There is no currency field anywhere in this platform. */
function naira(n: number): string {
  return `₦${n.toLocaleString('en-NG')}`;
}

const LIVE: DeliveryStatus[] = ['RECEIVED', 'STORE_ACCEPTED', 'COURIER_ASSIGNED', 'PICKED_UP'];

/**
 * Send the rider somewhere.
 *
 * Renders NOTHING when there is no coordinate and no address, rather than a
 * button that opens an empty map. A store whose owner never set a location is a
 * real and common row - the admin store map has a counter for exactly that -
 * and a control that cannot work is worse than an absent one to somebody
 * standing on a kerb.
 */
function Directions({
  to,
  label,
  place,
  onFail,
}: {
  to: Place;
  label: string;
  /** Show where it is instead of routing to it. For a job not yet taken. */
  place?: boolean;
  onFail?: () => void;
}) {
  if (!canPoint(to)) return null;
  return (
    <Pressable
      onPress={() => {
        void (place ? openPlace(to) : openDirections(to)).then((ok) => {
          if (!ok) onFail?.();
        });
      }}
      style={styles.directions}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon name={place ? 'map-pin' : 'navigation'} size={15} color={obColors.goldDeep} />
      <Text style={styles.directionsText}>{label}</Text>
    </Pressable>
  );
}

/**
 * Colours for the state badge. Nothing here composes the WORDING - the server
 * does. Each pair is a tint with its ink-weight partner, never the brighter
 * fill: amber and red cannot carry 11px type on their own backgrounds.
 */
const TONE: Record<DeliveryStatus, { fg: string; bg: string }> = {
  RECEIVED: { fg: obColors.textMut, bg: obColors.sand },
  STORE_ACCEPTED: { fg: obColors.amberInk, bg: obColors.orangeInkBg },
  STORE_REJECTED: { fg: obColors.textMut, bg: obColors.sand },
  COURIER_ASSIGNED: { fg: obColors.amberInk, bg: obColors.orangeInkBg },
  PICKED_UP: { fg: obColors.indigo, bg: obColors.indigoBg },
  DELIVERED: { fg: obColors.forest, bg: obColors.mgreenBg },
  FAILED: { fg: obColors.dangerInk, bg: obColors.dangerBg },
  CANCELLED: { fg: obColors.textMut, bg: obColors.sand },
};

function Badge({ d }: { d: Delivery }) {
  const tone = TONE[d.status];
  return (
    <View style={[styles.badge, { backgroundColor: tone.bg }]}>
      <Text style={[styles.badgeText, { color: tone.fg }]}>{d.statusLabel}</Text>
    </View>
  );
}

/**
 * The one unmistakable action on a card: a pill, and optionally lifted.
 *
 * Every other button in the app is AppPrimaryButton's cut rectangle. These
 * two moments - the goods are in the bag, the delivery is done - were given a
 * shape nothing else has, and that was a deliberate call worth keeping
 * through the restyle. Local rather than a kit variant because nothing
 * outside this screen has earned it.
 */
function PillAction({
  label,
  onPress,
  loading,
  disabled,
  lifted,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  lifted?: boolean;
}) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled }}
      style={({ pressed }) => [
        styles.pillAction,
        lifted && styles.pillActionLifted,
        isDisabled && { opacity: 0.5 },
        pressed && !isDisabled && { opacity: 0.85 },
      ]}
    >
      <LinearGradient
        colors={[obColors.gold, obColors.goldDeep]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <Text style={styles.pillActionText}>{loading ? 'Please wait…' : label}</Text>
    </Pressable>
  );
}

/**
 * A block of a job card: where the goods are, or where they are going.
 *
 * AN ICON, NOT A LABEL COLUMN. This used to be a fixed-width "Collect" /
 * "Deliver" caption sat to the left of the content, the way a form labels a
 * field - fine for a form, but every one of these rows is the same two
 * things every time (the shop, or the customer), so a courier does not need
 * the word spelled out on every card, every time. A small icon says it once
 * and gives the address, the phone number and the directions link the
 * width the label column used to take from them.
 */
function Line({
  icon,
  label,
  children,
}: {
  icon: IconName;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.line}>
      <View style={styles.lineHead}>
        <Icon name={icon} size={13} color={obColors.textMut} />
        <Text style={styles.lineLabel}>{label}</Text>
      </View>
      <View style={styles.lineBody}>{children}</View>
    </View>
  );
}

function JobCard({ d, onChange }: { d: Delivery; onChange: (next: Delivery) => void }) {
  const [busy, setBusy] = useState<'pickup' | 'complete' | 'fail' | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Set only when the check could not be MADE. Deliberately its own state. */
  const [unreachable, setUnreachable] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [failing, setFailing] = useState(false);
  const [reason, setReason] = useState('');
  // Whether this step's photo is in. Starts true so a job that asks for none,
  // or a panel that has not answered yet, never locks the button - the server
  // is what refuses a missing photo.
  const [pickupShown, setPickupShown] = useState(true);
  const [doorShown, setDoorShown] = useState(true);

  async function pickUp() {
    setBusy('pickup');
    setError(null);
    try {
      onChange(await api.markPickedUp(d.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save that.');
    } finally {
      setBusy(null);
    }
  }

  async function complete() {
    setBusy('complete');
    setError(null);
    setUnreachable(null);
    try {
      onChange(await api.completeDelivery(d.id, code.trim()));
      setCode('');
    } catch (e) {
      // 503 is "we could not ask". It must never be shown as a wrong code.
      if (e instanceof ApiError && e.status === 503) setUnreachable(e.message);
      else setError(e instanceof ApiError ? e.message : 'Could not check that code.');
    } finally {
      setBusy(null);
    }
  }

  async function fail() {
    setBusy('fail');
    setError(null);
    try {
      onChange(await api.failDelivery(d.id, reason.trim()));
      setFailing(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not record that.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.order}>{d.martOrderId}</Text>
        <Badge d={d} />
      </View>

      <Line icon="cart" label="Collect">
        <Text style={styles.strong}>{d.storeName ?? 'the store'}</Text>
        {d.pickupAddress ? <Text style={styles.body}>{d.pickupAddress}</Text> : null}
        {d.preparedAt && d.status === 'COURIER_ASSIGNED' ? (
          <View style={styles.readyPill}>
            <Icon name="check-circle" size={12} color={obColors.forest} />
            <Text style={styles.readyText}>Packed and ready</Text>
          </View>
        ) : null}
        {/* Only before the goods are in the bag. Once they are, the shop is
            behind them and the only address that matters is the customer's. */}
        {d.status !== 'PICKED_UP' ? (
          <Directions
            to={{ lat: d.pickupLat, lng: d.pickupLng, address: d.pickupAddress }}
            label={directionsLabel.shop}
            onFail={() => setError('Could not open a map on this phone.')}
          />
        ) : null}
      </Line>

      <Line icon="map-pin" label="Deliver">
        {d.customerPurged ? (
          // §5: we said we would delete this seven days after the order
          // finished, and we did. Saying so is not the same as a blank row.
          <Text style={styles.muted}>Removed seven days after this order finished</Text>
        ) : (
          <>
            {d.customerName ? <Text style={styles.strong}>{d.customerName}</Text> : null}
            <Text style={styles.body}>{d.dropoffAddress ?? '—'}</Text>
            {d.dropoffInstructions ? (
              <Text style={styles.muted}>{d.dropoffInstructions}</Text>
            ) : null}
            {/* Shown from the moment the job is theirs, not only after pickup:
                a rider planning a route wants to know which way they are
                heading before they set off for the shop. */}
            <Directions
              to={{ lat: d.dropoffLat, lng: d.dropoffLng, address: d.dropoffAddress }}
              label={directionsLabel.door}
              onFail={() => setError('Could not open a map on this phone.')}
            />
            {d.customerPhone ? (
              <Pressable
                onPress={() => Linking.openURL(`tel:${d.customerPhone}`)}
                style={styles.call}
                accessibilityRole="button"
                accessibilityLabel={`Call ${d.customerName ?? 'the customer'}`}
              >
                <Icon name="phone" size={15} color={obColors.orangeInk} />
                <Text style={styles.callText}>{d.customerPhone}</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </Line>

      {d.items.length > 0 ? (
        <Line icon="cart" label="Items">
          {/* A LIST, NOT A SENTENCE - the same fix the portal's order card
              needed. Comma-joined item names read fine for two items and
              become unreadable at six; this is the packing list somebody
              works down, so the quantity leads each line the way it is
              actually counted out. The VALUE below is untouched - same
              naira(d.goodsTotal), same figure, only how the item names above
              it are laid out has changed. */}
          <View style={styles.itemList}>
            {d.items.map((i, idx) => (
              <View key={idx} style={styles.itemRow}>
                <Text style={styles.itemQty}>{i.qty ?? 1}</Text>
                <Text style={styles.body}>{i.name ?? i.ref ?? 'Item'}</Text>
              </View>
            ))}
          </View>
          {/* What the rider is carrying is worth. Not their fee - that is on
              the task and comes from rules.DELIVERY - but somebody responsible
              for a bag of goods should know what is in their hands. */}
          <Text style={styles.muted}>{naira(d.goodsTotal)} of goods</Text>
        </Line>
      ) : null}

      {d.failureReason ? (
        <Line icon="alert" label="Reported">
          <Text style={styles.body}>{d.failureReason}</Text>
        </Line>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {unreachable ? (
        // Not styled as the rider's mistake, because nothing was checked.
        <View style={styles.notice}>
          {/* Leads with the action, not the fault, and does not repeat the
              sentence the server writes underneath. */}
          <Text style={styles.noticeTitle}>Not checked — do not leave the goods</Text>
          <Text style={styles.noticeBody}>
            {unreachable} Try again in a moment. If it keeps failing, call Afrizone before you
            leave.
          </Text>
        </View>
      ) : null}

      {d.status === 'COURIER_ASSIGNED' ? (
        <View style={styles.action}>
          {d.taskId ? <EvidencePanel taskId={d.taskId} stage="PICKUP" onReady={setPickupShown} /> : null}
          <View style={styles.gap}>
            <PillAction
              label="Collected from the store"
              onPress={pickUp}
              loading={busy === 'pickup'}
              disabled={!pickupShown}
            />
          </View>
        </View>
      ) : null}

      {d.status === 'PICKED_UP' && !failing ? (
        <View style={styles.action}>
          {/* No live map — deliberate, see BLUEPRINT_STATUS.md and
              ARCHITECTURE.md on why the app hands off to the rider's own
              navigation app rather than embedding one. This is the same
              instinct without the infrastructure it would need: a schematic
              of where the trip started and where it ends, not a real one. */}
          <View style={styles.route}>
            <View style={styles.routeEnd}>
              <Icon name="check-circle" size={16} color={obColors.forest} />
              <Text style={styles.routeLabel} numberOfLines={1}>
                {d.storeName ?? 'the store'}
              </Text>
            </View>
            <View style={styles.routeLine} />
            <View style={[styles.routeEnd, styles.routeEndRight]}>
              <Text style={[styles.routeLabel, styles.routeLabelRight]} numberOfLines={1}>
                {d.customerName ?? 'the customer'}
              </Text>
              <Icon name="map-pin" size={16} color={obColors.goldDeep} />
            </View>
          </View>

          {/* The door photo before the code: checking the code spends one of
              the customer's attempts, and a completion that was always going to
              be refused for a missing photo should not cost them one. */}
          {d.taskId ? <EvidencePanel taskId={d.taskId} stage="DROPOFF" onReady={setDoorShown} /> : null}

          <View style={[styles.codePanel, styles.gap]}>
            <Text style={styles.fieldLabel}>The customer&apos;s code</Text>
            <TextInput
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              placeholder="4821"
              placeholderTextColor={obColors.textMut}
              style={styles.codeInput}
              accessibilityLabel="The code the customer received"
            />
            <Text style={styles.hint}>
              AfriZoneMart sent this to the customer. Ask them to read it out — it is the only
              thing that completes the delivery.
            </Text>
          </View>

          <View style={styles.gap}>
            <PillAction
              label="Complete delivery"
              onPress={complete}
              loading={busy === 'complete'}
              disabled={code.trim().length === 0 || !doorShown}
              lifted
            />
          </View>
          <Pressable onPress={() => setFailing(true)} style={styles.secondary}>
            <Text style={styles.secondaryText}>Could not deliver</Text>
          </Pressable>
        </View>
      ) : null}

      {d.status === 'PICKED_UP' && failing ? (
        <View style={styles.action}>
          <Text style={styles.fieldLabel}>What happened?</Text>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Nobody at the address after three calls"
            placeholderTextColor={obColors.textMut}
            style={styles.input}
            multiline
          />
          <Text style={styles.hint}>
            Afrizone reads this. It decides what happens to the goods and to your pay for the trip.
          </Text>
          <View style={styles.gap}>
            <AppPrimaryButton
              label="Report it"
              onPress={fail}
              loading={busy === 'fail'}
              disabled={reason.trim().length === 0}
            />
          </View>
          <Pressable onPress={() => setFailing(false)} style={styles.secondary}>
            <Text style={styles.secondaryText}>Back</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/**
 * A distance or a count, with a small icon in front of it.
 *
 * PRICE, THEN A ROW OF THESE, IS THE WHOLE DECISION. Instacart's own shopper
 * app puts distance and item count on the offer card as an icon-led pair
 * rather than two lines of text — a courier scanning a stack of offers reads
 * icon shapes faster than they read words, and a glyph plus a number takes a
 * third of the vertical space a labelled line did. Borrowed as an instinct,
 * not the icon set: theirs are colourful illustrations, this app draws every
 * icon as one stroke, and staying consistent with the rest of the product
 * matters more here than matching a marketing page.
 */
function Stat({ icon, children }: { icon: 'navigation' | 'cart'; children: React.ReactNode }) {
  return (
    <View style={styles.stat}>
      <Icon name={icon} size={14} color={obColors.textMut} />
      <Text style={styles.statText}>{children}</Text>
    </View>
  );
}

/** 105 -> "1:45". */
function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Count a server-given number of seconds down locally, once a second, and ask
 * for a refresh when it runs out - the job has moved on to the next courier,
 * and leaving a button that will be refused on screen helps nobody.
 */
function useCountdown(start: number | null, onDone: () => void): number | null {
  const [left, setLeft] = useState(start);
  useEffect(() => {
    setLeft(start);
    if (start === null) return;
    const began = Date.now();
    const t = setInterval(() => {
      const next = start - Math.floor((Date.now() - began) / 1000);
      setLeft(next);
      if (next <= 0) {
        clearInterval(t);
        onDone();
      }
    }, 1000);
    return () => clearInterval(t);
    // onDone is the screen's refresh and changes identity every render; the
    // countdown restarts only when the server gives a new number.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);
  return left;
}

/**
 * Online or offline for ranked offers.
 *
 * Says what being online DOES, in a line, because "Go online" alone reads like
 * a chat status. The position it shares is explained in the same breath: a
 * rider deciding whether to tap this should know what they are agreeing to.
 */
function OnlineCard() {
  const online = usePresence();
  const background = useBackgroundPresence();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      if (online) await goOffline();
      else await goOnline();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change that. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (online === null) return null;
  return (
    <View style={[styles.card, styles.onlineCard]}>
      <View style={styles.onlineHead}>
        <View style={[styles.dot, online ? styles.dotOn : styles.dotOff]} />
        <Text style={styles.onlineTitle}>{online ? 'You are online' : 'You are offline'}</Text>
      </View>
      <Text style={styles.onlineBody}>
        {online
          ? background
            ? 'Orders from shops near you come to you first, held for you for a couple of minutes. You stay online with the app closed; your location is shared until you go offline, and deleted then.'
            : 'Orders from shops near you come to you first, held for you for a couple of minutes. Keep the app open to stay online: allow location "all the time" in your phone settings to stay online with it closed.'
          : 'Go online to be offered orders first when you are one of the nearest riders. Your location is shared only while you are online.'}
      </Text>
      <Pressable
        onPress={toggle}
        disabled={busy}
        style={[styles.onlineButton, online ? styles.onlineButtonOff : styles.onlineButtonOn]}
      >
        <Text style={[styles.onlineButtonText, online ? styles.onlineButtonTextOff : null]}>
          {busy ? 'One moment…' : online ? 'Go offline' : 'Go online'}
        </Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

/**
 * One order nobody has taken yet.
 *
 * THE FEE LEADS, ALONE ON ITS OWN LINE, because that is what a courier is
 * deciding on — not sharing a row with the store name where a long name
 * would squeeze it small at exactly the moment it should be the biggest
 * thing on the card. Distance and item count sit under it as a single
 * icon-led row, the two facts that turn a price into "worth the ride" or
 * not, both readable in the same half-second as the fee itself.
 *
 * A thin gold edge marks this as something OFFERED rather than something
 * already carried — the one visual difference between this and JobCard,
 * because the two are different questions: "should I take this" against
 * "what do I do next with what I already have".
 */
function OfferCard({
  o,
  at,
  onTaken,
}: {
  o: DeliveryOffer;
  at: { lat: number; lng: number } | null;
  onTaken: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [passing, setPassing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const held = o.yourTurnSecondsLeft !== null;
  const secondsLeft = useCountdown(o.yourTurnSecondsLeft, onTaken);

  async function claim() {
    // Location is needed to take a job off the open board, not one held for
    // you - you were chosen for where you went online.
    if (!at && !held) return;
    setBusy(true);
    setError(null);
    try {
      await api.claimDelivery(o.id, at);
      onTaken();
    } catch (e) {
      // The server's sentence, whatever the refusal was. Somebody else taking
      // it first is the common one and reads as an ordinary fact, not a fault.
      setError(e instanceof ApiError ? e.message : 'Could not take this job. Try again.');
      onTaken();
    } finally {
      setBusy(false);
    }
  }

  // Saying no out loud instead of letting the clock run: the next courier gets
  // the whole of their window rather than whatever this one left them.
  async function pass() {
    setPassing(true);
    setError(null);
    try {
      await api.passDelivery(o.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not pass on this job. Try again.');
    } finally {
      setPassing(false);
      onTaken();
    }
  }

  return (
    <View style={[styles.card, styles.offerCard, held && styles.offerCardHeld]}>
      {held ? (
        <View style={styles.heldBanner}>
          <Icon name="clock" size={14} color={obColors.amberInk} />
          <Text style={styles.heldText}>
            Held for you · {mmss(secondsLeft ?? 0)}
          </Text>
        </View>
      ) : null}
      <Text style={styles.offerFee}>{naira(o.fee)}</Text>
      <Text style={styles.offerStore} numberOfLines={1}>
        {o.storeName ?? 'Pickup'}
      </Text>

      <View style={styles.statRow}>
        {/* "8.0 km away" is a straight line over rooftops; whether that is ten
            minutes or forty is the thing a rider is actually deciding, and it
            is not a question this app can answer — so it says distance, not
            time, and leaves the judgement to them. */}
        {o.distance ? <Stat icon="navigation">{o.distance} away</Stat> : null}
        {o.items.length > 0 ? (
          <Stat icon="cart">
            {o.items.length} {o.items.length === 1 ? 'item' : 'items'}
          </Stat>
        ) : null}
      </View>

      <Text style={styles.offerAddress} numberOfLines={2}>
        {o.pickupAddress ?? 'Address not set'}
      </Text>
      <Directions
        to={{ lat: o.pickupLat, lng: o.pickupLng, address: o.pickupAddress }}
        label="See where it is"
        place
        onFail={() => setError('Could not open a map on this phone.')}
      />

      {/* The server writes this. It says how long the order has waited and
          whether the circle has widened - a job nobody has taken for twenty
          minutes is worth knowing about before riding to it. */}
      {o.offer.stage !== 'OFFERED' && !held ? (
        <View style={styles.waitingRow}>
          <Icon name="clock" size={13} color={obColors.orangeInk} />
          <Text style={styles.waiting}>{o.offer.label}</Text>
        </View>
      ) : null}

      {o.claimable ? (
        <View style={styles.action}>
          <AppPrimaryButton label="Take this job" onPress={claim} loading={busy} disabled={passing} />
          {held ? (
            <Pressable
              onPress={pass}
              disabled={busy || passing}
              style={styles.secondary}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryText}>{passing ? 'Passing…' : 'Pass to the next courier'}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <View style={styles.blocked}>
          <Text style={styles.blockedText}>{o.reason}</Text>
          {/* While it is with the best-placed couriers, the reason already says
              when it comes round; saying it twice is noise. */}
          {o.offer.stage !== 'RANKED' && o.opensToYouInMinutes !== null && o.opensToYouInMinutes > 0 ? (
            <Text style={styles.blockedHint}>
              Opens to you in about {o.opensToYouInMinutes} min if nobody takes it.
            </Text>
          ) : null}
        </View>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

export default function DeliveriesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const load = useAsync((signal) => api.myDeliveries(signal));
  const [jobs, setJobs] = useState<Delivery[] | null>(null);

  // Where the courier is, asked once when the screen opens. Not watched: this
  // is a list of shops to ride to, not a geofence, and a subscription would run
  // the GPS for as long as somebody leaves the screen open.
  const [at, setAt] = useState<{ lat: number; lng: number } | null>(null);
  const [locationAsked, setLocationAsked] = useState(false);
  const [offers, setOffers] = useState<DeliveryOffer[] | null>(null);
  const [selfClaim, setSelfClaim] = useState(true);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          if (live) setAt({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        }
      } catch {
        // Refused, or no fix. The offers call is still made - see the note at
        // the top of this file about why an empty screen is the wrong answer.
      } finally {
        if (live) setLocationAsked(true);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const loadOffers = useCallback(async () => {
    if (!locationAsked) return;
    try {
      const res = await api.deliveryOffers(at);
      setOffers(res.offers);
      setSelfClaim(res.selfClaim);
    } catch {
      // A failed offers call must not take the carried jobs down with it. What
      // a rider is already holding is the more important half of this screen.
      setOffers([]);
    }
  }, [at, locationAsked]);

  useEffect(() => {
    void loadOffers();
  }, [loadOffers]);

  // While online, look again every 20 seconds. A job held for this rider lasts
  // two minutes; one that only appears on a pull-to-refresh is one they miss.
  const online = usePresence();
  useEffect(() => {
    if (!online) return;
    const t = setInterval(() => void loadOffers(), 20_000);
    return () => clearInterval(t);
  }, [online, loadOffers]);

  function refreshAll() {
    load.reload();
    void loadOffers();
  }

  useEffect(() => {
    if (load.data) setJobs(load.data);
  }, [load.data]);

  function replace(next: Delivery) {
    setJobs((cur) => (cur ?? []).map((j) => (j.id === next.id ? { ...j, ...next } : j)));
  }

  const all = jobs ?? [];
  const live = all.filter((j) => LIVE.includes(j.status));
  const done = all.filter((j) => !LIVE.includes(j.status));
  const available = offers ?? [];
  // The section-header total from the reference's transaction list, applied
  // to what it actually means here: what today's finished deliveries paid.
  const finishedEarned = done
    .filter((j) => j.status === 'DELIVERED')
    .reduce((sum, j) => sum + (j.deliveryFee ?? 0), 0);

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 18, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={load.loading && !!jobs} onRefresh={refreshAll} tintColor={obColors.navy} />}
      >
        <AppBackHeader title="Deliveries" onBack={() => router.back()} />
        {live.length > 0 ? <Text style={styles.subtitle}>{live.length} on the go</Text> : null}
        <OnlineCard />

        {load.loading && !jobs ? (
          <AppLoadingCards count={2} />
        ) : load.error && !jobs ? (
          <AppErrorState message={load.error} onRetry={load.reload} />
        ) : (
          <>
            {available.length > 0 ? (
              <>
                <Text style={styles.sectionFirst}>Available now</Text>
                {available.map((o) => (
                  <OfferCard key={o.id} o={o} at={at} onTaken={refreshAll} />
                ))}
              </>
            ) : null}

            {all.length === 0 && available.length === 0 ? (
              <AppEmptyState
                icon="map-pin"
                title="Nothing to carry yet"
                message={
                  selfClaim
                    ? 'Orders appear here as stores accept them. Take one and it is yours straight away.'
                    : 'Delivery jobs are being assigned by the Afrizone team just now. Apply for one and it appears here once it is yours.'
                }
              />
            ) : null}

            {live.length > 0 && available.length > 0 ? (
              <Text style={styles.sectionTitle}>Carrying</Text>
            ) : null}

            {live.map((j) => (
              <JobCard key={j.id} d={j} onChange={replace} />
            ))}

            {done.length > 0 ? (
              <>
                <View style={styles.sectionHead}>
                  <Text style={[styles.sectionTitle, styles.sectionTitleInRow]}>Finished</Text>
                  {finishedEarned > 0 ? (
                    <Text style={styles.sectionTotal}>{naira(finishedEarned)} earned</Text>
                  ) : null}
                </View>
                {done.map((j) => (
                  <JobCard key={j.id} d={j} onChange={replace} />
                ))}
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: obColors.bg },
  subtitle: { fontSize: 13, color: obColors.textMut, marginTop: -8, marginBottom: 16 },
  card: {
    backgroundColor: obColors.white,
    borderWidth: 1,
    borderColor: obColors.line,
    borderRadius: obRadii.card,
    borderTopRightRadius: obRadii.cardCut,
    padding: 16,
    marginBottom: 14,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 10,
  },
  order: { fontSize: 14, fontFamily: 'Raleway_800ExtraBold', color: obColors.navy, flexShrink: 1 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: obRadii.pill },
  badgeText: { fontSize: 11, fontWeight: '700' },

  // No more fixed-width label column - an icon plus a small caption above
  // the content instead, so the address, phone and directions link below get
  // the full card width rather than sharing the row with a 66px label.
  line: { paddingVertical: 8, gap: 4 },
  lineHead: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  lineLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: obColors.textMut,
  },
  lineBody: { gap: 2 },

  strong: { fontSize: 14, fontWeight: '800', color: obColors.text },
  body: { fontSize: 13.5, color: obColors.text },
  muted: { fontSize: 12.5, color: obColors.textMut },

  // "Packed and ready" as a small chip rather than plain bold text - the
  // same status-chip language used everywhere else on this card, so it does
  // not look like a stray sentence next to the address.
  readyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: 2,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: obRadii.pill,
    backgroundColor: obColors.mgreenBg,
  },
  readyText: { fontSize: 11, fontWeight: '700', color: obColors.forest },

  // The packing list. qty in a small fixed column so the numbers line up and
  // read as a column, the way somebody actually counts a bag out.
  itemList: { gap: 4 },
  itemRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  itemQty: {
    minWidth: 20,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '700',
    color: obColors.textMut,
    backgroundColor: obColors.sand,
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
    overflow: 'hidden',
  },

  directions: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  // amberInk, not the gold the glyph beside it uses: raw gold is about 1.9:1
  // on white, which is the same trap the tab bar's own comment records.
  directionsText: { fontSize: 13.5, color: obColors.amberInk, fontWeight: '800' },

  call: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  callText: { fontSize: 13.5, color: obColors.amberInk, fontWeight: '800' },

  error: { fontSize: 12.5, color: obColors.dangerInk, marginTop: 10 },
  notice: {
    backgroundColor: obColors.orangeInkBg,
    borderRadius: obRadii.field,
    padding: 13,
    marginTop: 12,
  },
  noticeTitle: { fontSize: 13.5, fontWeight: '800', color: obColors.amberInk },
  noticeBody: { fontSize: 12.5, color: obColors.text, marginTop: 4, lineHeight: 18 },

  action: { marginTop: 18 },
  gap: { marginTop: 12 },
  fieldLabel: { fontSize: 12.5, fontWeight: '700', color: obColors.text, marginBottom: 6 },
  codeInput: {
    borderWidth: 1,
    borderColor: obColors.line,
    borderRadius: obRadii.field,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 20,
    // Read out loud, digit by digit, usually in a hurry. Wide tracking makes a
    // mistyped code visible before it is submitted.
    letterSpacing: 6,
    color: obColors.text,
    backgroundColor: obColors.white,
  },
  input: {
    borderWidth: 1,
    borderColor: obColors.line,
    borderRadius: obRadii.field,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 14,
    color: obColors.text,
    backgroundColor: obColors.white,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  hint: { fontSize: 11.5, color: obColors.textMut, marginTop: 6, lineHeight: 16 },

  secondary: { alignItems: 'center', paddingVertical: 13, marginTop: 4 },
  secondaryText: { fontSize: 13.5, color: obColors.textMut, fontWeight: '800' },

  sectionTitle: {
    fontSize: 15.5,
    fontFamily: 'Raleway_800ExtraBold',
    color: obColors.navy,
    marginTop: 18,
    marginBottom: 12,
  },
  // The "Finished" title shares a row with its earned total (the reference's
  // date-header/total anatomy) rather than sitting on its own line, so its
  // own vertical margins move to the row and it drops its own here.
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    marginBottom: 12,
  },
  sectionTitleInRow: { marginTop: 0, marginBottom: 0 },
  sectionTotal: { fontSize: 12.5, fontWeight: '800', color: obColors.forest },
  sectionFirst: {
    fontSize: 15.5,
    fontFamily: 'Raleway_800ExtraBold',
    color: obColors.navy,
    marginBottom: 12,
  },

  // ── OfferCard: fee-led, icon-stat row ──────────────────────────────────
  // The gold edge that says OFFERED rather than carried. A left border, not
  // the cut corner every other card uses, so the two read apart at a glance
  // in a mixed list.
  offerCard: { borderLeftWidth: 3, borderLeftColor: obColors.goldDeep },
  // Held for this rider: the gold edge widens and a banner leads, so it reads
  // as different from every other offer before a word of it is read.
  offerCardHeld: { borderLeftWidth: 5 },
  heldBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginBottom: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: obRadii.pill,
    backgroundColor: obColors.orangeInkBg,
  },
  heldText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: obColors.amberInk,
    fontVariant: ['tabular-nums'],
  },

  // ── OnlineCard
  onlineCard: { gap: 8 },
  onlineHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotOn: { backgroundColor: obColors.forest },
  dotOff: { backgroundColor: obColors.line },
  onlineTitle: { fontSize: 15, fontFamily: 'Raleway_800ExtraBold', color: obColors.navy },
  onlineBody: { fontSize: 12.5, color: obColors.textMut, lineHeight: 18 },
  onlineButton: {
    minHeight: 46,
    borderRadius: obRadii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  onlineButtonOn: { backgroundColor: obColors.navy },
  onlineButtonOff: { backgroundColor: obColors.white, borderWidth: 1, borderColor: obColors.line },
  onlineButtonText: { fontFamily: 'Raleway_800ExtraBold', fontSize: 14.5, color: obColors.white },
  onlineButtonTextOff: { color: obColors.navy },
  // Deliberately larger than the standard `.strong`/`.order` text anywhere
  // else on this screen — three digits of Naira is the single fact a rider
  // decides on, and it should read from an arm's length before anything
  // else on the card does. forest, not gold: this is what the job is
  // worth, not a call to action - the button below is the action.
  offerFee: {
    fontSize: 30,
    lineHeight: 34,
    fontFamily: 'Raleway_800ExtraBold',
    color: obColors.forest,
    fontVariant: ['tabular-nums'],
  },
  offerStore: { fontSize: 12.5, color: obColors.textMut, marginTop: 2 },
  statRow: { flexDirection: 'row', gap: 18, marginTop: 12 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statText: { fontSize: 12.5, fontWeight: '700', color: obColors.textMut },
  offerAddress: { fontSize: 12.5, color: obColors.textMut, marginTop: 10 },
  waitingRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10 },
  waiting: { fontSize: 12.5, color: obColors.amberInk, fontWeight: '700' },
  blocked: {
    backgroundColor: obColors.sand,
    borderRadius: obRadii.field,
    padding: 13,
    marginTop: 12,
  },
  blockedText: { fontSize: 12.5, color: obColors.text, lineHeight: 18 },
  blockedHint: { fontSize: 11.5, color: obColors.textMut, marginTop: 4 },

  // ── The delivery-completion moment ─────────────────────────────────────
  // A schematic trip, not a map: where the goods came from, where they are
  // going. check-circle on the left because that leg is already done by the
  // time this renders; map-pin on the right because that is where the rider
  // is headed next.
  route: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  routeEnd: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  routeEndRight: { flexDirection: 'row-reverse' },
  routeLabel: { fontSize: 11, fontWeight: '700', color: obColors.textMut },
  routeLabelRight: { textAlign: 'right' },
  // A dashed rule reads as a path in a way a solid one reads as a divider.
  // height: 0 with only borderTopWidth set, not backgroundColor - a filled
  // View has no dashed option, but a single dashed border edge does.
  routeLine: {
    flex: 1,
    height: 0,
    marginHorizontal: 10,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderColor: obColors.line,
  },

  codePanel: {
    backgroundColor: obColors.sand,
    borderRadius: obRadii.field,
    padding: 16,
  },

  // The one unmistakable action on a card: a pill rather than the cut
  // rectangle, and for the completion moment a lift as well.
  pillAction: {
    minHeight: 50,
    borderRadius: obRadii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  pillActionLifted: {
    minHeight: 56,
    shadowColor: obColors.navy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  },
  pillActionText: { fontFamily: 'Raleway_800ExtraBold', fontSize: 15, color: obColors.navyPress },
});
