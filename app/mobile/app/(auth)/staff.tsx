import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Banner } from '../../src/components/Feedback';
import { ObButton, ObField, ObPasswordField, ObScreen } from '../../src/onboarding/ObUI';
import { obColors } from '../../src/onboarding/onboardingTheme';
import { afrizoneIdentityToken, afrizoneLogin, afrizoneMfa } from '../../src/lib/afrizone';
import {
  clearStaffSession,
  hasStaffSession,
  staffApi,
  startStaffSession,
  type Scorecard,
  type StaffMe,
  type StaffTask,
  type TeamRow,
} from '../../src/lib/staff';

/**
 * AfriZone staff workspace: tasks from the Storefront, Ink and Supplier Ops
 * admins, the review queue for managers, offsite work and KPI. Lives in the
 * (auth) group because staff have no Part Time account; the root guard lets
 * this one screen through either way.
 */

const PRODUCT: Record<string, string> = { STOREFRONT: 'Storefront', INK: 'Ink', SUPPLIER_OPS: 'Supplier Ops' };
const STATUS: Record<string, string> = {
  OPEN: 'To do',
  IN_PROGRESS: 'In progress',
  SUBMITTED: 'Waiting for review',
  REWORK: 'Sent back',
  DONE: 'Done',
  CANCELLED: 'Cancelled',
};
const PILLAR: Record<string, string> = {
  delivery: 'On-time delivery',
  output: 'Output',
  quality: 'Quality',
  presence: 'Presence',
};

const msg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export default function StaffScreen() {
  const [me, setMe] = useState<StaffMe | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    (async () => {
      if (await hasStaffSession()) {
        try {
          setMe(await staffApi.me());
        } catch {
          await clearStaffSession();
        }
      }
      setChecking(false);
    })();
  }, []);

  if (checking) return <View style={styles.root} />;
  if (!me) return <StaffSignIn onSignedIn={setMe} />;
  return (
    <Workspace
      me={me}
      onSignOut={async () => {
        await clearStaffSession();
        setMe(null);
      }}
    />
  );
}

function StaffSignIn({ onSignedIn }: { onSignedIn: (me: StaffMe) => void }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSubmit = mfaToken ? code.trim().length >= 6 : /^\S+@\S+\.\S+$/.test(email.trim()) && password.length > 0;

  async function finish(accessToken: string) {
    onSignedIn(await startStaffSession(await afrizoneIdentityToken(accessToken)));
  }

  async function submit() {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mfaToken) {
        await finish(await afrizoneMfa(mfaToken, code));
        return;
      }
      const res = await afrizoneLogin(email, password);
      if (res.kind === 'mfa') {
        setMfaToken(res.mfaToken);
        setPassword('');
      } else {
        await finish(res.accessToken);
      }
    } catch (e) {
      setError(msg(e, 'Could not sign you in.'));
      if (mfaToken) setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ObScreen
      onBack={() => (mfaToken ? setMfaToken(null) : router.back())}
      eyebrow="AfriZone staff"
      title={mfaToken ? 'Enter your code' : 'Your work, in one place'}
      subtitle={
        mfaToken
          ? 'Enter the 6-digit code from your authenticator app.'
          : 'Sign in with your AfriZone staff account to see your tasks and KPI.'
      }
      primaryLabel={mfaToken ? 'Verify' : 'Sign in'}
      onPrimary={submit}
      primaryDisabled={!canSubmit || busy}
      primaryLoading={busy}
    >
      {error ? <Banner tone="danger" icon="alert" title="Couldn't sign in" message={error} /> : null}
      {mfaToken ? (
        <ObField
          label="Code"
          value={code}
          onChangeText={(t) => setCode(t.replace(/\s/g, '').slice(0, 20))}
          autoCapitalize="none"
          autoComplete="one-time-code"
          placeholder="123456"
          autoFocus
          onSubmitEditing={submit}
        />
      ) : (
        <>
          <ObField
            label="AfriZone email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />
          <ObPasswordField label="AfriZone password" value={password} onChangeText={setPassword} onSubmitEditing={submit} />
        </>
      )}
    </ObScreen>
  );
}

type Tab = 'tasks' | 'review' | 'kpi' | 'team';

