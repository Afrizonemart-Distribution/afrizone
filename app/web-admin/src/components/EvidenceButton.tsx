import { useEffect, useState } from 'react'
import { api, fetchAuthedObjectUrl } from '../api/client'
import type { EvidenceItem, EvidenceReview, SignatureItem } from '../api/types'
import Button from './ui/Button'
import Modal from './ui/Modal'
import { ErrorState, LoadingState } from './ui/StateView'

/**
 * The photos behind a job, for whoever is approving it (server:
 * services/evidence.ts).
 *
 * FLAGGED FIRST. A reviewer opening this is asking "is there anything wrong
 * with this?", and the photos the server could not vouch for - no position,
 * taken across town, taken an hour before it was sent - are the answer. The
 * flag is the server's sentence, shown as it is.
 *
 * The images are behind the API's auth, so each one is fetched with the
 * session token and shown from a blob URL, which is revoked when the dialog
 * closes.
 */
export default function EvidenceButton({
  taskId,
  workerId,
  label = 'Photos',
}: {
  taskId: string
  workerId?: string
  label?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="glass" size="sm" icon="eye" onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && <EvidenceDialog taskId={taskId} workerId={workerId} onClose={() => setOpen(false)} />}
    </>
  )
}

function EvidenceDialog({
  taskId,
  workerId,
  onClose,
}: {
  taskId: string
  workerId?: string
  onClose: () => void
}) {
  const [data, setData] = useState<EvidenceReview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .evidence(taskId, workerId)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load photos'))
  }, [taskId, workerId])

  const items = data
    ? [...data.evidence].sort((a, b) => Number(b.flagged) - Number(a.flagged))
    : []
  const signatures = data
    ? [...(data.signatures ?? [])].sort((a, b) => Number(b.flagged) - Number(a.flagged))
    : []

  return (
    <Modal
      open
      size="wide"
      title="Proof of work"
      subtitle={
        data
          ? data.evidence.length === 0
            ? 'No photos yet.'
            : `${data.evidence.length} photo${data.evidence.length === 1 ? '' : 's'}` +
              (data.flaggedCount > 0 ? ` · ${data.flaggedCount} need a look` : ' · every check passed')
          : undefined
      }
      onClose={onClose}
    >
      {error ? (
        <ErrorState message={error} />
      ) : !data ? (
        <LoadingState />
      ) : (
        <>
          {data.requirements.length > 0 && (
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 14px' }}>
              This job asks for:{' '}
              {data.requirements
                .map(
                  (r) =>
                    `${r.label.toLowerCase()}${r.count > 1 ? ` (${r.count})` : ''}` +
                    (r.signature && r.signer ? `, signed by ${r.signer.toLowerCase()}` : '')
                )
                .join('; ')}
              .
            </p>
          )}
          {signatures.length > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: 14,
                marginBottom: 14,
              }}
            >
              {signatures.map((s) => (
                <SignatureCard key={s.id} s={s} />
              ))}
            </div>
          )}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 14,
            }}
          >
            {items.map((e) => (
              <Photo key={e.id} e={e} />
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}

/**
 * A signature, drawn from its path data. Safe to put straight into an <svg>:
 * the server only accepts move, line, curve and close commands and numbers,
 * and React sets `d` as an attribute, never as markup.
 */
function SignatureCard({ s }: { s: SignatureItem }) {
  const when = s.capturedAt ?? s.receivedAt
  return (
    <figure
      style={{
        margin: 0,
        border: `1px solid ${s.flagged ? 'var(--gold-ink, #8a5a00)' : 'var(--line)'}`,
        borderRadius: 12,
        overflow: 'hidden',
        background: 'var(--card, #fff)',
      }}
    >
      <div style={{ aspectRatio: '2 / 1', background: '#fff', padding: 8 }}>
        <svg
          viewBox={`0 0 ${s.width} ${s.height}`}
          style={{ width: '100%', height: '100%' }}
          role="img"
          aria-label={`Signature of ${s.signerName}`}
        >
          <path d={s.path} stroke="#1E2643" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <figcaption style={{ padding: '10px 12px', fontSize: 12, lineHeight: 1.45 }}>
        <div style={{ fontWeight: 700 }}>
          Signed by {s.signerName} · {s.stageLabel.toLowerCase()}
        </div>
        <div style={{ color: 'var(--muted)' }}>
          {new Date(when).toLocaleString()}
          {s.distance ? ` · ${s.distance} from site` : ''}
        </div>
        {s.flags.map((f) => (
          <div key={f} style={{ color: 'var(--gold-ink, #8a5a00)', fontWeight: 700 }}>
            {f}
          </div>
        ))}
        {s.lat != null && s.lng != null && (
          <a
            href={`https://www.google.com/maps?q=${s.lat},${s.lng}`}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 12 }}
          >
            Where it was signed
          </a>
        )}
      </figcaption>
    </figure>
  )
}

function Photo({ e }: { e: EvidenceItem }) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let url: string | null = null
    let live = true
    fetchAuthedObjectUrl(e.url)
      .then((r) => {
        url = r.url
        if (live) setSrc(r.url)
        else URL.revokeObjectURL(r.url)
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [e.url])

  const when = e.capturedAt ?? e.receivedAt
  return (
    <figure
      style={{
        margin: 0,
        border: `1px solid ${e.flagged ? 'var(--gold-ink, #8a5a00)' : 'var(--line)'}`,
        borderRadius: 12,
        overflow: 'hidden',
        background: 'var(--card, #fff)',
      }}
    >
      <div style={{ aspectRatio: '4 / 3', background: 'var(--recessed, #f4f2ec)' }}>
        {src ? (
          <a href={src} target="_blank" rel="noreferrer">
            <img
              src={src}
              alt={e.stageLabel}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          </a>
        ) : (
          <div style={{ padding: 12, fontSize: 12, color: 'var(--muted)' }}>
            {failed ? 'Could not load this photo' : 'Loading…'}
          </div>
        )}
      </div>
      <figcaption style={{ padding: '10px 12px', fontSize: 12, lineHeight: 1.45 }}>
        <div style={{ fontWeight: 700 }}>{e.stageLabel}</div>
        <div style={{ color: 'var(--muted)' }}>
          {new Date(when).toLocaleString()}
          {e.distance ? ` · ${e.distance} from site` : ''}
        </div>
        {e.flags.map((f) => (
          <div key={f} style={{ color: 'var(--gold-ink, #8a5a00)', fontWeight: 700 }}>
            {f}
          </div>
        ))}
        {e.lat != null && e.lng != null && (
          <a
            href={`https://www.google.com/maps?q=${e.lat},${e.lng}`}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 12 }}
          >
            Where it was taken
          </a>
        )}
      </figcaption>
    </figure>
  )
}
