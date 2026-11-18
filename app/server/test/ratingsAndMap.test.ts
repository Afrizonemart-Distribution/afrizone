// Two-way ratings (Blueprint §9) and the store network map (§8).
//
// The rating tests spend most of their effort on one thing: `Rating.workerId` is
// the worker in the engagement in BOTH directions, so a query that averages
// "ratings where workerId = X" now silently includes ratings X WROTE. That
// number is shown on a profile and used to rank people for work, and it going
// quietly wrong is much worse than it failing loudly.
//
// The map tests are about what is deliberately NOT in the payload, and about
// which nodes are excluded - an unapproved store on a courier's map is a wasted
// journey to a shop that cannot hand anything over.
import { describe, it, expect } from "vitest";
import { apiGet, apiPost } from "./http";
import { createUserWithToken, testPrisma } from "./helpers";

const prisma = () => testPrisma() as any;

let seq = 0;

async function makeTask(createdById: string) {
  seq += 1;
  return prisma().task.create({
    data: {
      title: `Rating task ${seq}`,
      description: "x",
      category: "Logistics",
      tier: "DISPATCH",
      payModel: "FIXED",
      budget: 10000,
      startDate: new Date(),
      endDate: new Date(Date.now() + 7 * 864e5),
      locationType: "PHYSICAL",
      slots: 1,
      status: "OPEN",
      deadline: new Date(Date.now() + 7 * 864e5),
      createdById,
    },
  });
}

/** A worker approved onto a task, with a contract at the given state. */
async function engagement(contractStatus = "PAID") {
  const admin = await createUserWithToken("SUPER_ADMIN");
  const worker = await createUserWithToken("WORKER");
  await prisma().user.update({ where: { id: worker.user.id }, data: { tiers: "DISPATCH" } });
  const task = await makeTask(admin.user.id);
  await prisma().application.create({
    data: { taskId: task.id, workerId: worker.user.id, status: "APPROVED" },
  });
  const contract = await prisma().contract.create({
    data: { taskId: task.id, workerId: worker.user.id, status: contractStatus },
  });
  return { admin, worker, task, contract };
}

