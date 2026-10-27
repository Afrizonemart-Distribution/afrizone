import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { AccountType } from '../lib/types'
import Logo from '../components/Logo'
import './Landing.css'

/**
 * The front door of the PartTime portal.
 *
 * It used to be a bare account-type picker: a question, three cards, done. That
 * is the right shape for somebody who already knows what AfriZone PartTime is
 * and has been sent here to sign up. It is the wrong shape for the larger group
 * — a shop owner who followed a link, or a rider who heard about it from
 * another rider — because it asks them to commit before it has said what they
 * would be committing to.
 *
 * So the picker is still the centre of the page, and everything around it
 * exists to answer the questions somebody asks before they are willing to use
 * it: what is this, what happens after I sign up, what do I get, and what will
 * it cost me. Modelled on suppliers.afrizonemart.com, which does the same job
 * for the supply side of the business.
 *
 * NOTHING ON THIS PAGE PROMISES SOMETHING THE PLATFORM DOES NOT DO. Every claim
 * below is a feature that exists in the build today — the eligibility gate,
 * credential verification, the escrow commitment, the delivery code, WHT on
 * payouts. Marketing copy that runs ahead of the product is how a store's first
 * week becomes a support ticket.
 *
 * WHAT THE CHOICE DOES NOT DO: it does not decide which dashboard anybody lands
 * on. That comes from the account type stored on the server (see lib/auth.tsx).
 * Someone who picks the wrong card and then signs in arrives where their account
 * actually belongs, with no correction and no dead end.
 */

interface Option {
  key: AccountType
  title: string
  blurb: string
  bullets: string[]
  to: string
  /** Named on the Continue button, so the button says what it will do. */
  confirm: string
  glyph: JSX.Element
}

const OPTIONS: Option[] = [
  {
    key: 'INDIVIDUAL',
    title: 'Individual',
    blurb: 'For people taking on paid work — field tasks, promotions, media and sourcing.',
    bullets: [
      'Find work matched to your skills and tier',
      'Record your hours and submit proof of work',
      'Get paid into your own bank account',
    ],
    to: '/individual',
    confirm: 'Continue as an individual',
    glyph: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <circle cx="12" cy="8" r="3.6" />
        <path d="M4.5 20c0-4.1 3.4-6.4 7.5-6.4s7.5 2.3 7.5 6.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: 'STORE',
    title: 'AfriZoneMart Store',
    blurb: 'For shops and businesses fulfilling orders placed on AfriZoneMart.',
    bullets: [
      'Receive orders and confirm what you can fulfil',
      'Prepare each order for courier collection',
      'Track settlements and what you are owed',
    ],
    to: '/register/STORE',
    confirm: 'Continue as a store',
    glyph: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="M3.6 9.2 5 4.5h14l1.4 4.7" strokeLinejoin="round" />
        <path d="M3.6 9.2h16.8v2.1a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-4.8 2.4Z" strokeLinejoin="round" />
        <path d="M5.2 13.6V20h13.6v-6.4" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    key: 'COURIER',
    title: 'Courier / Dispatch',
    blurb: 'For riders and dispatch companies delivering AfriZoneMart orders.',
    bullets: [
      'Take delivery jobs from shops near you',
      'Manage collection, drop-off and proof of delivery',
      'Confirm each delivery with the customer’s code',
    ],
    to: '/register/COURIER',
    confirm: 'Continue as a courier',
    glyph: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <circle cx="5.6" cy="17.2" r="3" />
        <circle cx="18.4" cy="17.2" r="3" />
        <path d="M8.6 17.2h6.2l-2.4-7.4H9.6" strokeLinejoin="round" strokeLinecap="round" />
        <path d="M12.4 9.8 14 6.4h3" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    ),
  },
]

/** One path, true for all three account types. Anything type-specific belongs
 *  on the cards, not here — four stages that only apply to a store would read
 *  as four stages a courier has to complete. */
const STAGES = [
  {
    n: '01',
    title: 'Create your account',
    body: 'Tell us who you are and how you want to work. It takes a few minutes, and you can stop and come back.',
  },
  {
    n: '02',
    title: 'Get verified',
    body: 'We confirm your identity, and your business registration or your licence where the work needs one. Verification happens once, not per job.',
  },
  {
    n: '03',
    title: 'Start working',
    body: 'Orders and tasks reach you the moment you qualify for them. You accept what you can do and decline what you cannot.',
  },
  {
    n: '04',
    title: 'Get paid',
    body: 'Payment is committed when the work starts and released when it is confirmed complete, straight to the account you registered.',
  },
]

