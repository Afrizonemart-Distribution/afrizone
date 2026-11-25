'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * My HR: every AZM staff member's own HR, inside the admin they already use.
 *
 * SHARED DESIGN. This folder (MyHr.tsx + my-hr.css) is copied unchanged into
 * every staff admin: storefront (afrizonemart-v2), Ink (azm-publishing), HUD
 * (afrizonemart-hud) and the supplier portal. Keep them in step: change it
 * here, copy it to the others. The only per-product code is the small
 * adapter that passes `client` (calls /api/hr/me with that admin's session).
 *
 * Talks to /api/hr/me/* on the Afrizonemart API (afrizonemart-api
 * modules/hr/me.ts): leave, payslips, documents to sign, expense claims,
 * queries, reviews, policies, training, surveys, and for managers their
 * team's approvals. HR heads run the other side at hr.afrizonemart.com.
 *
 * Layout follows two 21st.dev patterns, rebuilt in plain CSS with the AZM
 * brand: Financial Dashboard (quick actions, balance tiles, activity list)
 * and the CRM hub's segmented section filter.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import './my-hr.css';

type Any = any;

export interface MyHrClient {
  /** Call /api/hr/me{path} as the signed-in staff member. Throws an Error with a readable message. */
  call<T>(path: string, init?: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH'; body?: unknown }): Promise<T>;
  /** Fetch a file under /api/hr/me{path} (documents) as a Blob. */
  file(path: string): Promise<Blob>;
}

const msg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nice = (d?: string | null) =>
  d ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
const today = () => new Date().toISOString().slice(0, 10);

const STATUS: Record<string, { label: string; tone: 'wait' | 'ok' | 'no' | 'info' }> = {
  PENDING_MANAGER: { label: 'With your manager', tone: 'wait' },
  PENDING_HR: { label: 'With HR', tone: 'wait' },
  APPROVED: { label: 'Approved', tone: 'ok' },
  REJECTED: { label: 'Declined', tone: 'no' },
  CANCELLED: { label: 'Cancelled', tone: 'info' },
  PAID: { label: 'Paid', tone: 'ok' },
  SELF: { label: 'Your part', tone: 'wait' },
  MANAGER: { label: 'With your manager', tone: 'wait' },
  DONE: { label: 'Done', tone: 'ok' },
  ASSIGNED: { label: 'To do', tone: 'wait' },
};

type Section = 'home' | 'leave' | 'pay' | 'docs' | 'claims' | 'more' | 'team';

function useLoad<T>(client: MyHrClient, path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    client.call<T>(path).then(
      (d) => {
        if (!live) return;
        setData(d);
        setError(null);
      },
      (e) => {
        if (live) setError(msg(e, 'Could not load this'));
      },
    );
    return () => {
      live = false;
    };
  }, [client, path, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, reload };
}

export default function MyHr({ client }: { client: MyHrClient }) {
  const home = useLoad<Any>(client, '');
  const [section, setSection] = useState<Section>('home');
  const d = home.data;

  if (home.error)
    return (
      <div className="myhr">
        <Note tone="no" title="My HR isn't available right now">
          {home.error}
        </Note>
      </div>
    );
  if (!d)
    return (
      <div className="myhr">
        <p className="myhr-muted">Loading your HR…</p>
      </div>
    );

  const sections: { id: Section; label: string; count?: number }[] = [
    { id: 'home', label: 'Summary' },
    { id: 'leave', label: 'Leave' },
    { id: 'pay', label: 'Payslips' },
    { id: 'docs', label: 'Documents', count: d.toSign },
    { id: 'claims', label: 'Claims' },
    { id: 'more', label: 'Reviews & more', count: (d.openQueries ?? 0) + (d.trainingDue ?? 0) + (d.surveysOpen ?? 0) },
    ...(d.managesPeople ? [{ id: 'team' as Section, label: 'My team' }] : []),
  ];

  return (
    <div className="myhr">
      <header className="myhr-hero">
        <div>
          <p className="myhr-eyebrow">My HR</p>
          <h1>Hello{d.name ? `, ${String(d.name).split(' ')[0]}` : ''}</h1>
          <p className="myhr-sub">
            {[d.jobTitle, d.department, d.managerName && `reports to ${d.managerName}`, d.startDate && `since ${nice(d.startDate)}`].filter(Boolean).join(' · ') ||
              'Your leave, pay, documents and claims in one place.'}
          </p>
        </div>
        {d.employeeNo ? <span className="myhr-badge">Staff no. {d.employeeNo}</span> : null}
      </header>

      <nav className="myhr-tabs" aria-label="My HR sections">
        {sections.map((x) => (
          <button key={x.id} type="button" className={section === x.id ? 'on' : ''} aria-current={section === x.id ? 'page' : undefined} onClick={() => setSection(x.id)}>
            {x.label}
            {x.count ? <span className="myhr-count">{x.count}</span> : null}
          </button>
        ))}
      </nav>

      {section === 'home' && <Summary client={client} d={d} go={setSection} reload={home.reload} />}
      {section === 'leave' && <Leave client={client} onChange={home.reload} />}
      {section === 'pay' && <Payslips client={client} />}
      {section === 'docs' && <Documents client={client} onChange={home.reload} />}
      {section === 'claims' && <Claims client={client} />}
      {section === 'more' && <More client={client} onChange={home.reload} />}
      {section === 'team' && <Team client={client} />}
    </div>
  );
}