describe("two-way ratings", () => {
  it("lets Afrizone rate the worker and the worker rate the job back", async () => {
    const { admin, worker, task } = await engagement();

    const ofWorker = await apiPost(
      `/api/workers/${worker.user.id}/rate`,
      { taskId: task.id, score: 5, note: "Reliable" },
      admin.token
    );
    expect(ofWorker.status).toBe(200);

    const ofExperience = await apiPost(
      "/api/me/ratings",
      { taskId: task.id, score: 4, note: "Clear brief" },
      worker.token
    );
    expect(ofExperience.status).toBe(201);

    // Both rows coexist on one engagement. The old unique constraint was
    // (workerId, taskId), which made the second a duplicate of the first - that
    // is the bug this feature had to remove.
    const rows = await prisma().rating.findMany({
      where: { taskId: task.id, workerId: worker.user.id },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r: any) => r.direction).sort()).toEqual(["OF_EXPERIENCE", "OF_WORKER"]);
  });

  it("never lets a rating the worker WROTE change their own score", async () => {
    const { admin, worker, task } = await engagement();

    // ORDER MATTERS, and getting it wrong makes this test prove nothing.
    // Only the admin route recomputes the aggregate, so the worker's own rating
    // has to already be in the table when that recompute runs. Rating the
    // worker first and the job second leaves the average untouched simply
    // because nothing recalculated it - the test passes either way.
    await apiPost("/api/me/ratings", { taskId: task.id, score: 1 }, worker.token);
    await apiPost(`/api/workers/${worker.user.id}/rate`, { taskId: task.id, score: 5 }, admin.token);

    const after = await prisma().user.findUnique({ where: { id: worker.user.id } });
    // Unfiltered this averages (1, 5) to 3: the Partimer's opinion of the job
    // silently halving their own standing.
    expect(after.rating).toBe(5);
    // And completedCount counts jobs they were rated ON, not jobs they rated.
    expect(after.completedCount).toBe(1);
  });

  it("keeps the average right across several jobs", async () => {
    const admin = await createUserWithToken("SUPER_ADMIN");
    const worker = await createUserWithToken("WORKER");
    await prisma().user.update({ where: { id: worker.user.id }, data: { tiers: "DISPATCH" } });

    for (const [score, ownScore] of [
      [4, 1],
      [2, 1],
    ] as const) {
      const task = await makeTask(admin.user.id);
      await prisma().application.create({
        data: { taskId: task.id, workerId: worker.user.id, status: "APPROVED" },
      });
      await prisma().contract.create({
        data: { taskId: task.id, workerId: worker.user.id, status: "PAID" },
      });
      await apiPost("/api/me/ratings", { taskId: task.id, score: ownScore }, worker.token);
      await apiPost(`/api/workers/${worker.user.id}/rate`, { taskId: task.id, score }, admin.token);
    }

    const after = await prisma().user.findUnique({ where: { id: worker.user.id } });
    // (4 + 2) / 2 = 3. Unfiltered it would be (4 + 2 + 1 + 1) / 4 = 2.
    expect(after.rating).toBe(3);
    expect(after.completedCount).toBe(2);
  });

  it("shows a worker only the ratings of them, not the ones they wrote", async () => {
    const { admin, worker, task } = await engagement();
    await apiPost(`/api/workers/${worker.user.id}/rate`, { taskId: task.id, score: 5 }, admin.token);
    await apiPost("/api/me/ratings", { taskId: task.id, score: 2 }, worker.token);

    const mine = await apiGet("/api/me/ratings", worker.token);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].score).toBe(5);
  });

  it("closes the engagement once both sides have rated", async () => {
    const { admin, worker, task, contract } = await engagement("PAID");

    await apiPost(`/api/workers/${worker.user.id}/rate`, { taskId: task.id, score: 5 }, admin.token);
    // One side is not "exchanged".
    let row = await prisma().contract.findUnique({ where: { id: contract.id } });
    expect(row.status).toBe("PAID");

    const res = await apiPost("/api/me/ratings", { taskId: task.id, score: 4 }, worker.token);
    expect(res.body.contractClosed).toBe(true);

    // Blueprint §4.2: Closed means "ratings exchanged". Closing is what the
    // second rating MEANS, not a button somebody has to remember.
    row = await prisma().contract.findUnique({ where: { id: contract.id } });
    expect(row.status).toBe("CLOSED");
  });

  it("will not close an engagement that has not been paid", async () => {
    const { admin, worker, task, contract } = await engagement("VERIFIED");
    await apiPost(`/api/workers/${worker.user.id}/rate`, { taskId: task.id, score: 5 }, admin.token);
    await apiPost("/api/me/ratings", { taskId: task.id, score: 5 }, worker.token);

    // Money is still outstanding. Calling this finished would hide an unpaid
    // worker behind a tidy status.
    const row = await prisma().contract.findUnique({ where: { id: contract.id } });
    expect(row.status).toBe("VERIFIED");
  });

  it("refuses a rating for work that has not been approved yet", async () => {
    const { worker, task } = await engagement("IN_PROGRESS");
    const res = await apiPost("/api/me/ratings", { taskId: task.id, score: 5 }, worker.token);
    expect(res.status).toBe(400);
    // Rating a job on the morning you started it is not feedback about the job.
    expect(res.body.error).toContain("approved");
  });

  it("refuses a rating from somebody who was never given the task", async () => {
    const { task } = await engagement();
    const outsider = await createUserWithToken("WORKER");
    const res = await apiPost("/api/me/ratings", { taskId: task.id, score: 5 }, outsider.token);
    // Otherwise anyone could rate any job they had merely seen.
    expect([403, 404]).toContain(res.status);
  });

  it("lets a rating be changed rather than duplicated", async () => {
    const { worker, task } = await engagement();
    await apiPost("/api/me/ratings", { taskId: task.id, score: 2 }, worker.token);
    await apiPost("/api/me/ratings", { taskId: task.id, score: 5 }, worker.token);
    const rows = await prisma().rating.findMany({
      where: { taskId: task.id, direction: "OF_EXPERIENCE" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].score).toBe(5);
  });

  it("rejects a score outside 1-5", async () => {
    const { worker, task } = await engagement();
    for (const bad of [0, 6, 2.5, -1, "five"]) {
      const res = await apiPost("/api/me/ratings", { taskId: task.id, score: bad }, worker.token);
      expect(res.status).toBe(400);
    }
  });
});