const FEATURES = [
  {
    title: 'Only work you qualify for',
    body: 'Your skills, tier and verified credentials decide what you are shown. Nobody is offered a delivery job that needs a licence they have not given us, and no shop is asked to fulfil an order it never agreed to.',
    glyph: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="M12 3.6 4.6 6.8v5c0 4.3 3 8 7.4 8.9 4.4-.9 7.4-4.6 7.4-8.9v-5L12 3.6Z" strokeLinejoin="round" />
        <path d="m9.2 12 2 2 3.6-3.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: 'Verified once, trusted throughout',
    body: 'Identity, business registration and licences are checked by a person and held on your profile. A licence that expires stops counting on the day it expires, so what a buyer sees is true today rather than true when you uploaded it.',
    glyph: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <rect x="3.4" y="5.2" width="17.2" height="13.6" rx="2.4" />
        <circle cx="9" cy="11" r="2.2" />
        <path d="M5.8 16.4c.6-1.7 1.8-2.6 3.2-2.6s2.6.9 3.2 2.6M14.6 10h4.2M14.6 13.2h4.2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: 'Your money is committed up front',
    body: 'When work is assigned, the amount is ring-fenced against it and shown to you as committed. It is released when the work is confirmed, and withholding tax is calculated and recorded so your statement is ready when you need it.',
    glyph: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <rect x="3" y="6.4" width="18" height="12" rx="2.4" />
        <path d="M3 10.4h18" />
        <path d="M7 14.6h3.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: 'One screen for the whole job',
    body: 'Orders, deliveries, what is packed, who is carrying it, what you are owed and what is still waiting on you — on one page that keeps itself current without being reloaded.',
    glyph: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <rect x="3.4" y="4.6" width="17.2" height="14.8" rx="2.4" />
        <path d="M3.4 9h17.2M8.4 9v10.4" strokeLinejoin="round" />
      </svg>
    ),
  },
]

const FAQS = [
  {
    q: 'What does it cost to join?',
    a: 'Nothing. Creating an account, being verified and receiving work are all free. Afrizone earns from the trade itself, not from the people doing the work.',
  },
  {
    q: 'How long does verification take?',
    a: 'A person reviews what you submit, so it depends on the queue and on whether your documents are clear and current. You can see exactly which items are outstanding on your dashboard while you wait, and you are told what was wrong if something is rejected.',
  },
  {
    q: 'What do I need to sign up as a store?',
    a: 'Your business details, an address a courier can actually find, a bank account for payouts, and your CAC registration number. The registration is checked before your shop goes live, because the trust that puts orders in front of you is the same trust customers are relying on.',
  },
  {
    q: 'What do I need to deliver?',
    a: 'A verified identity, a valid driver’s licence, and a vehicle on your profile. Riding on foot or by bicycle is a real option — you are not asked to invent a vehicle you do not have.',
  },
  {
    q: 'How and when am I paid?',
    a: 'Into the bank account on your profile. The amount is committed against the work when it is assigned and released once the work is confirmed complete. Withholding tax is applied and recorded, and your annual statement is available from your account.',
  },
  {
    q: 'I work at Afrizone. Do I sign up here?',
    a: 'No. This portal is for stores, couriers and individuals. Staff accounts are created internally and used on a separate internal system — your team will tell you where.',
  },
]

