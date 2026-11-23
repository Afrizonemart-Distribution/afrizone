/**
 * My HR (AZM HR Console), in the staff workspace: leave, payslips, documents
 * to sign, expense claims, policies to read, queries, reviews, training,
 * surveys, and, for managers, their team's leave and claims to approve.
 * Everything goes through /api/staff/hr/* to Afrizonemart; nothing is kept
 * on the phone.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Banner } from '../components/Feedback';
import { obColors } from '../onboarding/onboardingTheme';
import { staffCall, staffOpenFile } from '../lib/staff';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const msg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nice = (d?: string | null) => (d ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
const STATUS: Record<string, string> = {
  PENDING_MANAGER: 'With your manager',
  PENDING_HR: 'With HR',
  APPROVED: 'Approved',
  REJECTED: 'Declined',
  CANCELLED: 'Cancelled',
  PAID: 'Paid',
  SELF: 'Your part',
  MANAGER: 'With your manager',
  DONE: 'Done',
  ASSIGNED: 'To do',
};

type Section = 'home' | 'leave' | 'pay' | 'docs' | 'claims' | 'more' | 'team';

function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    staffCall<T>(path).then(setData).catch((e) => setError(msg(e, 'Could not load')));
  }, [path]);
  useEffect(load, [load]);
  return { data, error, reload: load };
}

export default function MyHr() {
  const home = useLoad<Any>('/hr');
  const [section, setSection] = useState<Section>('home');
  const d = home.data;
  const sections: { id: Section; label: string }[] = [
    { id: 'home', label: 'Summary' },
    { id: 'leave', label: 'Leave' },
    { id: 'pay', label: 'Payslips' },
    { id: 'docs', label: `Documents${d?.toSign ? ` · ${d.toSign}` : ''}` },
    { id: 'claims', label: 'Claims' },
    { id: 'more', label: 'Reviews & more' },
    ...(d?.managesPeople ? [{ id: 'team' as Section, label: 'My team' }] : []),
  ];
  if (home.error) return <Banner tone="danger" icon="alert" title="My HR isn't available" message={home.error} />;
  if (!d) return <Text style={s.muted}>Loading…</Text>;
  return (
    <View>
      <View style={s.chips}>
        {sections.map((x) => (
          <Pressable key={x.id} onPress={() => setSection(x.id)} style={[s.chip, section === x.id && s.chipOn]} accessibilityRole="button" accessibilityState={{ selected: section === x.id }}>
            <Text style={[s.chipText, section === x.id && s.chipTextOn]}>{x.label}</Text>
          </Pressable>
        ))}
      </View>
      {section === 'home' && <Summary d={d} go={setSection} reload={home.reload} />}
      {section === 'leave' && <Leave onChange={home.reload} />}
      {section === 'pay' && <Payslips />}
      {section === 'docs' && <Documents onChange={home.reload} />}
      {section === 'claims' && <Claims />}
      {section === 'more' && <More onChange={home.reload} />}
      {section === 'team' && <Team />}
    </View>
  );
}

function Summary({ d, go, reload }: { d: Any; go: (s: Section) => void; reload: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const todo = [
    d.toSign ? { t: `${d.toSign} document(s) to sign`, go: 'docs' as Section } : null,
    d.openQueries ? { t: `${d.openQueries} query(ies) to answer`, go: 'more' as Section } : null,
    d.trainingDue ? { t: `${d.trainingDue} training course(s) to do`, go: 'more' as Section } : null,
    d.surveysOpen ? { t: `${d.surveysOpen} short survey(s) waiting`, go: 'more' as Section } : null,
  ].filter(Boolean) as { t: string; go: Section }[];
  return (
    <View>
      <View style={s.card}>
        <Text style={s.title}>{d.jobTitle ?? 'AZM staff'}{d.staffType === 'INTERN' ? ' · Intern' : ''}</Text>
        <Text style={s.meta}>
          {[d.department, d.managerName && `reports to ${d.managerName}`, d.startDate && `since ${nice(d.startDate)}`].filter(Boolean).join(' · ')}
        </Text>
        {d.staffType === 'INTERN' && d.internshipEndsAt ? <Text style={s.meta}>Internship ends {nice(d.internshipEndsAt)}{d.supervisorName ? ` · supervisor ${d.supervisorName}` : ''}</Text> : null}
      </View>
      {d.policiesToRead.map((p: Any) => (
        <View key={p.id} style={[s.card, { borderColor: obColors.gold }]}>
          <Text style={s.title}>Please read: {p.title}</Text>
          <PolicyText id={p.id} />
          <Small
            label={busy === p.id ? 'Saving…' : 'I have read and understood this'}
            primary
            disabled={busy === p.id}
            onPress={async () => {
              setBusy(p.id);
              try {
                await staffCall(`/hr/policies/${p.id}/ack`, { method: 'POST', body: {} });
                reload();
              } finally {
                setBusy(null);
              }
            }}
          />
        </View>
      ))}
      {todo.length > 0 && (
        <View style={s.card}>
          <Text style={s.title}>To do</Text>
          {todo.map((x) => (
            <Pressable key={x.t} onPress={() => go(x.go)} style={{ paddingVertical: 8 }} accessibilityRole="button">
              <Text style={s.link}>{x.t} ›</Text>
            </Pressable>
          ))}
        </View>
      )}
      <Text style={s.h2}>Leave left this year</Text>
      <View style={s.grid}>
        {d.balances.map((b: Any) => (
          <View key={b.typeId} style={s.tile}>
            <Text style={s.meta}>{b.name}</Text>
            <Text style={s.big}>{b.limited ? b.available : '∞'}</Text>
            {b.pending ? <Text style={s.meta}>{b.pending} waiting</Text> : null}
          </View>
        ))}
      </View>
      {d.announcements.length > 0 && <Text style={s.h2}>From HR</Text>}
      {d.announcements.map((a: Any) => (
        <View key={a.id} style={s.card}>
          <Text style={s.title}>{a.pinned ? '📌 ' : ''}{a.title}</Text>
          <Text style={s.meta}>{nice(a.publishedAt)}</Text>
          <Text style={s.desc}>{a.body}</Text>
        </View>
      ))}
      <Personal d={d} />
    </View>
  );
}

function PolicyText({ id }: { id: string }) {
  const r = useLoad<Any[]>('/hr/policies');
  const p = r.data?.find((x) => x.id === id);
  if (!p) return null;
  return <Text style={[s.desc, { marginBottom: 10 }]}>{p.body}</Text>;
}

function Personal({ d }: { d: Any }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState({ phone: d.phone ?? '', address: d.personal.address ?? '', kin: d.personal.nextOfKin?.name ?? '', kinRel: d.personal.nextOfKin?.relationship ?? '', kinPhone: d.personal.nextOfKin?.phone ?? '', em: d.personal.emergency?.name ?? '', emPhone: d.personal.emergency?.phone ?? '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <View style={s.card}>
      <View style={s.head}>
        <Text style={s.title}>My details</Text>
        <Pressable onPress={() => setEdit((x) => !x)}><Text style={s.link}>{edit ? 'Close' : 'Update'}</Text></Pressable>
      </View>
      {!edit ? (
        <>
          <Text style={s.meta}>Phone: {d.phone ?? '—'}</Text>
          <Text style={s.meta}>Address: {d.personal.address ?? '—'}</Text>
          <Text style={s.meta}>Next of kin: {d.personal.nextOfKin?.name ?? '—'}</Text>
          <Text style={s.meta}>Emergency contact: {d.personal.emergency?.name ?? '—'}</Text>
          <Text style={s.meta}>Bank: {d.personal.bankName ?? '—'} {d.personal.accountNumber ?? ''}</Text>
          <Text style={[s.meta, { marginTop: 8 }]}>To change your bank, NIN or pension details, ask HR.</Text>
        </>
      ) : (
        <>
          {(
            [
              ['phone', 'Phone'],
              ['address', 'Home address'],
              ['kin', 'Next of kin: name'],
              ['kinRel', 'Next of kin: relationship'],
              ['kinPhone', 'Next of kin: phone'],
              ['em', 'Emergency contact: name'],
              ['emPhone', 'Emergency contact: phone'],
            ] as const
          ).map(([k, label]) => (
            <View key={k} style={{ marginTop: 8 }}>
              <Text style={s.meta}>{label}</Text>
              <TextInput style={s.input} value={v[k]} onChangeText={(t) => setV({ ...v, [k]: t })} />
            </View>
          ))}
          {error ? <Text style={s.err}>{error}</Text> : null}
          <Small
            label={busy ? 'Saving…' : 'Save'}
            primary
            disabled={busy}
            onPress={async () => {
              setBusy(true);
              setError(null);
              try {
                await staffCall('/hr/file', { method: 'PATCH', body: { phone: v.phone || null, address: v.address, nextOfKin: { name: v.kin, relationship: v.kinRel, phone: v.kinPhone }, emergency: { name: v.em, phone: v.emPhone } } });
                setEdit(false);
              } catch (e) {
                setError(msg(e, 'Could not save'));
              } finally {
                setBusy(false);
              }
            }}
          />
        </>
      )}
    </View>
  );
}

function Leave({ onChange }: { onChange: () => void }) {
  const r = useLoad<Any>('/hr/leave');
  const [typeId, setTypeId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = r.data;
  if (r.error) return <Banner tone="danger" icon="alert" title="Couldn't load" message={r.error} />;
  if (!d) return <Text style={s.muted}>Loading…</Text>;
  const types = d.balances as Any[];
  return (
    <View>
      <View style={s.card}>
        <Text style={s.title}>Ask for leave</Text>
        <View style={s.chips}>
          {types.map((t) => (
            <Pressable key={t.typeId} onPress={() => setTypeId(t.typeId)} style={[s.chip, typeId === t.typeId && s.chipOn]}>
              <Text style={[s.chipText, typeId === t.typeId && s.chipTextOn]}>{t.name}{t.limited ? ` (${t.available})` : ''}</Text>
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={s.meta}>From (YYYY-MM-DD)</Text>
            <TextInput style={s.input} value={from} onChangeText={setFrom} placeholder="2026-12-21" placeholderTextColor={obColors.textMut} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.meta}>To</Text>
            <TextInput style={s.input} value={to} onChangeText={setTo} placeholder="2026-12-24" placeholderTextColor={obColors.textMut} />
          </View>
        </View>
        <Text style={s.meta}>Reason (optional)</Text>
        <TextInput style={s.input} value={reason} onChangeText={setReason} />
        <Text style={s.meta}>Weekends and public holidays aren't counted. It goes to your manager, then HR.</Text>
        {error ? <Text style={s.err}>{error}</Text> : null}
        <Small
          label={busy ? 'Sending…' : 'Send request'}
          primary
          disabled={busy || !typeId || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to || from)}
          onPress={async () => {
            setBusy(true);
            setError(null);
            try {
              await staffCall('/hr/leave', { method: 'POST', body: { typeId, startDate: from, endDate: to || from, reason: reason || undefined } });
              setFrom('');
              setTo('');
              setReason('');
              r.reload();
              onChange();
            } catch (e) {
              setError(msg(e, 'Could not send'));
            } finally {
              setBusy(false);
            }
          }}
        />
      </View>
      {d.requests.map((l: Any) => (
        <View key={l.id} style={s.card}>
          <View style={s.head}>
            <Text style={s.title}>{l.type} · {l.days} day{l.days === 1 ? '' : 's'}</Text>
            <Text style={s.pill}>{STATUS[l.status] ?? l.status}</Text>
          </View>
          <Text style={s.meta}>{nice(l.startDate)} → {nice(l.endDate)}</Text>
          {l.managerNote || l.hrNote ? <Text style={s.desc}>{l.hrNote ?? l.managerNote}</Text> : null}
          {['PENDING_MANAGER', 'PENDING_HR'].includes(l.status) || (l.status === 'APPROVED' && l.startDate > new Date().toISOString().slice(0, 10)) ? (
            <Small label="Cancel" onPress={() => staffCall(`/hr/leave/${l.id}/cancel`, { method: 'POST', body: {} }).then(() => { r.reload(); onChange(); })} />
          ) : null}
        </View>
      ))}
    </View>
  );
}

function Payslips() {
  const r = useLoad<Any[]>('/hr/payslips');
  const [open, setOpen] = useState<string | null>(null);
  if (r.error) return <Banner tone="danger" icon="alert" title="Couldn't load" message={r.error} />;
  if (!r.data) return <Text style={s.muted}>Loading…</Text>;
  if (r.data.length === 0) return <View style={s.card}><Text style={s.muted}>No payslips yet. They appear once a month's payroll is approved.</Text></View>;
  return (
    <View>
      {r.data.map((p) => (
        <Pressable key={p.id} onPress={() => setOpen(open === p.id ? null : p.id)} style={s.card}>
          <View style={s.head}>
            <Text style={s.title}>{p.period}</Text>
            <Text style={s.title}>{naira(p.netKobo)}</Text>
          </View>
          <Text style={s.meta}>{p.paidAt ? `Paid ${nice(p.paidAt)} · ref ${p.transferRef}` : 'Approved, not paid yet'}</Text>
          {open === p.id && (
            <View style={{ marginTop: 10 }}>
              {[
                ['Basic', p.basicKobo],
                ['Housing', p.housingKobo],
                ['Transport', p.transportKobo],
                ['Other allowances', p.otherKobo],
                ['Gross', p.grossKobo],
                ['Pension', -p.pensionEeKobo],
                ['NHF', -p.nhfKobo],
                ['PAYE tax', -p.payeKobo],
                ...p.adjustments.map((a: Any) => [a.label, a.kobo]),
                ['Net pay', p.netKobo],
              ].map(([label, kobo]) => (
                <View key={label as string} style={s.line}>
                  <Text style={s.desc}>{label}</Text>
                  <Text style={[s.desc, { fontVariant: ['tabular-nums'] }]}>{naira(kobo as number)}</Text>
                </View>
              ))}
              <Text style={s.meta}>AZM also pays {naira(p.pensionErKobo)} into your pension this month.</Text>
            </View>
          )}
        </Pressable>
      ))}
    </View>
  );
}

function Documents({ onChange }: { onChange: () => void }) {
  const r = useLoad<Any[]>('/hr/documents');
  const [signing, setSigning] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (r.error) return <Banner tone="danger" icon="alert" title="Couldn't load" message={r.error} />;
  if (!r.data) return <Text style={s.muted}>Loading…</Text>;
  return (
    <View>
      {r.data.length === 0 && <View style={s.card}><Text style={s.muted}>No documents yet.</Text></View>}
      {r.data.map((doc) => (
        <View key={doc.id} style={s.card}>
          <View style={s.head}>
            <Text style={s.title}>{doc.title}</Text>
            {doc.requiresSignature ? <Text style={s.pill}>{doc.signedAt ? 'Signed' : 'To sign'}</Text> : null}
          </View>
          <Text style={s.meta}>{doc.kind.replace('_', ' ').toLowerCase()} · added {nice(doc.createdAt)}{doc.expiresAt ? ` · expires ${nice(doc.expiresAt)}` : ''}</Text>
          <Small label="Open" onPress={() => staffOpenFile(`/hr/documents/${doc.id}/file`, `${doc.title}.${doc.contentType.split('/')[1]?.replace('vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx') ?? 'pdf'}`).catch((e) => setError(msg(e, 'Could not open it')))} />
          {doc.requiresSignature && !doc.signedAt && (
            signing === doc.id ? (
              <View style={{ marginTop: 10 }}>
                <Text style={s.meta}>Open and read it first, then type your full name to sign.</Text>
                <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Your full name" placeholderTextColor={obColors.textMut} />
                {error ? <Text style={s.err}>{error}</Text> : null}
                <View style={s.actions}>
                  <Small label="Cancel" onPress={() => setSigning(null)} />
                  <Small
                    label="Sign"
                    primary
                    disabled={name.trim().length < 3}
                    onPress={async () => {
                      setError(null);
                      try {
                        await staffCall(`/hr/documents/${doc.id}/sign`, { method: 'POST', body: { name } });
                        setSigning(null);
                        r.reload();
                        onChange();
                      } catch (e) {
                        setError(msg(e, 'Could not sign'));
                      }
                    }}
                  />
                </View>
              </View>
            ) : (
              <Small label="Sign" primary onPress={() => { setSigning(doc.id); setName(''); }} />
            )
          )}
          {doc.signedAt ? <Text style={s.meta}>Signed by {doc.signedName} on {nice(doc.signedAt)}</Text> : null}
        </View>
      ))}
    </View>
  );
}

const CLAIM_KINDS = [
  ['TRANSPORT', 'Transport'],
  ['PER_DIEM', 'Per diem'],
  ['ACCOMMODATION', 'Accommodation'],
  ['WELFARE', 'Welfare'],
  ['RELOCATION', 'Relocation'],
  ['OTHER', 'Other'],
] as const;

function Claims() {
  const r = useLoad<Any[]>('/hr/claims');
  const [kind, setKind] = useState<string>('TRANSPORT');
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [receipts, setReceipts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addReceipt() {
    setError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') return setError('Photo library permission denied. Enable it in Settings.');
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.6, base64: true });
    if (res.canceled || !res.assets[0]?.base64) return;
    setBusy(true);
    try {
      const doc = await staffCall<Any>('/hr/documents', { method: 'POST', body: { kind: 'RECEIPT', title: `Receipt ${new Date().toISOString().slice(0, 10)}`, contentType: res.assets[0].mimeType ?? 'image/jpeg', dataBase64: res.assets[0].base64 } });
      setReceipts((x) => [...x, doc.id]);
    } catch (e) {
      setError(msg(e, 'Could not upload the receipt'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <View style={s.card}>
        <Text style={s.title}>New claim</Text>
        <View style={s.chips}>
          {CLAIM_KINDS.map(([k, l]) => (
            <Pressable key={k} onPress={() => setKind(k)} style={[s.chip, kind === k && s.chipOn]}>
              <Text style={[s.chipText, kind === k && s.chipTextOn]}>{l}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={s.meta}>What for</Text>
        <TextInput style={s.input} value={title} onChangeText={setTitle} placeholder="e.g. Transport to supplier visit, Kano" placeholderTextColor={obColors.textMut} />
        <Text style={s.meta}>Amount (₦)</Text>
        <TextInput style={s.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
        <View style={s.actions}>
          <Small label={busy ? 'Uploading…' : `Add receipt${receipts.length ? ` (${receipts.length})` : ''}`} onPress={addReceipt} disabled={busy} />
        </View>
        {error ? <Text style={s.err}>{error}</Text> : null}
        <Small
          label="Send claim"
          primary
          disabled={busy || title.trim().length < 3 || !(Number(amount) > 0)}
          onPress={async () => {
            setBusy(true);
            setError(null);
            try {
              await staffCall('/hr/claims', { method: 'POST', body: { kind, title, amountKobo: Math.round(Number(amount) * 100), receiptIds: receipts } });
              setTitle('');
              setAmount('');
              setReceipts([]);
              r.reload();
            } catch (e) {
              setError(msg(e, 'Could not send'));
            } finally {
              setBusy(false);
            }
          }}
        />
        <Text style={s.meta}>Paid by bank transfer once your manager and HR approve.</Text>
      </View>
      {r.data?.map((c) => (
        <View key={c.id} style={s.card}>
          <View style={s.head}>
            <Text style={s.title}>{c.title}</Text>
            <Text style={s.pill}>{STATUS[c.status] ?? c.status}</Text>
          </View>
          <Text style={s.meta}>{naira(c.amountKobo)} · {nice(c.createdAt)}{c.paidRef ? ` · ref ${c.paidRef}` : ''}</Text>
          {['PENDING_MANAGER', 'PENDING_HR'].includes(c.status) && <Small label="Withdraw" onPress={() => staffCall(`/hr/claims/${c.id}/cancel`, { method: 'POST', body: {} }).then(r.reload)} />}
        </View>
      ))}
    </View>
  );
}

function More({ onChange }: { onChange: () => void }) {
  const queries = useLoad<Any[]>('/hr/queries');
  const reviews = useLoad<Any[]>('/hr/reviews');
  const training = useLoad<Any[]>('/hr/training');
  const surveys = useLoad<Any[]>('/hr/surveys');
  const [reply, setReply] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<Record<string, Record<string, string | number>>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>, after: () => void) => {
    setError(null);
    try {
      await fn();
      after();
      onChange();
    } catch (e) {
      setError(msg(e, 'That didn’t work'));
    }
  };
  return (
    <View>
      {error ? <Banner tone="danger" icon="alert" title="Couldn't save" message={error} /> : null}
      <Text style={s.h2}>Queries</Text>
      {(queries.data ?? []).length === 0 && <Text style={s.muted}>None. Good.</Text>}
      {queries.data?.map((q) => (
        <View key={q.id} style={s.card}>
          <Text style={s.title}>{q.subject}</Text>
          <Text style={s.meta}>Issued {nice(q.createdAt)}{q.responseDueAt ? ` · respond by ${nice(q.responseDueAt)}` : ''}</Text>
          <Text style={s.desc}>{q.details}</Text>
          {q.response ? <Text style={[s.desc, { fontStyle: 'italic' }]}>Your response: {q.response}</Text> : !q.closedAt ? (
            <>
              <TextInput style={[s.input, { height: 90, textAlignVertical: 'top', paddingTop: 10 }]} multiline value={reply[q.id] ?? ''} onChangeText={(t) => setReply({ ...reply, [q.id]: t })} placeholder="Your response" placeholderTextColor={obColors.textMut} />
              <Small label="Send response" primary disabled={(reply[q.id] ?? '').trim().length < 10} onPress={() => act(() => staffCall(`/hr/queries/${q.id}/respond`, { method: 'POST', body: { response: reply[q.id] } }), queries.reload)} />
            </>
          ) : null}
          {q.closedAt ? <Text style={s.meta}>Outcome: {String(q.outcome).replace(/_/g, ' ').toLowerCase()}</Text> : null}
        </View>
      ))}

      <Text style={s.h2}>Performance reviews</Text>
      {(reviews.data ?? []).length === 0 && <Text style={s.muted}>No reviews open.</Text>}
      {reviews.data?.map((rv) => (
        <View key={rv.id} style={s.card}>
          <View style={s.head}>
            <Text style={s.title}>{rv.cycleName}</Text>
            <Text style={s.pill}>{STATUS[rv.status] ?? rv.status}</Text>
          </View>
          {rv.status === 'SELF' && rv.cycleOpen ? (
            <>
              <Text style={s.meta}>How did the period go? What went well, what was hard, what do you need?</Text>
              <TextInput style={[s.input, { height: 110, textAlignVertical: 'top', paddingTop: 10 }]} multiline value={notes[rv.id] ?? rv.selfNotes ?? ''} onChangeText={(t) => setNotes({ ...notes, [rv.id]: t })} />
              <Small label="Send to my manager" primary onPress={() => act(() => staffCall(`/hr/reviews/${rv.id}`, { method: 'PUT', body: { goals: rv.goals ?? [], selfNotes: notes[rv.id] ?? rv.selfNotes ?? '', submit: true } }), reviews.reload)} />
            </>
          ) : rv.status === 'DONE' ? (
            <Text style={s.meta}>Rating {rv.managerRating}/5{rv.managerNotes ? ` · ${rv.managerNotes}` : ''}</Text>
          ) : (
            <Text style={s.meta}>With {rv.reviewerName ?? 'your manager'}.</Text>
          )}
        </View>
      ))}

      <Text style={s.h2}>Training</Text>
      {(training.data ?? []).length === 0 && <Text style={s.muted}>Nothing assigned.</Text>}
      {training.data?.map((t) => (
        <View key={t.id} style={s.card}>
          <Text style={s.title}>{t.title}</Text>
          <Text style={s.meta}>{t.provider ?? ''}{t.dueAt ? ` · due ${nice(t.dueAt)}` : ''}{t.status === 'DONE' ? ` · done ${nice(t.completedAt)}` : ''}</Text>
          {t.status !== 'DONE' && <Small label="I've finished this" primary onPress={() => act(() => staffCall(`/hr/training/${t.id}/complete`, { method: 'POST', body: {} }), training.reload)} />}
        </View>
      ))}

      <Text style={s.h2}>Surveys</Text>
      <Text style={s.meta}>Anonymous: your name isn't stored with your answers.</Text>
      {surveys.data?.filter((x) => !x.answered).map((sv) => (
        <View key={sv.id} style={s.card}>
          <Text style={s.title}>{sv.title}</Text>
          {(sv.questions as Any[]).map((q) => (
            <View key={q.key} style={{ marginTop: 10 }}>
              <Text style={s.desc}>{q.text}</Text>
              {q.type === 'SCALE' ? (
                <View style={s.actions}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Small key={n} label={String(n)} primary={answers[sv.id]?.[q.key] === n} onPress={() => setAnswers({ ...answers, [sv.id]: { ...answers[sv.id], [q.key]: n } })} />
                  ))}
                </View>
              ) : (
                <TextInput style={s.input} value={String(answers[sv.id]?.[q.key] ?? '')} onChangeText={(t) => setAnswers({ ...answers, [sv.id]: { ...answers[sv.id], [q.key]: t } })} />
              )}
            </View>
          ))}
          <Small label="Send answers" primary onPress={() => act(() => staffCall(`/hr/surveys/${sv.id}`, { method: 'POST', body: { answers: answers[sv.id] ?? {} } }), surveys.reload)} />
        </View>
      ))}
    </View>
  );
}

function Team() {
  const r = useLoad<Any>('/hr/team');
  const [error, setError] = useState<string | null>(null);
  const decide = async (kind: 'leave' | 'claims', id: string, approve: boolean) => {
    setError(null);
    try {
      await staffCall(`/hr/team/${kind}/${id}/decide`, { method: 'POST', body: { approve } });
      r.reload();
    } catch (e) {
      setError(msg(e, 'That didn’t work'));
    }
  };
  if (r.error) return <Banner tone="danger" icon="alert" title="Couldn't load" message={r.error} />;
  if (!r.data) return <Text style={s.muted}>Loading…</Text>;
  const d = r.data;
  return (
    <View>
      {error ? <Text style={s.err}>{error}</Text> : null}
      <Text style={s.h2}>Leave to approve</Text>
      {d.leaveWaiting.length === 0 && <Text style={s.muted}>Nothing waiting.</Text>}
      {d.leaveWaiting.map((l: Any) => (
        <View key={l.id} style={s.card}>
          <Text style={s.title}>{l.name}: {l.type}</Text>
          <Text style={s.meta}>{nice(l.startDate)} → {nice(l.endDate)} · {l.days} day(s)</Text>
          {l.reason ? <Text style={s.desc}>{l.reason}</Text> : null}
          <View style={s.actions}>
            <Small label="Decline" onPress={() => decide('leave', l.id, false)} />
            <Small label="Approve" primary onPress={() => decide('leave', l.id, true)} />
          </View>
        </View>
      ))}
      <Text style={s.h2}>Claims to approve</Text>
      {d.claimsWaiting.length === 0 && <Text style={s.muted}>Nothing waiting.</Text>}
      {d.claimsWaiting.map((c: Any) => (
        <View key={c.id} style={s.card}>
          <Text style={s.title}>{c.name}: {c.title}</Text>
          <Text style={s.meta}>{naira(c.amountKobo)} · {c.receiptIds.length} receipt(s)</Text>
          <View style={s.actions}>
            <Small label="Decline" onPress={() => decide('claims', c.id, false)} />
            <Small label="Approve" primary onPress={() => decide('claims', c.id, true)} />
          </View>
        </View>
      ))}
      <Text style={s.h2}>Off in the next 30 days</Text>
      {d.upcomingLeave.length === 0 && <Text style={s.muted}>Nobody.</Text>}
      {d.upcomingLeave.map((l: Any) => (
        <Text key={l.id} style={s.meta}>{l.name}: {nice(l.startDate)} → {nice(l.endDate)}</Text>
      ))}
      {d.reviews.length > 0 && <Text style={s.h2}>Reviews to finish</Text>}
      {d.reviews.map((rv: Any) => <ManagerReview key={rv.id} rv={rv} onDone={r.reload} />)}
    </View>
  );
}

function ManagerReview({ rv, onDone }: { rv: Any; onDone: () => void }) {
  const [notes, setNotes] = useState(rv.managerNotes ?? '');
  const [rating, setRating] = useState<number>(rv.managerRating ?? 3);
  const [error, setError] = useState<string | null>(null);
  const waitingSelf = rv.status === 'SELF';
  return (
    <View style={s.card}>
      <Text style={s.title}>{rv.name} · {rv.cycleName}</Text>
      {waitingSelf ? <Text style={s.meta}>Their self review isn't in yet. You can still write yours.</Text> : null}
      {rv.selfNotes ? <Text style={s.desc}>They wrote: {rv.selfNotes}</Text> : null}
      <Text style={s.meta}>Your notes</Text>
      <TextInput style={[s.input, { height: 100, textAlignVertical: 'top', paddingTop: 10 }]} multiline value={notes} onChangeText={setNotes} />
      <Text style={s.meta}>Overall rating (1 below expectations – 5 outstanding)</Text>
      <View style={s.actions}>
        {[1, 2, 3, 4, 5].map((n) => <Small key={n} label={String(n)} primary={rating === n} onPress={() => setRating(n)} />)}
      </View>
      {error ? <Text style={s.err}>{error}</Text> : null}
      <Small
        label="Finish review"
        primary
        disabled={notes.trim().length < 3}
        onPress={async () => {
          setError(null);
          try {
            await staffCall(`/hr/team/reviews/${rv.id}`, { method: 'PUT', body: { goals: rv.goals ?? [], managerNotes: notes, managerRating: rating, submit: true } });
            onDone();
          } catch (e) {
            setError(msg(e, 'Could not save'));
          }
        }}
      />
    </View>
  );
}

function Small({ label, onPress, primary, disabled }: { label: string; onPress?: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" style={[s.small, primary && s.smallOn, disabled && { opacity: 0.5 }]}>
      <Text style={[s.smallText, primary && s.smallTextOn]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: { paddingHorizontal: 12, height: 34, justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: obColors.line, backgroundColor: obColors.white },
  chipOn: { backgroundColor: obColors.navy, borderColor: obColors.navy },
  chipText: { color: obColors.textMut, fontWeight: '700', fontSize: 13 },
  chipTextOn: { color: obColors.white },
  card: { backgroundColor: obColors.white, borderRadius: 20, borderWidth: 1, borderColor: obColors.line, padding: 16, marginBottom: 12 },
  head: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' },
  title: { color: obColors.navy, fontSize: 15.5, fontWeight: '700', flexShrink: 1 },
  h2: { color: obColors.navy, fontSize: 17, fontWeight: '800', marginTop: 8, marginBottom: 10 },
  meta: { color: obColors.textMut, fontSize: 12.5, marginTop: 4 },
  desc: { color: obColors.text, fontSize: 14, marginTop: 6 },
  muted: { color: obColors.textMut, fontSize: 14, marginBottom: 10 },
  err: { color: obColors.dangerInk, fontSize: 13, marginTop: 8 },
  link: { color: obColors.goldDeep, fontWeight: '700', fontSize: 14 },
  pill: { fontSize: 11.5, fontWeight: '800', color: obColors.amberInk, backgroundColor: obColors.orangeInkBg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, overflow: 'hidden' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  tile: { width: '47%', backgroundColor: obColors.white, borderRadius: 16, borderWidth: 1, borderColor: obColors.line, padding: 12 },
  big: { fontSize: 26, fontWeight: '800', color: obColors.navy, fontVariant: ['tabular-nums'] },
  line: { flexDirection: 'row', justifyContent: 'space-between' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  small: { paddingHorizontal: 14, height: 38, justifyContent: 'center', alignSelf: 'flex-start', borderRadius: 12, borderWidth: 1, borderColor: obColors.line, backgroundColor: obColors.white, marginTop: 10 },
  smallOn: { backgroundColor: obColors.gold, borderColor: obColors.gold },
  smallText: { color: obColors.text, fontWeight: '700', fontSize: 14 },
  smallTextOn: { color: obColors.navy },
  input: { borderWidth: 1, borderColor: obColors.line, borderRadius: 12, height: 46, paddingHorizontal: 12, fontSize: 15, color: obColors.text, backgroundColor: obColors.white, marginTop: 4 },
});
