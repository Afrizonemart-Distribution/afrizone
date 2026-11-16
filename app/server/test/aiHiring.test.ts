// AI hiring helpers. The model itself isn't called in tests (no key): what is
// tested is everything around it - nothing identifying is sent, answers are
// checked before they touch an application, a draft is cleaned before a worker
// sees it, saving a draft goes through the normal profile checks, and with no
// key the routes say so instead of failing.
import { describe, it, expect } from "vitest";
import { apiPost } from "./http";
import { createUserWithToken } from "./helpers";
import { applicantBrief, checkScores, cleanCvDraft, type ApplicantFacts } from "../src/services/ai";

const facts: ApplicantFacts = {
  id: "app_123",
  headline: "Store supervisor",
  bio: "I run busy shop floors.",
  experience: [
    { title: "Supervisor", company: "ShopRite", startDate: "2021-02-01", endDate: null, description: "Team of 12" },
  ],
  education: [{ qualification: "HND", field: "Business", institution: "Yaba College of Technology", endYear: 2019 }],
  skills: ["Stock control"],
  verifiedCredentials: ["Food hygiene"],
  workRecord: { paidTasks: 4, rating: 4.6 },
  coverNote: "I want to grow with AfriZone.",
};

describe("AI helpers", () => {
  it("sends work facts only, under a reference, never our ids", () => {
    const brief = applicantBrief("A1", facts);
    expect(brief).toContain('ref="A1"');
    expect(brief).toContain("Supervisor at ShopRite (2021-02 to now)");
    expect(brief).toContain("4 paid task(s), rated 4.6/5");
    expect(brief).not.toContain("app_123");
  });

  it("drops unknown or repeated refs and clamps scores before they reach an application", () => {
    const refs = new Map([
      ["A1", "app_1"],
      ["A2", "app_2"],
    ]);
    const out = checkScores(
      [
        { ref: "A1", score: 140, summary: "Strong", strengths: ["a", "b", "c", "d"], gaps: [] },
        { ref: "A1", score: 10, summary: "duplicate", strengths: [], gaps: [] },
        { ref: "A9", score: 90, summary: "made up", strengths: [], gaps: [] },
        { ref: " A2 ", score: -5, summary: "Thin profile", strengths: [], gaps: ["No retail work"] },
      ],
      refs
    );
    expect(out).toEqual([
      { id: "app_1", score: 100, summary: "Strong", strengths: ["a", "b", "c"], gaps: [] },
      { id: "app_2", score: 0, summary: "Thin profile", strengths: [], gaps: ["No retail work"] },
    ]);
  });

  it("cleans a CV draft: incomplete entries out, bad dates and years blanked", () => {
    const d = cleanCvDraft({
      headline: "  Cashier  ",
      bio: "",
      experience: [
        { title: "Cashier", company: "Spar", location: "", startDate: "2020-13", endDate: "2022-06", description: "" },
        { title: "", company: "Nobody", location: "", startDate: "", endDate: "", description: "" },
      ],
      education: [{ institution: "UNILAG", qualification: "B.Sc", field: "", startYear: 0, endYear: 2018 }],
      skills: ["Cash handling", "Cash handling", ""],
    });
    expect(d.headline).toBe("Cashier");
    expect(d.experience).toEqual([
      { title: "Cashier", company: "Spar", location: "", startDate: "", endDate: "2022-06", description: "" },
    ]);
    expect(d.education[0]).toMatchObject({ startYear: null, endYear: 2018 });
    expect(d.skills).toEqual(["Cash handling"]);
  });
});

describe("AI hiring routes", () => {
  it("say the AI is off when there is no key, instead of failing", async () => {
    const w = await createUserWithToken("WORKER");
    const hr = await createUserWithToken("HR_ADMIN");
    const read = await apiPost("/api/me/profile/cv/read", {}, w.token);
    expect(read.status).toBe(503);
    expect(read.body.code).toBe("AI_OFF");
    const job = await apiPost(
      "/api/jobs",
      { title: "Cashier", department: "Retail", location: "Lagos", employmentType: "FULL_TIME", description: "Tills" },
      hr.token
    );
    const rank = await apiPost(`/api/jobs/${job.body.id}/shortlist`, {}, hr.token);
    expect(rank.body.code).toBe("AI_OFF");
    // Workers can't rank applicants.
    expect((await apiPost(`/api/jobs/${job.body.id}/shortlist`, {}, w.token)).status).toBe(403);
  });

  it("saves a reviewed draft through the normal checks, skipping only the bad entries", async () => {
    const w = await createUserWithToken("WORKER");
    const r = await apiPost(
      "/api/me/profile/cv/import",
      {
        headline: "Retail supervisor",
        experience: [
          { title: "Supervisor", company: "ShopRite", startDate: "2021-02", endDate: "" },
          { title: "Cashier", company: "Spar", startDate: "" },
        ],
        education: [{ institution: "UNILAG", qualification: "B.Sc", endYear: 2018 }],
      },
      w.token
    );
    expect(r.status).toBe(200);
    expect(r.body.added).toEqual({ experience: 1, education: 1 });
    expect(r.body.skipped).toEqual([{ section: "experience", index: 1, error: "startDate is required" }]);
    expect(r.body.profile.headline).toBe("Retail supervisor");
    expect(r.body.profile.experience[0].company).toBe("ShopRite");
  });
});