export default function Landing() {
  const [chosen, setChosen] = useState<AccountType | null>(null)
  const [openFaq, setOpenFaq] = useState<number | null>(0)
  const navigate = useNavigate()
  const selected = OPTIONS.find((o) => o.key === chosen) ?? null

  return (
    <div className="lp">
      <header className="lp-top">
        <Logo size={34} className="lp-brand" />
        <nav className="lp-nav">
          <a href="#how">How it works</a>
          <a href="#faq">Questions</a>
          <Link className="lp-signin" to="/signin">
            Sign in
          </Link>
        </nav>
      </header>

      <main>
        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <section className="lp-hero">
          <div className="lp-hero-in">
            <p className="lp-eyebrow">AfriZone PartTime</p>
            <h1>Work that finds you, and pay that is set aside before you start</h1>
            <p className="lp-sub">
              AfriZone PartTime connects the shops, riders and Taskers behind AfriZoneMart. Sell
              from your counter, deliver across your city, or take on paid tasks near you — verified
              once, paid on completion.
            </p>
            <div className="lp-facts">
              <span>Free to join</span>
              <span>Verified by a person</span>
              <span>Paid on completion</span>
              <span>Work near you</span>
            </div>
            <div className="lp-hero-cta">
              <a className="lp-continue" href="#choose">
                Create an account
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M5 12h13M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
              <a className="lp-ghost" href="#how">
                See how it works
              </a>
            </div>
          </div>
        </section>

        {/* ── The picker, still the point of the page ───────────────────── */}
        <section className="lp-sec" id="choose">
          <div className="lp-sec-in">
            <p className="lp-eyebrow">Create an account</p>
            <h2 className="lp-h2">How will you use AfriZone PartTime?</h2>
            <p className="lp-lede">
              Choose the option that describes you. It determines the account we set up, the work you
              are shown, and how you are paid. If your situation changes later, our team can move you.
            </p>

            {/*
              A radio group rather than three buttons: one answer is expected,
              arrow keys move between them, and a screen reader announces
              "2 of 3" without any of that being written by hand.
            */}
            <div className="lp-cards" role="radiogroup" aria-label="Account type">
              {OPTIONS.map((o) => {
                const on = chosen === o.key
                return (
                  <button
                    type="button"
                    key={o.key}
                    role="radio"
                    aria-checked={on}
                    className={`lp-card${on ? ' is-on' : ''}`}
                    onClick={() => setChosen(o.key)}
                    onDoubleClick={() => navigate(o.to)}
                  >
                    <span className="lp-glyph" aria-hidden="true">
                      {o.glyph}
                    </span>
                    <h3>{o.title}</h3>
                    <p className="lp-blurb">{o.blurb}</p>
                    <ul className="lp-bullets">
                      {o.bullets.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                    {/* Colour alone is not a state somebody with low vision can
                        read, so the choice also grows a tick. */}
                    <span className="lp-check" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                        <path d="m5 12.5 4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="lp-go">
              <button
                type="button"
                className="lp-continue"
                disabled={!selected}
                onClick={() => selected && navigate(selected.to)}
              >
                {/* Names the choice back, so a mis-click is caught here rather
                    than three fields into the wrong registration form. */}
                {selected ? selected.confirm : 'Select an option to continue'}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M5 12h13M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <p className="lp-already">
                Already registered? <Link to="/signin">Sign in instead</Link>
              </p>
            </div>
          </div>
        </section>

        {/* ── How it works ──────────────────────────────────────────────── */}
        <section className="lp-sec lp-sec-alt" id="how">
          <div className="lp-sec-in">
            <p className="lp-eyebrow">How it works</p>
            <h2 className="lp-h2">From signing up to getting paid</h2>
            <p className="lp-lede">
              The same four stages whether you run a shop, ride a delivery, or take on tasks. You can
              always see which one you are on.
            </p>
            <ol className="lp-stages">
              {STAGES.map((s) => (
                <li key={s.n}>
                  <span className="lp-stage-n">{s.n}</span>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── What you get ──────────────────────────────────────────────── */}
        <section className="lp-sec">
          <div className="lp-sec-in">
            <p className="lp-eyebrow">What you get</p>
            <h2 className="lp-h2">Built so the work, and the money, are never in doubt</h2>
            <div className="lp-feats">
              {FEATURES.map((f) => (
                <div className="lp-feat" key={f.title}>
                  <span className="lp-glyph" aria-hidden="true">
                    {f.glyph}
                  </span>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Questions ─────────────────────────────────────────────────── */}
        <section className="lp-sec lp-sec-alt" id="faq">
          <div className="lp-sec-in lp-narrow">
            <p className="lp-eyebrow">Questions</p>
            <h2 className="lp-h2">Before you sign up</h2>
            <div className="lp-faq">
              {FAQS.map((f, i) => (
                <div className={`lp-q${openFaq === i ? ' is-open' : ''}`} key={f.q}>
                  <button
                    type="button"
                    aria-expanded={openFaq === i}
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  >
                    {f.q}
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  {openFaq === i && <p>{f.a}</p>}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Last word ─────────────────────────────────────────────────── */}
        <section className="lp-final">
          <div className="lp-sec-in lp-narrow">
            <h2 className="lp-h2">Ready to start?</h2>
            <p className="lp-lede">
              Creating an account takes a few minutes and costs nothing. You can be verified and
              working from your first week.
            </p>
            <div className="lp-hero-cta">
              <a className="lp-continue" href="#choose">
                Create an account
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M5 12h13M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
              <Link className="lp-ghost" to="/signin">
                Already registered? Sign in
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-sec-in lp-foot-in">
          <Logo size={28} />
          {/*
            THE ADMIN ADDRESS IS NOT PUBLISHED HERE, AND MUST NOT BE ADDED BACK.
            This line used to link to the staff console by name and URL, which
            handed every visitor — and every crawler and scanner — the address
            of the one application on the platform that can approve payouts and
            read customer data. Staff already know where they work; nobody else
            needs to.

            The sentence stays, because its job was never the link: somebody
            from Afrizone who lands here has to be told this is not their
            sign-in, or they file a ticket about a password that was never going
            to work.
          */}
          <p className="lp-staff">Afrizone staff do not register or sign in here.</p>
          <p className="lp-copy">© {new Date().getFullYear()} AfriZoneMart. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
