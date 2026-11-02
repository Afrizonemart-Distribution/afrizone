import { describe, it, expect } from "vitest";
import { apiGet, apiPatch, apiPost, apiDelete } from "./http";
import { testPrisma, createUserWithToken } from "./helpers";

/**
 * Talent Profile (services/talentProfile.ts, routes/meProfile.ts,
 * routes/publicProfiles.ts). Kept to a handful of flows: the D1 pool hangs
 * past roughly five per file.
 */

let n = 0;
const uniq = () => `${Date.now()}${++n}`;

describe("Talent Profile", () => {
  it("edits the profile and every section, scoped to the owner", async () => {
    const { token } = await createUserWithToken("WORKER");

    const p = await apiPatch(
      "/api/me/profile",
      { headline: "  Product photographer ", bio: "Lagos-based.", openTo: ["TASKS", "FULL_TIME"] },
      token
    );
    expect(p.status).toBe(200);
    expect(p.body.headline).toBe("Product photographer");
    expect(p.body.openTo).toEqual(["TASKS", "FULL_TIME"]);
    expect((await apiPatch("/api/me/profile", { openTo: ["NAPPING"] }, token)).status).toBe(400);

    const exp = await apiPost(
      "/api/me/experience",
      { title: "Photographer", company: "Studio 9", startDate: "2022-01-01" },
      token
    );
    expect(exp.status).toBe(201);
    const expId = exp.body.experience[0].id;
    expect(exp.body.experience[0].endDate).toBeNull();
    expect(
      (await apiPost("/api/me/experience", { title: "X", company: "Y", startDate: "2022-01-01", endDate: "2021-01-01" }, token)).status
    ).toBe(400);

    const edu = await apiPost("/api/me/education", { institution: "UNILAG", qualification: "BSc", endYear: 2021 }, token);
    expect(edu.status).toBe(201);
    expect(edu.body.education[0].qualification).toBe("BSc");

    // A javascript: link on a shared profile would attack whoever opens it.
    expect((await apiPost("/api/me/portfolio", { title: "Shoot", url: "javascript:alert(1)" }, token)).status).toBe(400);
    expect((await apiPost("/api/me/portfolio", { title: "Shoot" }, token)).status).toBe(400);
    const port = await apiPost("/api/me/portfolio", { title: "Shoot", url: "https://example.com/work" }, token);
    expect(port.status).toBe(201);

    // Another worker can neither edit nor delete it.
    const { token: other } = await createUserWithToken("WORKER");
    expect((await apiPatch(`/api/me/experience/${expId}`, { title: "Hijacked" }, other)).status).toBe(404);
    expect((await apiDelete(`/api/me/experience/${expId}`, other)).status).toBe(404);

    const edited = await apiPatch(`/api/me/experience/${expId}`, { endDate: "2024-06-01" }, token);
    expect(edited.status).toBe(200);
    expect(edited.body.experience[0].endDate).toContain("2024-06-01");
    const gone = await apiDelete(`/api/me/experience/${expId}`, token);
    expect(gone.body.experience).toHaveLength(0);
  });

  it("only accepts the worker's own CV file", async () => {
    const { user, token } = await createUserWithToken("WORKER");
    const { user: other } = await createUserWithToken("WORKER");
    const mine = await testPrisma().kycDocument.create({
      data: { userId: user.id, docType: "CV", filename: `cv-${uniq()}.pdf`, path: "x", originalName: "cv.pdf" },
    });
    const theirs = await testPrisma().kycDocument.create({
      data: { userId: other.id, docType: "CV", filename: `cv-${uniq()}.pdf`, path: "x" },
    });
    const id = await testPrisma().kycDocument.create({
      data: { userId: user.id, docType: "ID", filename: `id-${uniq()}.jpg`, path: "x" },
    });

    expect((await apiPatch("/api/me/profile", { cvDocumentId: theirs.id }, token)).status).toBe(400);
    expect((await apiPatch("/api/me/profile", { cvDocumentId: id.id }, token)).status).toBe(400);
    const ok = await apiPatch("/api/me/profile", { cvDocumentId: mine.id }, token);
    expect(ok.status).toBe(200);
    expect(ok.body.cv.name).toBe("cv.pdf");
  });

  it("shares by link with the public cut only, and hides private profiles", async () => {
    const { user, token } = await createUserWithToken("WORKER", { name: "Ada Obi" });
    const type = await testPrisma().credentialType.create({
      data: { name: "Test licence", slug: `lic-${uniq()}` },
    });
    await testPrisma().credential.create({
      data: { workerId: user.id, credentialTypeId: type.id, title: "Checked one", status: "VERIFIED" },
    });
    await testPrisma().credential.create({
      data: { workerId: user.id, credentialTypeId: type.id, title: "Unchecked one", status: "PENDING" },
    });

    const shared = await apiPatch("/api/me/profile", { visibility: "LINK", headline: "Driver" }, token);
    const slug = shared.body.slug as string;
    expect(slug).toMatch(/^ada-obi-[a-z0-9]+$/);

    const pub = await apiGet(`/api/public/profiles/${slug}`);
    expect(pub.status).toBe(200);
    expect(pub.body.headline).toBe("Driver");
    expect(pub.body.email).toBeUndefined();
    expect(pub.body.id).toBeUndefined();
    expect(pub.body.cv).toBeUndefined();
    expect(pub.body.credentials.map((c: any) => c.title)).toEqual(["Checked one"]);
    expect(pub.body.workRecord.paidTasks).toBe(0);

    // Back to private: the same link now answers exactly like an unknown one.
    await apiPatch("/api/me/profile", { visibility: "PRIVATE" }, token);
    expect((await apiGet(`/api/public/profiles/${slug}`)).status).toBe(404);
    expect((await apiGet(`/api/public/profiles/nobody-${uniq()}`)).status).toBe(404);
    // Sharing again reuses the slug: a link once sent never points at someone else.
    const again = await apiPatch("/api/me/profile", { visibility: "LINK" }, token);
    expect(again.body.slug).toBe(slug);
  });

  it("gives staff the full profile and refuses it to workers", async () => {
    const { user } = await createUserWithToken("WORKER");
    const { token: hr } = await createUserWithToken("HR_ADMIN");
    const { token: worker } = await createUserWithToken("WORKER");

    const staff = await apiGet(`/api/workers/${user.id}/profile`, hr);
    expect(staff.status).toBe(200);
    expect(staff.body.talent.email).toBe(user.email);
    expect(staff.body.skills).toBeDefined(); // the existing payload is untouched
    expect((await apiGet(`/api/workers/${user.id}/profile`, worker)).status).toBe(403);
  });
});
