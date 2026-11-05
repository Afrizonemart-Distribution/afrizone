/**
 * The task form's "what to ask applicants" list. Each question has wording, a
 * kind of answer, and whether it must be answered. The server re-checks all of
 * it (services/taskQuestions.ts); this only makes it pleasant to write.
 */
import type { QuestionType, TaskQuestion } from '../api/types'
import Input from './ui/Input'
import Select from './ui/Select'
import Switch from './ui/Switch'
import Button from './ui/Button'

export const MAX_QUESTIONS = 15

const TYPE_OPTIONS: { value: QuestionType; label: string }[] = [
  { value: 'TEXT', label: 'Short answer' },
  { value: 'LONG_TEXT', label: 'Paragraph' },
  { value: 'YES_NO', label: 'Yes / No' },
  { value: 'CHOICE', label: 'Pick one' },
  { value: 'NUMBER', label: 'Number' },
  { value: 'LINK', label: 'Web link' },
]

const newId = () => `q_${Math.random().toString(36).slice(2, 9)}`

export function blankQuestion(): TaskQuestion {
  return { id: newId(), label: '', type: 'TEXT', required: true }
}

export default function QuestionsEditor({
  value,
  onChange,
}: {
  value: TaskQuestion[]
  onChange: (q: TaskQuestion[]) => void
}) {
  const patch = (i: number, p: Partial<TaskQuestion>) =>
    onChange(value.map((q, j) => (j === i ? { ...q, ...p } : q)))
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= value.length) return
    const next = [...value]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {value.length === 0 && (
        <p className="req-empty">
          No questions. Applicants send their profile and a short pitch, as now.
        </p>
      )}
      {value.map((q, i) => (
        <div key={q.id} className="reqblock" style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontWeight: 700, color: 'var(--muted)', width: 18 }}>{i + 1}</span>
            <Input
              aria-label={`Question ${i + 1}`}
              value={q.label}
              maxLength={200}
              onChange={(e) => patch(i, { label: e.target.value })}
              placeholder="e.g. Do you have a smartphone with a good camera?"
              required
            />
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', paddingLeft: 26 }}>
            <div style={{ minWidth: 160 }}>
              <Select
                ariaLabel={`Answer type for question ${i + 1}`}
                value={q.type}
                onChange={(v) =>
                  patch(i, {
                    type: v as QuestionType,
                    options: v === 'CHOICE' ? (q.options?.length ? q.options : ['', '']) : undefined,
                  })
                }
                options={TYPE_OPTIONS}
              />
            </div>
            <Switch
              checked={q.required}
              onChange={(v) => patch(i, { required: v })}
              label="Must answer"
            />
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Must answer</span>
            <span style={{ flex: 1 }} />
            <Button type="button" variant="glass" size="sm" onClick={() => move(i, -1)} disabled={i === 0}>
              Up
            </Button>
            <Button
              type="button"
              variant="glass"
              size="sm"
              onClick={() => move(i, 1)}
              disabled={i === value.length - 1}
            >
              Down
            </Button>
            <Button
              type="button"
              variant="glass"
              size="sm"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              Remove
            </Button>
          </div>
          {q.type === 'CHOICE' && (
            <div style={{ display: 'grid', gap: 6, paddingLeft: 26 }}>
              {(q.options ?? []).map((o, k) => (
                <div key={k} style={{ display: 'flex', gap: 8 }}>
                  <Input
                    aria-label={`Choice ${k + 1}`}
                    value={o}
                    maxLength={80}
                    onChange={(e) =>
                      patch(i, { options: (q.options ?? []).map((x, m) => (m === k ? e.target.value : x)) })
                    }
                    placeholder={`Choice ${k + 1}`}
                    required
                  />
                  {(q.options?.length ?? 0) > 2 && (
                    <Button
                      type="button"
                      variant="glass"
                      size="sm"
                      onClick={() => patch(i, { options: (q.options ?? []).filter((_, m) => m !== k) })}
                    >
                      ✕
                    </Button>
                  )}
                </div>
              ))}
              {(q.options?.length ?? 0) < 20 && (
                <div>
                  <Button
                    type="button"
                    variant="glass"
                    size="sm"
                    onClick={() => patch(i, { options: [...(q.options ?? []), ''] })}
                  >
                    + Add a choice
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
      {value.length < MAX_QUESTIONS && (
        <div>
          <Button type="button" variant="glass" icon="plus" onClick={() => onChange([...value, blankQuestion()])}>
            Add a question
          </Button>
        </div>
      )}
    </div>
  )
}
