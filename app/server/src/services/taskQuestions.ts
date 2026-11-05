/**
 * Application questions: what a task asks an applicant beyond the usual
 * pitch. Written by an admin in the task form, answered in the app, read by
 * whoever reviews the applications.
 *
 * Stored as JSON text on Task.questions; answers on Application.answers carry
 * a copy of each question's wording, so a question edited after people have
 * applied never changes what they were shown.
 */

export const QUESTION_TYPES = ["TEXT", "LONG_TEXT", "NUMBER", "YES_NO", "CHOICE", "LINK"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export interface TaskQuestion {
  id: string;
  label: string;
  type: QuestionType;
  required: boolean;
  /** CHOICE only. */
  options?: string[];
}

export interface Answer {
  id: string;
  label: string;
  type: QuestionType;
  answer: string | number | boolean;
}

export const MAX_QUESTIONS = 15;
const MAX_LABEL = 200;
const MAX_OPTIONS = 20;
const MAX_OPTION = 80;
const TEXT_LIMIT: Record<QuestionType, number> = {
  TEXT: 500,
  LONG_TEXT: 3000,
  LINK: 500,
  NUMBER: 0,
  YES_NO: 0,
  CHOICE: 0,
};

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Validate the questions an admin sent. Ids are kept when they are sane (so
 * an edit keeps matching earlier answers) and minted when missing.
 */
export function parseQuestions(raw: unknown): Result<TaskQuestion[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "questions must be a list" };
  if (raw.length > MAX_QUESTIONS) return { ok: false, error: `At most ${MAX_QUESTIONS} questions` };

  const out: TaskQuestion[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const q = raw[i] ?? {};
    const n = i + 1;
    const label = typeof q.label === "string" ? q.label.trim().replace(/\s+/g, " ") : "";
    if (!label) return { ok: false, error: `Question ${n} needs wording` };
    if (label.length > MAX_LABEL) return { ok: false, error: `Question ${n} is too long` };
    if (!QUESTION_TYPES.includes(q.type)) return { ok: false, error: `Question ${n} has an unknown type` };

    let id = typeof q.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(q.id) ? q.id : "";
    if (!id || seen.has(id)) id = `q${n}_${Math.random().toString(36).slice(2, 8)}`;
    seen.add(id);

    const question: TaskQuestion = { id, label, type: q.type, required: q.required === true };
    if (q.type === "CHOICE") {
      const options: string[] = Array.isArray(q.options)
        ? [
            ...new Set<string>(
              q.options
                .filter((o: unknown): o is string => typeof o === "string")
                .map((o: string) => o.trim())
                .filter(Boolean)
            ),
          ]
        : [];
      if (options.length < 2) return { ok: false, error: `Question ${n} needs at least two choices` };
      if (options.length > MAX_OPTIONS) return { ok: false, error: `Question ${n} has too many choices` };
      if (options.some((o) => o.length > MAX_OPTION)) return { ok: false, error: `A choice in question ${n} is too long` };
      question.options = options;
    }
    out.push(question);
  }
  return { ok: true, value: out };
}

/** Task.questions as stored -> the list. A corrupt value reads as no questions. */
export function readQuestions(stored: string | null | undefined): TaskQuestion[] {
  if (!stored) return [];
  try {
    const v = JSON.parse(stored);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function readAnswers(stored: string | null | undefined): Answer[] {
  if (!stored) return [];
  try {
    const v = JSON.parse(stored);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

const isLink = (s: string) => {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
};

/**
 * Check an applicant's answers ({questionId: value}) against the task's
 * questions. Answers to questions the task does not ask are dropped; a
 * required question left blank is refused with its wording in the message.
 */
export function validateAnswers(questions: TaskQuestion[], raw: unknown): Result<Answer[]> {
  const given = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Answer[] = [];
  for (const q of questions) {
    let v = given[q.id];
    if (typeof v === "string") v = v.trim();
    const blank = v === undefined || v === null || v === "";
    if (blank) {
      if (q.required) return { ok: false, error: `Please answer: ${q.label}` };
      continue;
    }
    const bad = { ok: false as const, error: `Check your answer to: ${q.label}` };
    switch (q.type) {
      case "TEXT":
      case "LONG_TEXT":
      case "LINK": {
        if (typeof v !== "string" || v.length > TEXT_LIMIT[q.type]) return bad;
        if (q.type === "LINK" && !isLink(v)) return { ok: false, error: `Use a full web link (https://...) for: ${q.label}` };
        out.push({ id: q.id, label: q.label, type: q.type, answer: v });
        break;
      }
      case "NUMBER": {
        const num = typeof v === "number" ? v : Number(v);
        if (!Number.isFinite(num)) return bad;
        out.push({ id: q.id, label: q.label, type: q.type, answer: num });
        break;
      }
      case "YES_NO": {
        if (typeof v !== "boolean") return bad;
        out.push({ id: q.id, label: q.label, type: q.type, answer: v });
        break;
      }
      case "CHOICE": {
        if (typeof v !== "string" || !q.options?.includes(v)) return bad;
        out.push({ id: q.id, label: q.label, type: q.type, answer: v });
        break;
      }
    }
  }
  return { ok: true, value: out };
}