/* ── pieces ─────────────────────────────────────────────────────────────── */

function Card({ title, aside, children, accent }: { title?: ReactNode; aside?: ReactNode; children?: ReactNode; accent?: boolean }) {
  return (
    <section className={`myhr-card${accent ? ' accent' : ''}`}>
      {(title || aside) && (
        <div className="myhr-card-head">
          {title ? <h3>{title}</h3> : <span />}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

function Pill({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, tone: 'info' as const };
  return <span className={`myhr-pill ${s.tone}`}>{s.label}</span>;
}

function Btn({ children, onClick, primary, disabled, busy, type = 'button' }: { children: ReactNode; onClick?: () => void; primary?: boolean; disabled?: boolean; busy?: boolean; type?: 'button' | 'submit' }) {
  return (
    <button type={type} className={`myhr-btn${primary ? ' primary' : ''}`} onClick={onClick} disabled={disabled || busy} aria-busy={busy || undefined}>
      {busy ? 'Please wait…' : children}
    </button>
  );
}

function Note({ tone, title, children }: { tone: 'no' | 'ok' | 'info'; title?: string; children?: ReactNode }) {
  return (
    <div className={`myhr-note ${tone}`} role={tone === 'no' ? 'alert' : 'status'}>
      {title ? <b>{title}</b> : null}
      {children ? <span>{children}</span> : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="myhr-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="myhr-empty">{children}</p>;
}

function Loading({ error }: { error: string | null }) {
  return error ? <Note tone="no" title="Couldn't load">{error}</Note> : <p className="myhr-muted">Loading…</p>;
}

/** Run an action with busy + error state. */
function useAct() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act = async (key: string, fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      after?.();
    } catch (e) {
      setError(msg(e, "That didn't work. Try again."));
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, act, setError };
}

/* ── Summary ────────────────────────────────────────────────────────────── */

function Summary({ client, d, go, reload }: { client: MyHrClient; d: Any; go: (s: Section) => void; reload: () => void }) {
  const { busy, error, act } = useAct();
  const policies = useLoad<Any[]>(client, '/policies');
  const todo = [
    d.toSign ? { t: `${d.toSign} document${d.toSign === 1 ? '' : 's'} to sign`, go: 'docs' as Section } : null,
    d.openQueries ? { t: `${d.openQueries} quer${d.openQueries === 1 ? 'y' : 'ies'} to answer`, go: 'more' as Section } : null,
    d.trainingDue ? { t: `${d.trainingDue} training course${d.trainingDue === 1 ? '' : 's'} to finish`, go: 'more' as Section } : null,
    d.surveysOpen ? { t: `${d.surveysOpen} short survey${d.surveysOpen === 1 ? '' : 's'} waiting`, go: 'more' as Section } : null,
  ].filter(Boolean) as { t: string; go: Section }[];

  return (
    <div className="myhr-stack">
      <div className="myhr-actions">
        <button type="button" onClick={() => go('leave')}>
          <b>Ask for leave</b>
          <span>Goes to your manager, then HR</span>
        </button>
        <button type="button" onClick={() => go('claims')}>
          <b>New expense claim</b>
          <span>Paid by bank transfer</span>
        </button>
        <button type="button" onClick={() => go('pay')}>
          <b>Payslips</b>
          <span>Every month, with the breakdown</span>
        </button>
        <button type="button" onClick={() => go('docs')}>
          <b>Documents</b>
          <span>{d.toSign ? `${d.toSign} waiting for your signature` : 'Contracts, letters, certificates'}</span>
        </button>
      </div>

      {error && <Note tone="no">{error}</Note>}
      {d.policiesToRead.map((p: Any) => (
        <Card key={p.id} accent title={`Please read: ${p.title}`} aside={<span className="myhr-muted">v{p.version}</span>}>
          <p className="myhr-body">{policies.data?.find((x) => x.id === p.id)?.body ?? ''}</p>
          <Btn primary busy={busy === p.id} onClick={() => act(p.id, () => client.call(`/policies/${p.id}/ack`, { method: 'POST', body: {} }), reload)}>
            I have read and understood this
          </Btn>
        </Card>
      ))}

      {todo.length > 0 && (
        <Card title="To do">
          <ul className="myhr-list">
            {todo.map((x) => (
              <li key={x.t}>
                <button type="button" className="myhr-link" onClick={() => go(x.go)}>
                  {x.t} →
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div>
        <h2 className="myhr-h2">Leave left this year</h2>
        <div className="myhr-tiles">
          {d.balances.length === 0 && <Empty>HR hasn&apos;t set up leave types yet.</Empty>}
          {d.balances.map((b: Any) => (
            <div key={b.typeId} className="myhr-tile">
              <span>{b.name}</span>
              <b>{b.limited ? b.available : '∞'}</b>
              <small>{b.limited ? `of ${b.allowance + b.adjusted} days · ${b.used} used` : 'no limit'}{b.pending ? ` · ${b.pending} waiting` : ''}</small>
            </div>
          ))}
        </div>
      </div>

      {d.announcements.length > 0 && (
        <div>
          <h2 className="myhr-h2">From HR</h2>
          <div className="myhr-stack">
            {d.announcements.map((a: Any) => (
              <Card key={a.id} title={`${a.pinned ? '📌 ' : ''}${a.title}`} aside={<span className="myhr-muted">{nice(a.publishedAt)}</span>}>
                <p className="myhr-body">{a.body}</p>
              </Card>
            ))}
          </div>
        </div>
      )}

      {d.staffType === 'INTERN' && d.internshipEndsAt ? (
        <Note tone="info">
          Internship ends {nice(d.internshipEndsAt)}
          {d.supervisorName ? ` · supervisor ${d.supervisorName}` : ''}
        </Note>
      ) : null}
      <Personal client={client} d={d} onSaved={reload} />
    </div>
  );
}

function Personal({ client, d, onSaved }: { client: MyHrClient; d: Any; onSaved: () => void }) {
  const [edit, setEdit] = useState(false);
  const init = () => ({
    phone: d.phone ?? '',
    address: d.personal.address ?? '',
    kin: d.personal.nextOfKin?.name ?? '',
    kinRel: d.personal.nextOfKin?.relationship ?? '',
    kinPhone: d.personal.nextOfKin?.phone ?? '',
    em: d.personal.emergency?.name ?? '',
    emRel: d.personal.emergency?.relationship ?? '',
    emPhone: d.personal.emergency?.phone ?? '',
  });
  const [v, setV] = useState(init);
  const { busy, error, act } = useAct();
  const fields = [
    ['phone', 'Phone'],
    ['address', 'Home address'],
    ['kin', 'Next of kin: name'],
    ['kinRel', 'Next of kin: relationship'],
    ['kinPhone', 'Next of kin: phone'],
    ['em', 'Emergency contact: name'],
    ['emRel', 'Emergency contact: relationship'],
    ['emPhone', 'Emergency contact: phone'],
  ] as const;

  return (
    <Card
      title="My details"
      aside={
        <button type="button" className="myhr-link" onClick={() => { setV(init()); setEdit((x) => !x); }}>
          {edit ? 'Close' : 'Update'}
        </button>
      }
    >
      {!edit ? (
        <dl className="myhr-dl">
          <dt>Phone</dt>
          <dd>{d.phone ?? '—'}</dd>
          <dt>Address</dt>
          <dd>{d.personal.address ?? '—'}</dd>
          <dt>Next of kin</dt>
          <dd>{d.personal.nextOfKin?.name ?? '—'}</dd>
          <dt>Emergency contact</dt>
          <dd>{d.personal.emergency?.name ?? '—'}</dd>
          <dt>Bank</dt>
          <dd>{[d.personal.bankName, d.personal.accountNumber].filter(Boolean).join(' ') || '—'}</dd>
          <dt>Pension</dt>
          <dd>{d.personal.pensionPfa ?? '—'}</dd>
        </dl>
      ) : (
        <div className="myhr-grid2">
          {fields.map(([k, label]) => (
            <Field key={k} label={label}>
              <input value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} maxLength={k === 'address' ? 300 : 120} />
            </Field>
          ))}
        </div>
      )}
      {edit && (
        <div className="myhr-row">
          {error && <Note tone="no">{error}</Note>}
          <Btn
            primary
            busy={busy === 'save'}
            onClick={() =>
              act(
                'save',
                () =>
                  client.call('/file', {
                    method: 'PATCH',
                    body: {
                      phone: v.phone || null,
                      address: v.address,
                      nextOfKin: { name: v.kin, relationship: v.kinRel, phone: v.kinPhone },
                      emergency: { name: v.em, relationship: v.emRel, phone: v.emPhone },
                    },
                  }),
                () => { setEdit(false); onSaved(); },
              )
            }
          >
            Save my details
          </Btn>
        </div>
      )}
      <p className="myhr-muted small">To change your bank, NIN or pension details, ask HR. You can&apos;t change them here, so nobody can redirect your pay.</p>
    </Card>
  );
}

/* ── Leave ──────────────────────────────────────────────────────────────── */

function Leave({ client, onChange }: { client: MyHrClient; onChange: () => void }) {
  const r = useLoad<Any>(client, '/leave');
  const [typeId, setTypeId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const { busy, error, act } = useAct();
  const d = r.data;
  if (!d) return <Loading error={r.error} />;
  const valid = !!typeId && !!from && (!to || to >= from);

  return (
    <div className="myhr-stack">
      <Card title="Ask for leave">
        <div className="myhr-chips" role="radiogroup" aria-label="Leave type">
          {d.balances.map((t: Any) => (
            <button key={t.typeId} type="button" role="radio" aria-checked={typeId === t.typeId} className={typeId === t.typeId ? 'on' : ''} onClick={() => setTypeId(t.typeId)}>
              {t.name}
              {t.limited ? ` · ${t.available} left` : ''}
            </button>
          ))}
        </div>
        <div className="myhr-grid2">
          <Field label="From">
            <input type="date" value={from} min={today()} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <input type="date" value={to} min={from || today()} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <Field label="Reason (optional, only your manager and HR see it)">
          <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <p className="myhr-muted small">Weekends and public holidays aren&apos;t counted. It goes to your manager, then HR.</p>
        {error && <Note tone="no">{error}</Note>}
        <div className="myhr-row">
          <Btn
            primary
            disabled={!valid}
            busy={busy === 'send'}
            onClick={() =>
              act('send', () => client.call('/leave', { method: 'POST', body: { typeId, startDate: from, endDate: to || from, reason: reason || undefined } }), () => {
                setFrom('');
                setTo('');
                setReason('');
                r.reload();
                onChange();
              })
            }
          >
            Send request
          </Btn>
        </div>
      </Card>

      <h2 className="myhr-h2">My requests</h2>
      {d.requests.length === 0 && <Empty>No leave requests yet.</Empty>}
      {d.requests.map((l: Any) => {
        const cancellable = ['PENDING_MANAGER', 'PENDING_HR'].includes(l.status) || (l.status === 'APPROVED' && l.startDate > today());
        return (
          <Card key={l.id} title={`${l.type} · ${l.days} day${l.days === 1 ? '' : 's'}`} aside={<Pill status={l.status} />}>
            <p className="myhr-meta">
              {nice(l.startDate)} → {nice(l.endDate)}
            </p>
            {l.hrNote || l.managerNote ? <p className="myhr-body">“{l.hrNote ?? l.managerNote}”</p> : null}
            {cancellable && (
              <div className="myhr-row">
                <Btn busy={busy === l.id} onClick={() => act(l.id, () => client.call(`/leave/${l.id}/cancel`, { method: 'POST', body: {} }), () => { r.reload(); onChange(); })}>
                  Cancel request
                </Btn>
              </div>
            )}
          </Card>
        );
      })}

      {d.holidays?.length > 0 && (
        <Card title={`Public holidays ${new Date().getUTCFullYear()}`}>
          <ul className="myhr-list compact">
            {d.holidays.map((h: Any) => (
              <li key={h.id}>
                <span>{h.name}</span>
                <span className="myhr-muted">{nice(h.day)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/* ── Payslips ───────────────────────────────────────────────────────────── */

function Payslips({ client }: { client: MyHrClient }) {
  const r = useLoad<Any[]>(client, '/payslips');
  const [open, setOpen] = useState<string | null>(null);
  if (!r.data) return <Loading error={r.error} />;
  if (r.data.length === 0) return <Empty>No payslips yet. They appear once a month&apos;s payroll is approved.</Empty>;
  return (
    <div className="myhr-stack">
      {r.data.map((p) => {
        const isOpen = open === p.id;
        return (
          <section key={p.id} className="myhr-card">
            <button type="button" className="myhr-slip-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : p.id)}>
              <span>
                <b>{p.period}</b>
                <small>{p.paidAt ? `Paid ${nice(p.paidAt)}${p.transferRef ? ` · ref ${p.transferRef}` : ''}` : 'Approved, not paid yet'}</small>
              </span>
              <b className="myhr-money">{naira(p.netKobo)}</b>
            </button>
            {isOpen && (
              <div className="myhr-slip">
                {[
                  ['Basic', p.basicKobo],
                  ['Housing', p.housingKobo],
                  ['Transport', p.transportKobo],
                  ['Other allowances', p.otherKobo],
                  ['Gross pay', p.grossKobo, true],
                  ['Pension (yours)', -p.pensionEeKobo],
                  ['NHF', -p.nhfKobo],
                  ['PAYE tax', -p.payeKobo],
                  ...(p.adjustments ?? []).map((a: Any) => [a.label, a.kobo]),
                  ['Net pay', p.netKobo, true],
                ].map(([label, kobo, strong]) => (
                  <div key={String(label)} className={`myhr-line${strong ? ' strong' : ''}`}>
                    <span>{label}</span>
                    <span className="myhr-money">{naira(Number(kobo) || 0)}</span>
                  </div>
                ))}
                <p className="myhr-muted small">AZM also pays {naira(p.pensionErKobo ?? 0)} into your pension this month.</p>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/* ── Documents ──────────────────────────────────────────────────────────── */

async function openBlob(client: MyHrClient, path: string) {
  // Open the window first, in the click's own tick, or browsers block it.
  const w = typeof window !== 'undefined' ? window.open('', '_blank') : null;
  try {
    const blob = await client.file(path);
    const url = URL.createObjectURL(blob);
    if (w) w.location.href = url;
    else window.location.assign(url);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    w?.close();
    throw e;
  }
}

function Documents({ client, onChange }: { client: MyHrClient; onChange: () => void }) {
  const r = useLoad<Any[]>(client, '/documents');
  const [signing, setSigning] = useState<string | null>(null);
  const [name, setName] = useState('');
  const { busy, error, act } = useAct();
  if (!r.data) return <Loading error={r.error} />;
  return (
    <div className="myhr-stack">
      {error && <Note tone="no">{error}</Note>}
      {r.data.length === 0 && <Empty>No documents yet. HR adds contracts and letters here.</Empty>}
      {r.data.map((doc) => (
        <Card key={doc.id} accent={doc.requiresSignature && !doc.signedAt} title={doc.title} aside={doc.requiresSignature ? <Pill status={doc.signedAt ? 'DONE' : 'ASSIGNED'} /> : null}>
          <p className="myhr-meta">
            {String(doc.kind).replace(/_/g, ' ').toLowerCase()} · added {nice(doc.createdAt)}
            {doc.expiresAt ? ` · expires ${nice(doc.expiresAt)}` : ''}
          </p>
          {doc.signedAt ? <p className="myhr-meta">Signed by {doc.signedName} on {nice(doc.signedAt)}</p> : null}
          {signing === doc.id ? (
            <div className="myhr-sign">
              <p className="myhr-muted small">Open and read it first. Typing your full name below is your signature.</p>
              <Field label="Your full name">
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <div className="myhr-row">
                <Btn onClick={() => setSigning(null)}>Cancel</Btn>
                <Btn primary disabled={name.trim().length < 3} busy={busy === `sign-${doc.id}`} onClick={() => act(`sign-${doc.id}`, () => client.call(`/documents/${doc.id}/sign`, { method: 'POST', body: { name } }), () => { setSigning(null); r.reload(); onChange(); })}>
                  Sign
                </Btn>
              </div>
            </div>
          ) : (
            <div className="myhr-row">
              <Btn busy={busy === `open-${doc.id}`} onClick={() => act(`open-${doc.id}`, () => openBlob(client, `/documents/${doc.id}/file`))}>
                Open
              </Btn>
              {doc.requiresSignature && !doc.signedAt && (
                <Btn primary onClick={() => { setSigning(doc.id); setName(''); }}>
                  Sign
                </Btn>
              )}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

/* ── Claims ─────────────────────────────────────────────────────────────── */

const CLAIM_KINDS = [
  ['TRANSPORT', 'Transport'],
  ['PER_DIEM', 'Per diem'],
  ['ACCOMMODATION', 'Accommodation'],
  ['WELFARE', 'Welfare'],
  ['RELOCATION', 'Relocation'],
  ['OTHER', 'Other'],
] as const;

const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_RECEIPT = 6 * 1024 * 1024;

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '');
    fr.onerror = () => reject(new Error('Could not read that file'));
    fr.readAsDataURL(file);
  });
}

function Claims({ client }: { client: MyHrClient }) {
  const r = useLoad<Any[]>(client, '/claims');
  const [kind, setKind] = useState<string>('TRANSPORT');
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [receipts, setReceipts] = useState<{ id: string; name: string }[]>([]);
  const { busy, error, act, setError } = useAct();

  const addReceipt = (file: File | undefined) => {
    if (!file) return;
    if (!RECEIPT_TYPES.includes(file.type)) return setError('Receipts must be a photo (JPG, PNG, WebP) or a PDF.');
    if (file.size > MAX_RECEIPT) return setError('That file is over 6 MB. Take a smaller photo.');
    void act('upload', async () => {
      const doc = await client.call<Any>('/documents', {
        method: 'POST',
        body: { kind: 'RECEIPT', title: `Receipt ${today()}`, contentType: file.type, dataBase64: await toBase64(file) },
      });
      setReceipts((x) => [...x, { id: doc.id, name: file.name }]);
    });
  };

  return (
    <div className="myhr-stack">
      <Card title="New expense claim">
        <div className="myhr-chips" role="radiogroup" aria-label="Kind of claim">
          {CLAIM_KINDS.map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
              {l}
            </button>
          ))}
        </div>
        <div className="myhr-grid2">
          <Field label="What for">
            <input value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder="Transport to supplier visit, Kano" />
          </Field>
          <Field label="Amount (₦)">
            <input value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0.00" />
          </Field>
        </div>
        <div className="myhr-row start">
          <label className="myhr-btn">
            {busy === 'upload' ? 'Uploading…' : 'Add receipt'}
            <input type="file" accept={RECEIPT_TYPES.join(',')} hidden disabled={busy === 'upload'} onChange={(e) => { addReceipt(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {receipts.map((x) => (
            <span key={x.id} className="myhr-pill info">
              {x.name}
            </span>
          ))}
        </div>
        {error && <Note tone="no">{error}</Note>}
        <div className="myhr-row">
          <Btn
            primary
            disabled={title.trim().length < 3 || !(Number(amount) > 0) || busy === 'upload'}
            busy={busy === 'send'}
            onClick={() =>
              act('send', () => client.call('/claims', { method: 'POST', body: { kind, title, amountKobo: Math.round(Number(amount) * 100), receiptIds: receipts.map((x) => x.id) } }), () => {
                setTitle('');
                setAmount('');
                setReceipts([]);
                r.reload();
              })
            }
          >
            Send claim
          </Btn>
        </div>
        <p className="myhr-muted small">Paid by bank transfer once your manager and HR approve.</p>
      </Card>

      <h2 className="myhr-h2">My claims</h2>
      {!r.data ? <Loading error={r.error} /> : r.data.length === 0 ? <Empty>No claims yet.</Empty> : null}
      {r.data?.map((c) => (
        <Card key={c.id} title={c.title} aside={<Pill status={c.status} />}>
          <p className="myhr-meta">
            <span className="myhr-money">{naira(c.amountKobo)}</span> · {nice(c.createdAt)}
            {c.paidRef ? ` · ref ${c.paidRef}` : ''}
          </p>
          {['PENDING_MANAGER', 'PENDING_HR'].includes(c.status) && (
            <div className="myhr-row">
              <Btn busy={busy === c.id} onClick={() => act(c.id, () => client.call(`/claims/${c.id}/cancel`, { method: 'POST', body: {} }), r.reload)}>
                Withdraw
              </Btn>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

/* ── Reviews, queries, training, surveys ───────────────────────────────── */

function More({ client, onChange }: { client: MyHrClient; onChange: () => void }) {
  const queries = useLoad<Any[]>(client, '/queries');
  const reviews = useLoad<Any[]>(client, '/reviews');
  const training = useLoad<Any[]>(client, '/training');
  const surveys = useLoad<Any[]>(client, '/surveys');
  const celebrations = useLoad<Any[]>(client, '/celebrations');
  const [reply, setReply] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<Record<string, Record<string, string | number>>>({});
  const { busy, error, act } = useAct();
  const done = (fn: () => void) => () => { fn(); onChange(); };
  const party: Any[] = Array.isArray(celebrations.data) ? celebrations.data : [];

  return (
    <div className="myhr-stack">
      {error && <Note tone="no">{error}</Note>}

      <h2 className="myhr-h2">Queries</h2>
      {!queries.data ? <Loading error={queries.error} /> : queries.data.length === 0 ? <Empty>None.</Empty> : null}
      {queries.data?.map((q) => (
        <Card key={q.id} accent={!q.response && !q.closedAt} title={q.subject} aside={<span className="myhr-muted">{nice(q.createdAt)}</span>}>
          {q.responseDueAt && !q.response ? <p className="myhr-meta">Respond by {nice(q.responseDueAt)}</p> : null}
          <p className="myhr-body">{q.details}</p>
          {q.response ? (
            <p className="myhr-body quote">Your response: {q.response}</p>
          ) : !q.closedAt ? (
            <>
              <Field label="Your response">
                <textarea rows={4} value={reply[q.id] ?? ''} onChange={(e) => setReply({ ...reply, [q.id]: e.target.value })} />
              </Field>
              <div className="myhr-row">
                <Btn primary disabled={(reply[q.id] ?? '').trim().length < 10} busy={busy === q.id} onClick={() => act(q.id, () => client.call(`/queries/${q.id}/respond`, { method: 'POST', body: { response: reply[q.id] } }), done(queries.reload))}>
                  Send response
                </Btn>
              </div>
            </>
          ) : null}
          {q.closedAt ? <p className="myhr-meta">Outcome: {String(q.outcome ?? 'closed').replace(/_/g, ' ').toLowerCase()}</p> : null}
        </Card>
      ))}

      <h2 className="myhr-h2">Performance reviews</h2>
      {!reviews.data ? <Loading error={reviews.error} /> : reviews.data.length === 0 ? <Empty>No reviews open.</Empty> : null}
      {reviews.data?.map((rv) => (
        <Card key={rv.id} title={rv.cycleName} aside={<Pill status={rv.status} />}>
          {rv.status === 'SELF' && rv.cycleOpen ? (
            <>
              <Field label="How did the period go? What went well, what was hard, what do you need?">
                <textarea rows={5} value={notes[rv.id] ?? rv.selfNotes ?? ''} onChange={(e) => setNotes({ ...notes, [rv.id]: e.target.value })} />
              </Field>
              <div className="myhr-row">
                <Btn onClick={() => act(`save-${rv.id}`, () => client.call(`/reviews/${rv.id}`, { method: 'PUT', body: { goals: rv.goals ?? [], selfNotes: notes[rv.id] ?? rv.selfNotes ?? '', submit: false } }), reviews.reload)} busy={busy === `save-${rv.id}`}>
                  Save draft
                </Btn>
                <Btn primary busy={busy === rv.id} onClick={() => act(rv.id, () => client.call(`/reviews/${rv.id}`, { method: 'PUT', body: { goals: rv.goals ?? [], selfNotes: notes[rv.id] ?? rv.selfNotes ?? '', submit: true } }), done(reviews.reload))}>
                  Send to my manager
                </Btn>
              </div>
            </>
          ) : rv.status === 'DONE' ? (
            <p className="myhr-meta">
              Rating {rv.managerRating}/5{rv.managerNotes ? ` · ${rv.managerNotes}` : ''}
            </p>
          ) : (
            <p className="myhr-meta">With {rv.reviewerName ?? 'your manager'}.</p>
          )}
        </Card>
      ))}

      <h2 className="myhr-h2">Training</h2>
      {!training.data ? <Loading error={training.error} /> : training.data.length === 0 ? <Empty>Nothing assigned.</Empty> : null}
      {training.data?.map((t) => (
        <Card key={t.id} title={t.title} aside={<Pill status={t.status} />}>
          <p className="myhr-meta">
            {[t.provider, t.dueAt && `due ${nice(t.dueAt)}`, t.status === 'DONE' && `done ${nice(t.completedAt)}`].filter(Boolean).join(' · ') || ' '}
          </p>
          {t.status !== 'DONE' && (
            <div className="myhr-row">
              <Btn primary busy={busy === t.id} onClick={() => act(t.id, () => client.call(`/training/${t.id}/complete`, { method: 'POST', body: {} }), done(training.reload))}>
                I&apos;ve finished this
              </Btn>
            </div>
          )}
        </Card>
      ))}

      <h2 className="myhr-h2">Surveys</h2>
      <p className="myhr-muted small">Anonymous: your name isn&apos;t stored with your answers.</p>
      {!surveys.data ? <Loading error={surveys.error} /> : surveys.data.filter((x) => !x.answered).length === 0 ? <Empty>No surveys waiting.</Empty> : null}
      {surveys.data
        ?.filter((x) => !x.answered)
        .map((sv) => (
          <Card key={sv.id} title={sv.title}>
            {(sv.questions as Any[]).map((q) => (
              <div key={q.key} className="myhr-q">
                <p className="myhr-body">{q.text}</p>
                {q.type === 'SCALE' ? (
                  <div className="myhr-chips" role="radiogroup" aria-label={q.text}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} type="button" role="radio" aria-checked={answers[sv.id]?.[q.key] === n} className={answers[sv.id]?.[q.key] === n ? 'on' : ''} onClick={() => setAnswers({ ...answers, [sv.id]: { ...answers[sv.id], [q.key]: n } })}>
                        {n}
                      </button>
                    ))}
                  </div>
                ) : (
                  <textarea rows={2} value={String(answers[sv.id]?.[q.key] ?? '')} onChange={(e) => setAnswers({ ...answers, [sv.id]: { ...answers[sv.id], [q.key]: e.target.value } })} />
                )}
              </div>
            ))}
            <div className="myhr-row">
              <Btn primary busy={busy === sv.id} onClick={() => act(sv.id, () => client.call(`/surveys/${sv.id}`, { method: 'POST', body: { answers: answers[sv.id] ?? {} } }), done(surveys.reload))}>
                Send answers
              </Btn>
            </div>
          </Card>
        ))}

      {party.length > 0 && (
        <>
          <h2 className="myhr-h2">Coming up</h2>
          <Card>
            <ul className="myhr-list compact">
              {party.map((c: Any, i: number) => (
                <li key={`${c.userId ?? c.name}-${i}`}>
                  <span>
                    {c.kind === 'ANNIVERSARY' ? '🎉' : '🎂'} {c.name}
                    {c.years ? ` · ${c.years} year${c.years === 1 ? '' : 's'} at AZM` : ''}
                  </span>
                  <span className="myhr-muted">{nice(c.date)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}

/* ── My team (managers) ─────────────────────────────────────────────────── */

function Team({ client }: { client: MyHrClient }) {
  const r = useLoad<Any>(client, '/team');
  const { busy, error, act } = useAct();
  const d = r.data;
  if (!d) return <Loading error={r.error} />;
  const decide = (kind: 'leave' | 'claims', id: string, approve: boolean) =>
    act(`${id}-${approve}`, () => client.call(`/team/${kind}/${id}/decide`, { method: 'POST', body: { approve } }), r.reload);

  return (
    <div className="myhr-stack">
      {error && <Note tone="no">{error}</Note>}
      <div className="myhr-tiles">
        <div className="myhr-tile">
          <span>People</span>
          <b>{d.people.length}</b>
          <small>report to you</small>
        </div>
        <div className="myhr-tile">
          <span>Leave to approve</span>
          <b>{d.leaveWaiting.length}</b>
        </div>
        <div className="myhr-tile">
          <span>Claims to approve</span>
          <b>{d.claimsWaiting.length}</b>
        </div>
      </div>

      <h2 className="myhr-h2">Leave to approve</h2>
      {d.leaveWaiting.length === 0 && <Empty>Nothing waiting.</Empty>}
      {d.leaveWaiting.map((l: Any) => (
        <Card key={l.id} title={`${l.name}: ${l.type}`}>
          <p className="myhr-meta">
            {nice(l.startDate)} → {nice(l.endDate)} · {l.days} day{l.days === 1 ? '' : 's'}
          </p>
          {l.reason ? <p className="myhr-body">{l.reason}</p> : null}
          <div className="myhr-row">
            <Btn busy={busy === `${l.id}-false`} onClick={() => decide('leave', l.id, false)}>
              Decline
            </Btn>
            <Btn primary busy={busy === `${l.id}-true`} onClick={() => decide('leave', l.id, true)}>
              Approve
            </Btn>
          </div>
        </Card>
      ))}

      <h2 className="myhr-h2">Claims to approve</h2>
      {d.claimsWaiting.length === 0 && <Empty>Nothing waiting.</Empty>}
      {d.claimsWaiting.map((c: Any) => (
        <Card key={c.id} title={`${c.name}: ${c.title}`}>
          <p className="myhr-meta">
            <span className="myhr-money">{naira(c.amountKobo)}</span> · {c.receiptIds?.length ?? 0} receipt(s)
          </p>
          <div className="myhr-row">
            <Btn busy={busy === `${c.id}-false`} onClick={() => decide('claims', c.id, false)}>
              Decline
            </Btn>
            <Btn primary busy={busy === `${c.id}-true`} onClick={() => decide('claims', c.id, true)}>
              Approve
            </Btn>
          </div>
        </Card>
      ))}

      <h2 className="myhr-h2">Off in the next 30 days</h2>
      {d.upcomingLeave.length === 0 ? (
        <Empty>Nobody.</Empty>
      ) : (
        <Card>
          <ul className="myhr-list compact">
            {d.upcomingLeave.map((l: Any) => (
              <li key={l.id}>
                <span>{l.name}</span>
                <span className="myhr-muted">
                  {nice(l.startDate)} → {nice(l.endDate)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {d.reviews.length > 0 && <h2 className="myhr-h2">Reviews to finish</h2>}
      {d.reviews.map((rv: Any) => (
        <ManagerReview key={rv.id} client={client} rv={rv} onDone={r.reload} />
      ))}
    </div>
  );
}

function ManagerReview({ client, rv, onDone }: { client: MyHrClient; rv: Any; onDone: () => void }) {
  const [notes, setNotes] = useState(rv.managerNotes ?? '');
  const [rating, setRating] = useState<number>(rv.managerRating ?? 3);
  const { busy, error, act } = useAct();
  return (
    <Card title={`${rv.name} · ${rv.cycleName}`} aside={<Pill status={rv.status} />}>
      {rv.status === 'SELF' ? <p className="myhr-meta">Their self review isn&apos;t in yet. You can still write yours.</p> : null}
      {rv.selfNotes ? <p className="myhr-body quote">They wrote: {rv.selfNotes}</p> : null}
      <Field label="Your notes">
        <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <p className="myhr-muted small">Overall rating: 1 is below expectations, 5 is outstanding.</p>
      <div className="myhr-chips" role="radiogroup" aria-label="Overall rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={rating === n} className={rating === n ? 'on' : ''} onClick={() => setRating(n)}>
            {n}
          </button>
        ))}
      </div>
      {error && <Note tone="no">{error}</Note>}
      <div className="myhr-row">
        <Btn primary disabled={notes.trim().length < 3} busy={busy === 'done'} onClick={() => act('done', () => client.call(`/team/reviews/${rv.id}`, { method: 'PUT', body: { goals: rv.goals ?? [], managerNotes: notes, managerRating: rating, submit: true } }), onDone)}>
          Finish review
        </Btn>
      </div>
    </Card>
  );
}
