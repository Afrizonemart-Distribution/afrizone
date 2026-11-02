/**
 * Which time a clock event gets (Blueprint §16, offline-tolerant flows).
 *
 * The app sends the moment the Tasker tapped, every time. Online that is a
 * second or two before it arrives and the server's own clock is used, as it
 * always was. Offline the phone keeps the event and sends it when it has
 * signal again, perhaps hours later - and a Tasker who clocked out in a
 * basement should not be paid until they reached the street.
 *
 * AS DECIDED: the phone's time counts when it is believable, and the event is
 * marked so the manager sees it on the timesheet. Believable means:
 *
 *   - not in the future (beyond a little drift between two clocks),
 *   - no more than MAX_AGE_HOURS old - a phone that has been off for days is
 *     not where a timesheet should come from, and
 *   - not before this Tasker's previous event on the job, so IN and OUT can
 *     never be put in the wrong order by a phone with the wrong time.
 *
 * Anything else falls back to the time it arrived, still marked offline, which
 * is the old behaviour plus an honest label.
 */

/** Arrived within this of being made: an ordinary online tap. Server time. */
export const ONLINE_LAG_MS = 2 * 60_000;
/** A phone clock may run this far ahead before it is disbelieved. */
export const MAX_AHEAD_MS = 2 * 60_000;
export const MAX_AGE_HOURS = 24;

export interface ClockTime {
  /** The time the event is recorded at. */
  at: Date;
  /** It reached us late enough that this is (or should have been) the phone's time. */
  offline: boolean;
  /** The phone's time was offered and not believed. */
  adjusted: boolean;
}

export function clockTime(claimedRaw: unknown, now: Date, lastEventAt: Date | null): ClockTime {
  const claimed =
    typeof claimedRaw === "string" && !Number.isNaN(Date.parse(claimedRaw)) ? new Date(claimedRaw) : null;
  if (!claimed) return { at: now, offline: false, adjusted: false };

  const lag = now.getTime() - claimed.getTime();
  if (lag <= ONLINE_LAG_MS && lag >= -MAX_AHEAD_MS) return { at: now, offline: false, adjusted: false };
  // A phone whose clock is ahead says nothing about whether it was offline;
  // the tap is treated as arriving now, which it almost certainly did.
  if (lag < 0) return { at: now, offline: false, adjusted: true };

  const believable =
    lag > 0 &&
    lag <= MAX_AGE_HOURS * 3_600_000 &&
    (!lastEventAt || claimed.getTime() >= lastEventAt.getTime());
  return believable
    ? { at: claimed, offline: true, adjusted: false }
    : { at: now, offline: true, adjusted: true };
}