function Workspace({ me, onSignOut }: { me: StaffMe; onSignOut: () => void }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('tasks');
  const reviews = me.manages > 0 || me.monitor;
  const tabs: { id: Tab; label: string }[] = [
    { id: 'tasks', label: 'My tasks' },
    ...(reviews ? [{ id: 'review' as Tab, label: 'To review' }] : []),
    { id: 'kpi', label: 'My KPI' },
    ...(reviews ? [{ id: 'team' as Tab, label: me.monitor ? 'Everyone' : 'Team' }] : []),
  ];

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: 20, paddingTop: insets.top + 16, paddingBottom: 60 }}>
      <View style={styles.headRow}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.link}>Back</Text>
        </Pressable>
        <Pressable onPress={onSignOut} hitSlop={10}>
          <Text style={styles.link}>Sign out</Text>
        </Pressable>
      </View>
      <Text style={styles.eyebrow}>AfriZone staff</Text>
      <Text style={styles.h1}>Hello, {(me.name ?? '').split(' ')[0] || 'there'}</Text>
      <View style={styles.tabs}>
        {tabs.map((t) => (
          <Pressable
            key={t.id}
            onPress={() => setTab(t.id)}
            style={[styles.tab, tab === t.id && styles.tabOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: tab === t.id }}
          >
            <Text style={[styles.tabText, tab === t.id && styles.tabTextOn]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      {tab === 'tasks' && <Tasks scope="mine" />}
      {tab === 'review' && <Tasks scope="review" />}
      {tab === 'kpi' && <MyKpi />}
      {tab === 'team' && <Team monitor={me.monitor} />}
    </ScrollView>
  );
}

function Tasks({ scope }: { scope: 'mine' | 'review' }) {
  const [items, setItems] = useState<StaffTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offsite, setOffsite] = useState(false);

  const load = useCallback(() => {
    setError(null);
    staffApi
      .tasks(scope)
      .then((r) => setItems(r.items))
      .catch((e) => setError(msg(e, 'Could not load tasks')));
  }, [scope]);

  useEffect(() => {
    setItems(null);
    load();
  }, [load]);

  return (
    <View>
      {scope === 'mine' && (
        <View style={{ marginBottom: 12 }}>
          <ObButton variant="outline" label={offsite ? 'Close' : 'Log offsite work'} onPress={() => setOffsite((v) => !v)} />
        </View>
      )}
      {offsite && (
        <OffsiteForm
          onDone={() => {
            setOffsite(false);
            load();
          }}
        />
      )}
      {error ? <Banner tone="danger" icon="alert" title="Couldn't load" message={error} /> : null}
      {!items ? (
        <Text style={styles.muted}>Loading…</Text>
      ) : items.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.muted}>{scope === 'review' ? 'Nothing waiting for your review.' : 'No tasks right now.'}</Text>
        </View>
      ) : (
        items.map((t) => <TaskCard key={t.id} task={t} review={scope === 'review'} onChanged={load} />)
      )}
    </View>
  );
}

function TaskCard({ task, review, onChanged }: { task: StaffTask; review: boolean; onChanged: () => void }) {
  const [mode, setMode] = useState<'none' | 'submit' | 'approve' | 'rework'>('none');
  const [note, setNote] = useState('');
  const [score, setScore] = useState(4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = task.permissions;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setMode('none');
      setNote('');
      onChanged();
    } catch (e) {
      setError(msg(e, 'That didn’t work'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.taskHead}>
        <Text style={styles.title}>{task.title}</Text>
        <Text style={[styles.pill, task.overdue && styles.pillLate]}>
          {task.overdue ? 'Overdue' : STATUS[task.status] ?? task.status}
        </Text>
      </View>
      <Text style={styles.meta}>
        {PRODUCT[task.product] ?? task.product}
        {task.kind === 'OFFSITE' ? ' · Offsite' : ''}
        {review ? ` · ${task.assignee.name ?? task.assignee.email}` : ''}
        {task.dueAt ? ` · due ${new Date(task.dueAt).toLocaleDateString()}` : ''}
      </Text>
      {task.description ? <Text style={styles.desc}>{task.description}</Text> : null}
      {task.completion === 'AUTO' && task.autoTarget ? (
        <Text style={styles.meta}>
          Finishes itself: {task.autoProgress ?? 0} of {task.autoTarget}
        </Text>
      ) : null}
      {error ? <Text style={styles.err}>{error}</Text> : null}

      {mode === 'none' ? (
        <View style={styles.actions}>
          {p.canStart && <Small label="Start" onPress={() => run(() => staffApi.start(task.id))} disabled={busy} />}
          {p.canSubmit && task.completion !== 'AUTO' && <Small label="Mark done" primary onPress={() => setMode('submit')} />}
          {p.canApprove && <Small label="Approve" primary onPress={() => setMode('approve')} />}
          {p.canRework && <Small label="Send back" onPress={() => setMode('rework')} />}
        </View>
      ) : (
        <View style={{ marginTop: 12 }}>
          {mode === 'approve' ? (
            <>
              <Text style={styles.meta}>How good was the work? (1 poor – 5 excellent)</Text>
              <View style={styles.actions}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Small key={n} label={String(n)} primary={score === n} onPress={() => setScore(n)} />
                ))}
              </View>
            </>
          ) : (
            <TextInput
              style={styles.input}
              value={note}
              onChangeText={setNote}
              maxLength={2000}
              placeholder={mode === 'rework' ? 'What needs fixing?' : 'Note for your manager (optional)'}
              placeholderTextColor={obColors.textMut}
            />
          )}
          <View style={styles.actions}>
            <Small label="Cancel" onPress={() => setMode('none')} disabled={busy} />
            <Small
              label={busy ? 'Saving…' : mode === 'submit' ? 'Submit' : mode === 'approve' ? 'Approve' : 'Send back'}
              primary
              disabled={busy || (mode === 'rework' && note.trim().length < 3)}
              onPress={() =>
                run(() =>
                  mode === 'submit'
                    ? staffApi.submit(task.id, note.trim() || undefined)
                    : mode === 'approve'
                      ? staffApi.approve(task.id, score)
                      : staffApi.rework(task.id, note.trim()),
                )
              }
            />
          </View>
        </View>
      )}
    </View>
  );
}