describe("the store network map", () => {
  async function makeOrg(
    status = "ACTIVE",
    lat: number | null = 6.6018,
    lng: number | null = 3.3515,
    kind = "STORE"
  ) {
    seq += 1;
    return prisma().organization.create({
      data: { kind, name: `Node ${seq}`, slug: `node-${seq}-${Date.now()}`, status, lat, lng },
    });
  }

  it("shows approved stores to any signed-in worker", async () => {
    const shop = await makeOrg("ACTIVE");
    const { token } = await createUserWithToken("WORKER");

    const res = await apiGet("/api/organizations/map", token);
    expect(res.status).toBe(200);
    // Not gated on membership: a network map only a store's own staff could see
    // would be useless to the couriers it exists for.
    expect(res.body.nodes.some((n: any) => n.id === shop.id)).toBe(true);
  });

  it("keeps unapproved and suspended stores off it", async () => {
    const pending = await makeOrg("PENDING");
    const suspended = await makeOrg("SUSPENDED");
    const { token } = await createUserWithToken("WORKER");

    const res = await apiGet("/api/organizations/map", token);
    const ids = res.body.nodes.map((n: any) => n.id);
    // Either would send a courier to a shop that cannot hand anything over.
    expect(ids).not.toContain(pending.id);
    expect(ids).not.toContain(suspended.id);
  });

  it("leaves out anything with no usable coordinates, and counts it", async () => {
    const placed = await makeOrg("ACTIVE", 6.6, 3.35);
    const noCoords = await makeOrg("ACTIVE", null, null);
    // 0,0 is in the Gulf of Guinea and is almost always a coerced empty value.
    const nullIsland = await makeOrg("ACTIVE", 0, 0);
    const { token } = await createUserWithToken("WORKER");

    const res = await apiGet("/api/organizations/map", token);
    const ids = res.body.nodes.map((n: any) => n.id);
    expect(ids).toContain(placed.id);
    expect(ids).not.toContain(noCoords.id);
    expect(ids).not.toContain(nullIsland.id);
    // Reported rather than silently dropped, so an admin can tell "not approved"
    // from "nobody set the address".
    expect(res.body.unplaced).toBeGreaterThanOrEqual(2);
  });

  it("never leaks payout details or members", async () => {
    await prisma().organization.create({
      data: {
        kind: "STORE",
        name: "Rich Node",
        slug: `rich-${Date.now()}`,
        status: "ACTIVE",
        lat: 6.6,
        lng: 3.35,
        bankAccountNumber: "0123456789",
        bankMasked: "****6789",
        phone: "+2348030000999",
      },
    });
    const { token } = await createUserWithToken("WORKER");
    const res = await apiGet("/api/organizations/map", token);
    const node = res.body.nodes.find((n: any) => n.name === "Rich Node");

    // The payload is exactly what somebody needs to travel to a place.
    expect(node.bankAccountNumber).toBeUndefined();
    expect(node.bankMasked).toBeUndefined();
    expect(node.phone).toBeUndefined();
    expect(node.members).toBeUndefined();
    expect(node.name).toBe("Rich Node");
    expect(node.lat).toBe(6.6);
  });

  it("sorts by distance and says how far, when given a point", async () => {
    const near = await makeOrg("ACTIVE", 6.6018, 3.3515);
    const far = await makeOrg("ACTIVE", 6.4531, 3.3958); // ~17km south
    const { token } = await createUserWithToken("WORKER");

    const res = await apiGet("/api/organizations/map?lat=6.6018&lng=3.3515", token);
    const ids = res.body.nodes.map((n: any) => n.id);
    expect(ids.indexOf(near.id)).toBeLessThan(ids.indexOf(far.id));

    const nearNode = res.body.nodes.find((n: any) => n.id === near.id);
    expect(nearNode.distanceMetres).toBeLessThan(100);
    expect(nearNode.distance).toMatch(/m$/);
  });

  it("honours a radius", async () => {
    const near = await makeOrg("ACTIVE", 6.6018, 3.3515);
    const far = await makeOrg("ACTIVE", 6.4531, 3.3958);
    const { token } = await createUserWithToken("WORKER");

    const res = await apiGet("/api/organizations/map?lat=6.6018&lng=3.3515&radius=5000", token);
    const ids = res.body.nodes.map((n: any) => n.id);
    expect(ids).toContain(near.id);
    expect(ids).not.toContain(far.id);
  });

  it("reports no distance at all when given nowhere to measure from", async () => {
    await makeOrg("ACTIVE");
    const { token } = await createUserWithToken("WORKER");
    const res = await apiGet("/api/organizations/map", token);
    // "Nearest to nowhere" is not an order, so the list stays alphabetical and
    // distance is null rather than zero - zero would read as "you are here".
    expect(res.body.nodes[0].distanceMetres).toBeNull();
    expect(res.body.nodes[0].distance).toBeNull();
  });

  it("can show courier companies instead of stores", async () => {
    const courierCo = await makeOrg("ACTIVE", 6.6, 3.34, "COURIER");
    const { token } = await createUserWithToken("WORKER");

    const stores = await apiGet("/api/organizations/map?kind=STORE", token);
    expect(stores.body.nodes.some((n: any) => n.id === courierCo.id)).toBe(false);
    const couriers = await apiGet("/api/organizations/map?kind=COURIER", token);
    expect(couriers.body.nodes.some((n: any) => n.id === courierCo.id)).toBe(true);
  });

  it("needs a signed-in user", async () => {
    expect((await apiGet("/api/organizations/map")).status).toBe(401);
  });

  it("is not swallowed by the /:id route", async () => {
    // Express matches in declaration order. With /map declared after /:id this
    // request reads as an organization whose id is "map" and 404s, and the
    // symptom is "the map endpoint does not exist".
    const { token } = await createUserWithToken("WORKER");
    const res = await apiGet("/api/organizations/map", token);
    expect(res.status).toBe(200);
    expect(res.body.nodes).toBeDefined();
  });
});
