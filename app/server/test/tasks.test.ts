import { describe, it, expect } from "vitest";
import { apiGet, apiPost } from "./http";
import { createUserWithToken } from "./helpers";

describe("tasks", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await apiGet("/api/tasks");
    expect(res.status).toBe(401);
  });

  it("creates a task then lists and fetches it", async () => {
    const { token } = await createUserWithToken("SUPER_ADMIN");

    const create = await apiPost(
      "/api/tasks",
      {
        title: "Same-day parcel run",
        description: "Deliver parcels around Yaba",
        category: "Dispatch",
        tier: "DISPATCH",
        payModel: "FIXED",
        budget: 15000,
        slots: 2,
      },
      token
    );
    expect(create.status).toBe(201);
    expect(create.body.id).toBeDefined();
    expect(create.body.filledCount).toBe(0);
    expect(create.body.applicantCount).toBe(0);

    const list = await apiGet("/api/tasks", token);
    expect(list.status).toBe(200);
    expect(list.body.some((t: any) => t.id === create.body.id)).toBe(true);

    const get = await apiGet(`/api/tasks/${create.body.id}`, token);
    expect(get.status).toBe(200);
    expect(get.body.title).toBe("Same-day parcel run");
  });

  it("rejects a task missing required fields", async () => {
    const { token } = await createUserWithToken("SUPER_ADMIN");
    const res = await apiPost("/api/tasks", { title: "Missing stuff" }, token);
    expect(res.status).toBe(400);
  });

  it("rejects an HOURLY task with no rate and a FIXED task with no budget", async () => {
    const { token } = await createUserWithToken("SUPER_ADMIN");
    const base = {
      title: "Bad pay model",
      description: "desc",
      category: "Promo",
      tier: "STUDENT",
    };

    const hourly = await apiPost("/api/tasks", { ...base, payModel: "HOURLY" }, token);
    expect(hourly.status).toBe(400);

    const fixed = await apiPost("/api/tasks", { ...base, payModel: "FIXED" }, token);
    expect(fixed.status).toBe(400);
  });

  it("404s for a task id that doesn't exist", async () => {
    const { token } = await createUserWithToken("SUPER_ADMIN");
    const res = await apiGet("/api/tasks/does-not-exist", token);
    expect(res.status).toBe(404);
  });
});