function OffsiteForm({ onDone }: { onDone: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [date, setDate] = useState(today);
  const [from, setFrom] = useState('09:00');
  const [to, setTo] = useState('17:00');
  const [product, setProduct] = useState('STOREFRONT');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timeOk = (t: string) => /^\d{2}:\d{2}$/.test(t);
  const valid =
    title.trim().length >= 3 && location.trim().length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(date) && timeOk(from) && timeOk(to) && from < to;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      // Lagos is UTC+1 all year.
      await staffApi.logOffsite({
        product,
        title: title.trim(),
        location: location.trim(),
        startAt: `${date}T${from}:00+01:00`,
        endAt: `${date}T${to}:00+01:00`,
      });
      onDone();
    } catch (e) {
      setError(msg(e, 'Could not log it'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.meta}>Work away from your desk. Your manager approves it, then the hours count.</Text>
      {error ? <Text style={styles.err}>{error}</Text> : null}
      <ObField label="What was it?" value={title} onChangeText={setTitle} placeholder="Supplier visit, Ikeja" />
      <ObField label="Where" value={location} onChangeText={setLocation} />
      <View style={styles.actions}>
        {Object.entries(PRODUCT).map(([v, l]) => (
          <Small key={v} label={l} primary={product === v} onPress={() => setProduct(v)} />
        ))}
      </View>
      <ObField label="Day (YYYY-MM-DD)" value={date} onChangeText={setDate} />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <ObField label="From" value={from} onChangeText={setFrom} placeholder="09:00" />
        </View>
        <View style={{ flex: 1 }}>
          <ObField label="To" value={to} onChangeText={setTo} placeholder="17:00" />
        </View>
      </View>
      <ObButton label="Log offsite work" onPress={submit} disabled={!valid || busy} loading={busy} />
    </View>
  );
}

function PeriodSwitch({ period, setPeriod }: { period: 'week' | 'month'; setPeriod: (p: 'week' | 'month') => void }) {
  return (
    <View style={[styles.actions, { marginTop: 0, marginBottom: 12 }]}>
      {(['week', 'month'] as const).map((p) => (
        <Small key={p} label={`This ${p}`} primary={period === p} onPress={() => setPeriod(p)} />
      ))}
    </View>
  );
}

const fmt = (n: number | null) => (n == null ? '—' : String(Math.round(n)));
const toneStyle = (n: number | null) => (n == null ? null : n >= 75 ? styles.good : n >= 50 ? styles.mid : styles.low);

function MyKpi() {
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [card, setCard] = useState<Scorecard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCard(null);
    setError(null);
    staffApi
      .myKpi(period)
      .then(setCard)
      .catch((e) => setError(msg(e, 'Could not load your KPI')));
  }, [period]);

  return (
    <View>
      <PeriodSwitch period={period} setPeriod={setPeriod} />
      {error ? <Banner tone="danger" icon="alert" title="Couldn't load" message={error} /> : null}
      {card && (
        <>
          <View style={[styles.card, { flexDirection: 'row', alignItems: 'center', gap: 16 }]}>
            <Text style={[styles.big, toneStyle(card.score)]}>{fmt(card.score)}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{card.kind === 'INTERN' ? 'Approval rate' : 'KPI score'}</Text>
              <Text style={styles.meta}>{card.score == null ? `Not enough to score yet this ${period}` : `out of 100, this ${period}`}</Text>
            </View>
          </View>
          {card.flags.map((f) => (
            <Text key={f} style={styles.flag}>
              {f}
            </Text>
          ))}
          {card.staff &&
            Object.entries(card.staff.pillars).map(([k, p]) => (
              <View key={k} style={[styles.card, styles.row]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>{PILLAR[k] ?? k}</Text>
                  <Text style={styles.meta}>{p.weight > 0 ? `${p.weight}% of the score` : 'Not counted yet'}</Text>
                </View>
                <Text style={[styles.midNum, toneStyle(p.score)]}>{fmt(p.score)}</Text>
              </View>
            ))}
          {card.intern && (
            <View style={styles.card}>
              <Text style={styles.title}>
                {card.intern.deliverables.approved} approved · {card.intern.deliverables.submitted} submitted ·{' '}
                {card.intern.deliverables.rejected} sent back
              </Text>
              <Text style={styles.meta}>
                {card.intern.deliverables.trend >= 0 ? '+' : ''}
                {card.intern.deliverables.trend} approved on last {period}
              </Text>
            </View>
          )}
        </>
      )}
    </View>
  );
}

