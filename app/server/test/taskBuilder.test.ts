import { describe, it, expect } from "vitest";
import { apiDelete, apiGet, apiPatch, apiPost } from "./http";
import { createUserWithToken, testPrisma } from "./helpers";

/**
 * Flexible task builder: inline categories, application questions and
 * templates. A handful of flows only: the D1 pool hangs past about five.
 */

let n = 0;
const uniq = () => `${Date.now()}${++n}`;

const baseTask = (extra: Record<string, unknown> = {}) => ({
  title: "Shelf photos",
  description: "Photograph every shelf",
  tier: "REMOTE",
  payModel: "FIXED",
  budget: 5000,
  slots: 3,
  deadline: new Date(Date.now() + 86_400_000).toISOString(),
  ...extra,
});

describe("task builder", () => {
  it("creates a category typed in the task form, once, whatever the spelling", async () => {
    const { token } = await createUserWithToken("TASK_MANAGER");
    const name = `Mystery shopping ${uniq()}`;

    const a = await apiPost("/api/tasks", baseTask({ category: `  ${name} ` }), token);
    expect(a.status).toBe(201);
    expect(a.body.category).toBe(name);

    const b = await apiPost("/api/tasks", baseTask({ category: name.toUpperCase().replace(" ", "   ") }), token);
    expect(b.status).toBe(201);
    // Saved under the existing spelling, not as a second category.
    expect(b.body.category).toBe(name);
    const rows = (await testPrisma().category.findMany()).filter((c) => c.name.toLowerCase() === name.toLowerCase());
    expect(rows).toHaveLength(1);

    expect((await apiPost("/api/tasks", baseTask({ category: "x".repeat(61) }), token)).status).toBe(400);
  });

  it("validates questions and returns them as a list", async () => {
    const { token } = await createUserWithToken("SUPER_ADMIN");
    const bad = await apiPost(
      "/api/tasks",
      baseTask({ category: "Photos", questions: [{ label: "Pick one", type: "CHOICE", options: ["only"] }] }),
      token
    );
    expect(bad.status).toBe(400);

    const ok = await apiPost(
      "/api/tasks",
      baseTask({
        category: "Photos",
        questions: [
          { label: "Do you own a phone with a good camera?", type: "YES_NO", required: true },
          { label: "Which area?", type: "CHOICE", options: ["Yaba", "Ikeja"], required: true },
          { label: "Sample work", type: "LINK" },
        ],
      }),
      token
    );
    expect(ok.status).toBe(201);
    expect(ok.body.questions).toHaveLength(3);
    expect(ok.body.questions[0].id).toBeTruthy();

    const got = await apiGet(`/api/tasks/${ok.body.id}`, token);
    expect(Array.isArray(got.body.questions)).toBe(true);
    expect(got.body.questions[1].options).toEqual(["Yaba", "Ikeja"]);
  });

  it("makes applicants answer, and keeps the wording they answered", async () => {
    const { token: admin } = await createUserWithToken("SUPER_ADMIN");
    const { user: w, token: worker } = await createUserWithToken("WORKER");
    await testPrisma().user.update({ where: { id: w.id }, data: { tiers: "REMOTE", kycStatus: "VERIFIED" } });
    const t = await apiPost(
      "/api/tasks",
      baseTask({
        category: "Photos",
        questions: [
          { id: "cam", label: "Good camera?", type: "YES_NO", required: true },
          { id: "area", label: "Which area?", type: "CHOICE", options: ["Yaba", "Ikeja"], required: true },
          { id: "link", label: "Sample work", type: "LINK" },
        ],
      }),
      admin
    );
    const taskId = t.body.id;

    const missing = await apiPost("/api/applications", { taskId, answers: { cam: true } }, worker);
    expect(missing.status).toBe(400);
    expect(missing.body.error).toContain("Which area?");

    const badLink = await apiPost(
      "/api/applications",
      { taskId, answers: { cam: true, area: "Yaba", link: "javascript:alert(1)" } },
      worker
    );
    expect(badLink.status).toBe(400);

    const badChoice = await apiPost("/api/applications", { taskId, answers: { cam: true, area: "Lekki" } }, worker);
    expect(badChoice.status).toBe(400);

    const ok = await apiPost(
      "/api/applications",
      { taskId, answers: { cam: false, area: "Ikeja", stray: "dropped" } },
      worker
    );
    expect(ok.status).toBe(201);
    expect(ok.body.answers.map((a: any) => [a.id, a.answer])).toEqual([
      ["cam", false],
      ["area", "Ikeja"],
    ]);

    // Rewording the question later does not rewrite the answer's wording.
    await apiPatch(`/api/tasks/${taskId}`, { questions: [{ id: "area", label: "Area now", type: "TEXT" }] }, admin);
    const list = await apiGet(`/api/applications?taskId=${taskId}`, admin);
    expect(list.body[0].answers[1].label).toBe("Which area?");
  });

  it("saves, lists, edits and archives templates, staff only", async () => {
    const { token } = await createUserWithToken("TASK_MANAGER");
    const { token: worker } = await createUserWithToken("WORKER");
    const name = `Weekly stock count ${uniq()}`;

    expect((await apiGet("/api/task-templates", worker)).status).toBe(403);

    const c = await apiPost(
      "/api/task-templates",
      { name, payload: { title: "Stock count", category: "Audit", budget: 3000, evil: "dropped", createdById: "x" } },
      token
    );
    expect(c.status).toBe(201);
    expect(c.body.payload).toEqual({ title: "Stock count", category: "Audit", budget: 3000 });

    expect(
      (await apiPost("/api/task-templates", { name: "Bad", payload: { questions: [{ label: "", type: "TEXT" }] } }, token)).status
    ).toBe(400);

    const e = await apiPatch(`/api/task-templates/${c.body.id}`, { name: `${name} v2` }, token);
    expect(e.body.name).toBe(`${name} v2`);

    expect((await apiDelete(`/api/task-templates/${c.body.id}`, token)).status).toBe(204);
    const list = await apiGet("/api/task-templates", token);
    expect(list.body.some((t: any) => t.id === c.body.id)).toBe(false);
  });
});
