import { describe, it, expect } from "vitest";
import { apiGet, apiPost } from "./http";
import { createUserWithToken } from "./helpers";
import { isAllowed } from "../src/routes/staffWorkspace";

/**
 * My HR in the Part Time console (2026-11-25): staff only, My HR paths only,
 * and only for an account that has proved its email.
 */

describe("console My HR relay", () => {
  it("is staff only", async () => {
    const { token } = await createUserWithToken("WORKER");
    expect((await apiGet("/api/admin/my-hr", token)).status).toBe(403);
  });

  it("only relays My HR paths", async () => {
    const { token } = await createUserWithToken("TASK_MANAGER");
    expect((await apiGet("/api/admin/my-hr/tasks", token)).status).toBe(404);
    expect((await apiPost("/api/admin/my-hr/payslips", {}, token)).status).toBe(404);
    expect(isAllowed("GET", "hr")).toBe(true);
    expect(isAllowed("GET", "hr/payslips")).toBe(true);
    expect(isAllowed("GET", "tasks")).toBe(true); // staff workspace path, never reachable as hr/tasks
    expect(isAllowed("GET", "hr/tasks")).toBe(false);
  });

  it("an account that never set its password can't use it", async () => {
    // createUserWithToken makes accounts with no password and no Google.
    const { token } = await createUserWithToken("HR_ADMIN");
    const res = await apiGet("/api/admin/my-hr/leave", token);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("EMAIL_NOT_PROVEN");
  });
});