function Team({ monitor }: { monitor: boolean }) {
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [rows, setRows] = useState<TeamRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    setError(null);
    staffApi
      .teamKpi(period, monitor ? 'all' : 'team')
      .then((r) => setRows(r.items))
      .catch((e) => setError(msg(e, 'Could not load the team')));
  }, [period, monitor]);

  return (
    <View>
      <PeriodSwitch period={period} setPeriod={setPeriod} />
      {error ? <Banner tone="danger" icon="alert" title="Couldn't load" message={error} /> : null}
      {rows?.length === 0 && (
        <View style={styles.card}>
          <Text style={styles.muted}>Nobody reports to you yet.</Text>
        </View>
      )}
      {rows?.map((r) => (
        <View key={r.person.id} style={[styles.card, styles.row]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{r.person.name ?? r.person.email}</Text>
            <Text style={styles.meta}>
              {r.person.jobTitle ?? (r.kind === 'INTERN' ? 'Intern' : 'Staff')}
              {r.overdueOpen > 0 ? ` · ${r.overdueOpen} overdue` : ''}
              {r.flags.length ? ` · ${r.flags.join(' · ')}` : ''}
            </Text>
          </View>
          <Text style={[styles.midNum, toneStyle(r.score)]}>{fmt(r.score)}</Text>
        </View>
      ))}
    </View>
  );
}

function Small({ label, onPress, primary, disabled }: { label: string; onPress?: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={[styles.small, primary && styles.smallOn, disabled && { opacity: 0.5 }]}
    >
      <Text style={[styles.smallText, primary && styles.smallTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: obColors.bg },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  link: { color: obColors.goldDeep, fontWeight: '700', fontSize: 14 },
  eyebrow: { color: obColors.amberInk, fontSize: 11, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' },
  h1: { color: obColors.navy, fontSize: 26, fontWeight: '800', marginTop: 6, marginBottom: 14 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  tab: { paddingHorizontal: 14, height: 38, justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: obColors.line, backgroundColor: obColors.white },
  tabOn: { backgroundColor: obColors.navy, borderColor: obColors.navy },
  tabText: { color: obColors.textMut, fontWeight: '700', fontSize: 14 },
  tabTextOn: { color: obColors.white },
  card: { backgroundColor: obColors.white, borderRadius: 20, borderWidth: 1, borderColor: obColors.line, padding: 16, marginBottom: 12 },
  taskHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' },
  title: { color: obColors.navy, fontSize: 15.5, fontWeight: '700', flexShrink: 1 },
  meta: { color: obColors.textMut, fontSize: 12.5, marginTop: 4 },
  desc: { color: obColors.text, fontSize: 14, marginTop: 8 },
  muted: { color: obColors.textMut, fontSize: 14 },
  err: { color: obColors.dangerInk, fontSize: 13, marginTop: 8 },
  pill: { fontSize: 11.5, fontWeight: '800', color: obColors.amberInk, backgroundColor: obColors.orangeInkBg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, overflow: 'hidden' },
  pillLate: { color: '#A6362C', backgroundColor: '#FDEDEC' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  small: { paddingHorizontal: 14, height: 38, justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: obColors.line, backgroundColor: obColors.white },
  smallOn: { backgroundColor: obColors.gold, borderColor: obColors.gold },
  smallText: { color: obColors.text, fontWeight: '700', fontSize: 14 },
  smallTextOn: { color: obColors.navy },
  input: { borderWidth: 1, borderColor: obColors.line, borderRadius: 12, height: 46, paddingHorizontal: 12, fontSize: 15, color: obColors.text, backgroundColor: obColors.white },
  big: { fontSize: 44, fontWeight: '800', color: obColors.navy, fontVariant: ['tabular-nums'] },
  midNum: { fontSize: 26, fontWeight: '800', color: obColors.navy, fontVariant: ['tabular-nums'] },
  good: { color: '#1A6B2E' },
  mid: { color: obColors.amberInk },
  low: { color: '#A6362C' },
  flag: { color: '#A6362C', fontWeight: '700', fontSize: 14, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
