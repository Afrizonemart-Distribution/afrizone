import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { AppBackHeader, AppPrimaryButton, AppLoadingCards } from '../../src/appui/AppUI';
import { Banner } from '../../src/components/Feedback';
import { ClockInButton, GeofenceState } from '../../src/components/ClockInButton';
import { Icon } from '../../src/components/Icon';
import { obColors, obRadii } from '../../src/onboarding/onboardingTheme';
import { api, ApiError } from '../../src/api/client';
import { useAsync } from '../../src/lib/useAsync';
import { formatElapsed, payLabel, formatDate } from '../../src/lib/format';
import type { ClockResult, EvidenceRequirement, Task, Timesheet } from '../../src/api/types';
import EvidencePanel, { capturePhoto } from '../../src/components/EvidencePanel';
import { cachedCall } from '../../src/lib/offlineCache';
import { newClientId, sendOrQueue, useOutbox } from '../../src/lib/outbox';
import { OfflineNote, OutboxBanner } from '../../src/components/OfflineStatus';

/**
 * Restyled onto the navy/gold palette. Every piece of behaviour below - the
 * clock-state resume, the GPS geofence watch, the elapsed tick, the clock
 * toggle and the timesheet submit - is unchanged.
 *
 * PROOF OF WORK (server: services/evidence.ts). What this job asks for comes
 * from GET /me/evidence, never from the app: hourly on-site work clocks with a
 * fresh photo each way, field and media work is handed in with a photo of the
 * result, and a store audit is filed with photos of the premises - which is
 * the one job this screen files rather than timesheets.
 *
 * The task title moved out of the header and into the context card. The
 * header holds one line, and a real task title ("Warehouse picker - Ikeja,
 * evening shift") truncated there while the card below had room for all of
 * it. TierBadge is gone from the card for the same reason it left the task
 * cards: category and tier are usually the same word in practice, and the
 * pair rendered as a visible duplicate.
 */
function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function ActiveTaskScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Task context: fetched once on mount for the header card.
  const taskQ = useAsync<Task | null>(
    (signal) => (id ? api.task(id, signal) : Promise.resolve(null)),
    [id],
    { cacheKey: id ? `task:${id}` : null }
  );
  const t = taskQ.data;

  const [clockedIn, setClockedIn] = useState(false);
  const [elapsed, setElapsed] = useState(0); // seconds
  const [geofence, setGeofence] = useState<GeofenceState>('syncing');
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which steps of this job need photos. Empty until the server answers, and
  // empty for a job that needs none - both mean "do not ask for one".
  const [needs, setNeeds] = useState<EvidenceRequirement[]>([]);
  const [workShown, setWorkShown] = useState(true);
  const [auditShown, setAuditShown] = useState(true);
  const [score, setScore] = useState('');
  const [notes, setNotes] = useState('');
  const [filed, setFiled] = useState<string | null>(null);
  const [units, setUnits] = useState('');
  const [handInNote, setHandInNote] = useState('');
  /** Why the last hand-in was sent back, when it was. */
  const [sentBack, setSentBack] = useState<string | null>(null);
  const needsStage = (s: EvidenceRequirement['stage']) => needs.some((n) => n.stage === s);

  const startedAt = useRef<number | null>(null);
  const periodStart = useRef<string | null>(null);
  const workerCoords = useRef<{ lat: number; lng: number } | null>(null);

  // Clock events made with no signal and not yet sent (src/lib/outbox.ts).
  // Newer than anything the server knows, so the last one decides whether the
  // Tasker is on the clock.
  const outbox = useOutbox();
  const queuedClocks = outbox.filter(
    (i) => i.state === 'waiting' && i.action.kind === 'clock' && i.action.taskId === id
  );
  const queuedRef = useRef(queuedClocks);
  queuedRef.current = queuedClocks;
  useEffect(() => {
    const last = queuedClocks[queuedClocks.length - 1];
    if (!last || last.action.kind !== 'clock') return;
    if (last.action.type === 'IN') {
      startedAt.current = Date.parse(last.action.occurredAt);
      if (!periodStart.current) periodStart.current = last.action.occurredAt;
      setClockedIn(true);
    } else {
      setClockedIn(false);
    }
    // Only when the queue for this job grows or empties.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queuedClocks.length]);

  // Resume clock state and check for a prior submitted timesheet on mount.
  // Both kept, so the screen opens on the right state with no signal.
  useEffect(() => {
    if (!id) return;
    let active = true;
    const ctrl = new AbortController();
    (async () => {
      try {
        const [s, sheets] = await Promise.all([
          cachedCall(`clock:${id}`, () => api.clockState(id, ctrl.signal)),
          cachedCall('timesheets', () => api.myTimesheets(ctrl.signal)),
        ]);
        if (!active) return;
        // Anything queued is newer than what the server said.
        if (s.clockedIn && queuedRef.current.length === 0) {
          startedAt.current = Date.now() - s.elapsedSeconds * 1000;
          periodStart.current = s.lastEventAt ?? new Date(startedAt.current).toISOString();
          setElapsed(s.elapsedSeconds);
          setClockedIn(true);
        }
        // The latest hand-in for this task decides what shows: waiting or
        // approved means done; sent back means hand in again, with the reason.
        const latest = sheets.find((ts: Timesheet) => ts.taskId === id);
        if (latest && (latest.status === 'SUBMITTED' || latest.status === 'APPROVED')) setSubmitted(true);
        if (latest?.status === 'REWORK') setSentBack(latest.reviewNote ?? 'The reviewer asked for changes.');
      } catch (e) {
        if ((e as { name?: string } | null)?.name === 'AbortError') return; // not instanceof DOMException: Hermes has none
      }
    })();
    return () => {
      active = false;
      ctrl.abort();
    };
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const ctrl = new AbortController();
    cachedCall(`evidence:${id}`, () => api.myEvidence(id, ctrl.signal))
      .then((r) => setNeeds(r.requirements))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [id]);

  // GPS geofence check: starts once task data loads.
  useEffect(() => {
    if (!t) return;
    if (t.locationType === 'REMOTE' || t.lat == null || t.lng == null) {
      setGeofence('in-fence');
      return;
    }
    const taskLat = t.lat;
    const taskLng = t.lng;
    const radius = t.geofenceRadius ?? 100;
    let sub: Location.LocationSubscription | null = null;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setGeofence('out-of-fence');
        return;
      }
      setGeofence('syncing');
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 5 },
        (loc) => {
          const { latitude, longitude } = loc.coords;
          workerCoords.current = { lat: latitude, lng: longitude };
          const dist = haversineMetres(latitude, longitude, taskLat, taskLng);
          setGeofence(dist <= radius ? 'in-fence' : 'out-of-fence');
        }
      );
    })();

    return () => { sub?.remove(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t?.id, t?.locationType, t?.lat, t?.lng, t?.geofenceRadius]);

  // Elapsed timer ticks while clocked in.
  useEffect(() => {
    if (!clockedIn) return;
    const iv = setInterval(() => {
      if (startedAt.current) {
        setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [clockedIn]);

  async function toggleClock() {
    if (!id) return;
    setBusy(true);
    setError(null);
    const clockType = clockedIn ? 'OUT' : 'IN';
    try {
      // A fresh photo every time this job asks for one: the camera opens as
      // part of tapping the button, so there is no separate step to forget.
      let photo = null;
      if (needsStage(clockType === 'IN' ? 'CLOCK_IN' : 'CLOCK_OUT')) {
        photo = await capturePhoto();
        if (!photo) return; // backed out of the camera: not clocked, nothing to say
      }
      // The moment of the tap, and an id for it, go every time: with no
      // signal the event waits on the phone and the server records it at this
      // time when it arrives (server services/clockTime.ts).
      const tappedAt = new Date().toISOString();
      const sent = await sendOrQueue<ClockResult>(
        {
          kind: 'clock',
          taskId: id,
          type: clockType,
          lat: workerCoords.current?.lat ?? null,
          lng: workerCoords.current?.lng ?? null,
          occurredAt: tappedAt,
          clientId: newClientId(),
          photo,
        },
        clockType === 'IN' ? 'Clock in' : 'Clock out'
      );
      if (sent.queued) {
        // Shown as done, because it is: the time is fixed at the tap.
        if (clockType === 'IN') {
          startedAt.current = Date.parse(tappedAt);
          if (!periodStart.current) periodStart.current = tappedAt;
          setElapsed(0);
          setClockedIn(true);
        } else {
          setElapsed(startedAt.current ? Math.floor((Date.parse(tappedAt) - startedAt.current) / 1000) : elapsed);
          setClockedIn(false);
        }
        return;
      }
      const res = sent.result;
      if (res.clockedIn) {
        startedAt.current = Date.now() - res.elapsedSeconds * 1000;
        if (!periodStart.current) periodStart.current = res.event.createdAt;
        setElapsed(res.elapsedSeconds);
        setClockedIn(true);
      } else {
        setClockedIn(false);
        setElapsed(res.elapsedSeconds);
      }
    } catch (e) {
      const msg = e instanceof ApiError || e instanceof Error ? e.message : 'Could not record clock event.';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function submitTimesheet() {
    if (!id) return;
    // Handing in says the work is done; the server has to have the clock
    // times first, or the job is handed in before it was started.
    if (queuedClocks.length > 0) {
      setError('Your clock times are still waiting for signal. Hand in once they have been sent.');
      return;
    }
    const perUnit = t?.payModel === 'PER_UNIT';
    const count = Number(units);
    if (perUnit && (!Number.isInteger(count) || count < 1)) {
      setError(`Say how many ${t?.unitLabel ?? 'units'} you are handing in.`);
      return;
    }
    setBusy(true);
    setError(null);
    const hours = Math.max(0.01, elapsed / 3600);
    const end = new Date().toISOString();
    const start = periodStart.current ?? new Date(Date.now() - elapsed * 1000).toISOString();
    try {
      await api.submitTimesheet({
        taskId: id,
        periodStart: start,
        periodEnd: end,
        hours: perUnit && elapsed === 0 ? undefined : Number(hours.toFixed(2)),
        units: perUnit ? count : undefined,
        note: handInNote.trim() || undefined,
      });
      setSubmitted(true);
      setSentBack(null);
    } catch (e) {
      const msg = e instanceof ApiError || e instanceof Error ? e.message : 'Could not submit timesheet.';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function fileAudit() {
    if (!id) return;
    const n = Number(score);
    if (!Number.isInteger(n) || n < 0 || n > 100) {
      setError('Give the store a score from 0 to 100.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.submitAudit({ taskId: id, score: n, notes: notes.trim() || undefined });
      setFiled(res.outcome);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Could not file the audit.');
    } finally {
      setBusy(false);
    }
  }

  const isAudit = needsStage('AUDIT');
  const remote = t?.locationType === 'REMOTE';
  const pay = t
    ? payLabel(t.payModel, t.payModel === 'FIXED' ? t.budget : t.rate, t.budget, t.unitLabel)
    : null;
  // Hourly work is handed in from the clock. Fixed and per-unit work done
  // without clocking in (remote, mostly) is handed in when it is finished.
  const clockless = t ? t.payModel !== 'HOURLY' : false;
  const criteria = t?.acceptanceCriteria ?? [];

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 18, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        <AppBackHeader title="Active task" onBack={() => router.back()} />
        <OfflineNote savedAt={taskQ.savedAt} />
        <OutboxBanner filter={(i) => 'taskId' in i.action && i.action.taskId === id} />

        {error ? (
          <Banner tone="danger" icon="alert" title="Something went wrong" message={error} />
        ) : null}

        {taskQ.loading && !t ? (
          <AppLoadingCards count={1} />
        ) : t ? (
          <View style={styles.contextCard}>
            <Text style={styles.title}>{t.title}</Text>
            <View style={styles.tagRow}>
              <Text style={styles.tag}>{t.category}</Text>
            </View>

            <View style={styles.metaRow}>
              <Icon name="wallet" size={14} color={obColors.forest} />
              <Text style={styles.payText}>{pay}</Text>
            </View>

            <View style={styles.metaRow}>
              <Icon name={remote ? 'globe' : 'map-pin'} size={14} color={obColors.textMut} />
              <Text style={styles.metaText} numberOfLines={2}>
                {remote ? 'Remote' : (t.address ?? 'Physical')}
              </Text>
            </View>

            {(t.startDate || t.endDate) ? (
              <View style={styles.metaRow}>
                <Icon name="clock" size={14} color={obColors.textMut} />
                <Text style={styles.metaText}>
                  {t.startDate ? formatDate(t.startDate) : ''}
                  {t.startDate && t.endDate ? ' – ' : ''}
                  {t.endDate ? formatDate(t.endDate) : ''}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Timer */}
        <View style={styles.timerWrap}>
          <Text style={styles.timerLabel}>{clockedIn ? 'On the clock' : 'Elapsed today'}</Text>
          <Text style={styles.timer}>{formatElapsed(elapsed)}</Text>
          {clockedIn ? (
            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>Live</Text>
            </View>
          ) : null}
        </View>

        {/* Clock button */}
        <View style={styles.clock}>
          <ClockInButton
            clockedIn={clockedIn}
            geofence={geofence}
            busy={busy}
            onToggle={toggleClock}
          />
        </View>

        {/* A store audit is filed here: photos of the premises, then the score. */}
        {isAudit && id ? (
          filed ? (
            <View style={{ marginTop: 28 }}>
              <Banner
                tone="money"
                icon="check-circle"
                title="Audit filed"
                message={filed === 'PASS' ? 'The store passed.' : 'The store did not reach the pass mark.'}
              />
            </View>
          ) : (
            <View style={{ marginTop: 28 }}>
              <Text style={styles.sectionTitle}>File the audit</Text>
              <EvidencePanel taskId={id} stage="AUDIT" onReady={setAuditShown} />
              <Text style={styles.fieldLabel}>Score (0–100)</Text>
              <TextInput
                value={score}
                onChangeText={setScore}
                keyboardType="number-pad"
                placeholder="80"
                placeholderTextColor={obColors.textMut}
                style={styles.input}
                maxLength={3}
              />
              <Text style={styles.fieldLabel}>Notes</Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="Clean shelves, fridge not working"
                placeholderTextColor={obColors.textMut}
                style={[styles.input, styles.inputMulti]}
                multiline
              />
              <View style={{ marginTop: 14 }}>
                <AppPrimaryButton
                  label="File audit"
                  icon="check"
                  onPress={fileAudit}
                  disabled={!auditShown || score.trim() === '' || busy}
                />
              </View>
            </View>
          )
        ) : null}

        {/* Field and media work: a photo of the result before handing it in. */}
        {!submitted && id && needsStage('WORK') ? (
          <View style={{ marginTop: 28 }}>
            <EvidencePanel taskId={id} stage="WORK" onReady={setWorkShown} />
          </View>
        ) : null}

        {/* What the work is checked against, before anyone starts. */}
        {criteria.length > 0 && !submitted ? (
          <View style={[styles.contextCard, { marginTop: 24 }]}>
            <Text style={styles.sectionTitle}>How this is checked before you are paid</Text>
            {criteria.map((c) => (
              <View key={c} style={styles.metaRow}>
                <Icon name="check-circle" size={14} color={obColors.forest} />
                <Text style={styles.metaText}>{c}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {sentBack && !submitted ? (
          <View style={{ marginTop: 20 }}>
            <Banner tone="danger" icon="alert" title="Sent back: needs another look" message={sentBack} />
          </View>
        ) : null}

        {/* Timesheet submission */}
        {isAudit ? null : submitted ? (
          <View style={{ marginTop: 28 }}>
            <Banner
              tone="money"
              icon="check-circle"
              title="Timesheet submitted"
              message="Awaiting approval: check status in Profile › Timesheets."
            />
          </View>
        ) : (
          <View style={{ marginTop: 28, gap: 10 }}>
            {t?.payModel === 'PER_UNIT' ? (
              <>
                <Text style={styles.fieldLabel}>
                  How many {t.unitLabel ?? 'units'}?{t.maxUnits ? ` (up to ${t.maxUnits})` : ''}
                </Text>
                <TextInput
                  value={units}
                  onChangeText={(v) => setUnits(v.replace(/[^0-9]/g, ''))}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor={obColors.textMut}
                  style={styles.input}
                  maxLength={6}
                  accessibilityLabel={`Number of ${t.unitLabel ?? 'units'}`}
                />
              </>
            ) : null}
            <Text style={styles.fieldLabel}>Note for the reviewer (optional)</Text>
            <TextInput
              value={handInNote}
              onChangeText={setHandInNote}
              placeholder="Anything they should know"
              placeholderTextColor={obColors.textMut}
              style={[styles.input, styles.inputMulti]}
              multiline
              maxLength={1000}
            />
            <AppPrimaryButton
              label={sentBack ? 'Hand in again' : 'Hand in work'}
              icon="check"
              variant="outline"
              onPress={submitTimesheet}
              disabled={clockedIn || (!clockless && elapsed === 0) || busy || !workShown}
            />
            {clockedIn ? (
              <Text style={styles.hint}>Clock out before submitting your hours.</Text>
            ) : null}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: obColors.bg },
  contextCard: {
    backgroundColor: obColors.white,
    borderWidth: 1,
    borderColor: obColors.line,
    borderRadius: obRadii.card,
    borderTopRightRadius: obRadii.cardCut,
    padding: 16,
    gap: 8,
  },
  title: { fontSize: 16.5, fontFamily: 'Raleway_800ExtraBold', color: obColors.navy, lineHeight: 22 },
  tagRow: { flexDirection: 'row' },
  tag: {
    fontSize: 10.5,
    fontWeight: '700',
    color: obColors.navy,
    backgroundColor: obColors.sand,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: 'hidden',
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  payText: { color: obColors.forest, fontSize: 13, fontWeight: '800' },
  metaText: { flex: 1, color: obColors.textMut, fontSize: 12.5 },
  timerWrap: { alignItems: 'center', marginTop: 32, gap: 4 },
  timerLabel: { color: obColors.textMut, fontSize: 13, fontWeight: '600' },
  timer: {
    color: obColors.navy,
    fontSize: 56,
    fontFamily: 'Raleway_800ExtraBold',
    fontVariant: ['tabular-nums'],
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: obColors.mgreenBg,
    borderRadius: 99,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginTop: 4,
  },
  liveDot: { width: 7, height: 7, borderRadius: 99, backgroundColor: obColors.mgreen },
  liveText: { color: obColors.forest, fontSize: 12.5, fontWeight: '700' },
  clock: { alignItems: 'center', marginTop: 26 },
  hint: { color: obColors.textMut, fontSize: 12.5, textAlign: 'center' },
  sectionTitle: { fontSize: 15.5, fontFamily: 'Raleway_800ExtraBold', color: obColors.navy },
  fieldLabel: { fontSize: 12.5, fontWeight: '700', color: obColors.text, marginTop: 14, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: obColors.line,
    borderRadius: obRadii.field,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: obColors.text,
    backgroundColor: obColors.white,
  },
  inputMulti: { minHeight: 72, textAlignVertical: 'top' },
});
