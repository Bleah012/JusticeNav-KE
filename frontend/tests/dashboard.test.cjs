const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const ts = require("typescript");
const cache = new Map();
function load(relative) {
  const file = path.resolve(__dirname, "../src", relative);
  if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: {} };
  cache.set(file, mod);
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  vm.runInNewContext(
    code,
    {
      module: mod,
      exports: mod.exports,
      require: (name) => {
        if (!name.startsWith(".")) throw Error("Unexpected import");
        return load(
          path.relative(
            path.join(__dirname, "../src"),
            path.resolve(path.dirname(file), name + ".ts"),
          ),
        );
      },
      URL,
      Date,
      Intl,
      AbortController,
      setTimeout,
      clearTimeout,
      fetch: () => {
        throw Error("Live fetch forbidden");
      },
    },
    { filename: file },
  );
  return mod.exports;
}

const { createDashboardApi, parseDashboard, DashboardError, activityLink } =
  load("dashboard/dashboardApi.ts");
const { DashboardResource } = load("dashboard/DashboardResource.ts");
const ID = "a".repeat(32),
  CHECK = "b".repeat(32),
  REF = "c".repeat(32),
  UID = "owner";
const stamp = "2026-11-04T09:00:00.123456Z",
  later = "2026-11-04T09:01:00Z";
const full = () => ({
  uid: UID,
  counts: { assessments: 101, checklists: 2, referrals: 1 },
  latestChecklist: {
    id: CHECK,
    pathwayTitle: "Published pathway",
    completedItems: 1,
    totalItems: 3,
    status: "in-progress",
    revision: 2,
    createdAt: stamp,
    updatedAt: stamp,
  },
  latestReferral: {
    id: REF,
    serviceName: "Published service",
    pathwayTitle: "Published pathway",
    savedAt: stamp,
    status: "saved",
    deliveryStatus: "not-sent",
  },
  activity: [
    { kind: "referral", id: REF, occurredAt: stamp, assessmentStatus: null },
    { kind: "checklist", id: CHECK, occurredAt: stamp, assessmentStatus: null },
    {
      kind: "assessment",
      id: ID,
      occurredAt: stamp,
      assessmentStatus: "draft",
    },
  ],
  refreshedAt: later,
});
const empty = () => ({
  uid: UID,
  counts: { assessments: 0, checklists: 0, referrals: 0 },
  latestChecklist: null,
  latestReferral: null,
  activity: [],
  refreshedAt: later,
});
const user = { uid: UID, getIdToken: async () => "ephemeral-test-token" };
const response = (value) => ({ ok: true, json: async () => value });
const signal = () => new AbortController().signal;
const api = (request, currentUser = () => user) =>
  createDashboardApi({
    baseUrl: "http://localhost:8000",
    uid: UID,
    currentUser,
    request,
  });
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("parses real zero and totals above page size without exposing unexpected private fields", () => {
  assert.equal(parseDashboard(empty(), UID).counts.referrals, 0);
  const value = full();
  value.description = "PRIVATE";
  value.latestReferral.email = "private@example.test";
  const result = parseDashboard(value, UID);
  assert.equal(result.counts.assessments, 101);
  assert(!JSON.stringify(result).includes("PRIVATE"));
  assert(!JSON.stringify(result).includes("private@example.test"));
});
test("rejects foreign owner, fabricated counts, delivery, progress and incomplete snapshots", () => {
  for (const change of [
    { uid: "foreign" },
    { counts: { assessments: -1, checklists: 2, referrals: 1 } },
    { counts: { assessments: true, checklists: 2, referrals: 1 } },
    { latestReferral: null },
    { latestChecklist: null },
    { activity: [] },
    { refreshedAt: "bad" },
    { latestReferral: { ...full().latestReferral, status: "completed" } },
    { latestReferral: { ...full().latestReferral, deliveryStatus: "sent" } },
    { latestChecklist: { ...full().latestChecklist, completedItems: 9 } },
  ])
    assert.throws(() => parseDashboard({ ...full(), ...change }, UID));
});
test("activity rejects duplicate, foreign route identifiers, unsupported statuses and reverse times", () => {
  const row = full().activity[0];
  for (const activity of [
    [row, row],
    [{ ...row, id: "../private" }],
    [{ ...row, kind: "message" }],
    [{ ...row, assessmentStatus: "draft" }],
    [{ ...row, occurredAt: "2030-01-01T00:00:00Z" }],
    [{ ...row, occurredAt: "2026-11-04T08:00:00Z" }, full().activity[1]],
  ])
    assert.throws(() => parseDashboard({ ...full(), activity }, UID));
});
test("activity links resume each record's actual saved step", () => {
  for (const [assessmentStatus, step] of [
    ["draft", "describe"],
    ["needs-clarification", "clarify"],
    ["awaiting-pathways", "results"],
  ])
    assert.equal(
      activityLink({ kind: "assessment", id: ID, assessmentStatus }),
      `/app/assessments/${ID}/${step}`,
    );
  assert.equal(
    activityLink({ kind: "checklist", id: CHECK }),
    `/app/checklists/${CHECK}`,
  );
  assert.equal(
    activityLink({ kind: "referral", id: REF }),
    `/app/referrals/${REF}`,
  );
});
test("dashboard transport is GET only, no URL identity or private fields, cache, cookies or redirects", async () => {
  let sent;
  await api(async (url, options) => {
    sent = { url, options };
    return response(full());
  })(signal());
  assert.equal(sent.url, "http://localhost:8000/api/v1/dashboard");
  assert.equal(sent.options.method, "GET");
  assert.equal(sent.options.body, undefined);
  assert.equal(
    sent.options.headers.Authorization,
    "Bearer ephemeral-test-token",
  );
  assert.equal(sent.options.credentials, "omit");
  assert.equal(sent.options.cache, "no-store");
  assert.equal(sent.options.redirect, "error");
  assert.equal(sent.options.referrerPolicy, "no-referrer");
});
test("absent or changed account and pre-aborted reads never fetch", async () => {
  let calls = 0;
  const request = async () => {
    calls++;
    return response(full());
  };
  for (const current of [null, { ...user, uid: "foreign" }])
    await assert.rejects(api(request, () => current)(signal()));
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(api(request)(abort.signal));
  assert.equal(calls, 0);
});
test("account changes during token, HTTP or JSON discard old account results", async () => {
  for (const phase of ["token", "http", "json"]) {
    let current;
    current = {
      uid: UID,
      getIdToken: async () => {
        if (phase === "token") current = null;
        return "token";
      },
    };
    await assert.rejects(
      api(
        async () => {
          if (phase === "http") current = null;
          return {
            ok: true,
            json: async () => {
              if (phase === "json") current = null;
              return full();
            },
          };
        },
        () => current,
      )(signal()),
    );
  }
});
test("HTTP errors do not read error bodies or turn into empty success", async () => {
  for (const status of [401, 403, 404, 503])
    await assert.rejects(
      api(async () => ({
        ok: false,
        status,
        json: () => {
          throw Error("must not read");
        },
      }))(signal()),
      (e) => e.status === status,
    );
});
test("loading and refresh publish only confirmed summary data without writes", async () => {
  let reads = 0;
  const resource = new DashboardResource(async () => {
    reads++;
    return reads === 1 ? full() : empty();
  });
  const stop = resource.start();
  assert.equal(resource.snapshot().status, "loading");
  await tick();
  assert.equal(resource.snapshot().value.counts.assessments, 101);
  await resource.reload();
  assert.equal(resource.snapshot().value.counts.assessments, 0);
  assert.equal(reads, 2);
  stop();
});
test("failed refresh clears old figures and requires explicit retry", async () => {
  let reads = 0;
  const resource = new DashboardResource(async () => {
    if (++reads === 2) throw new DashboardError(503);
    return full();
  });
  const stop = resource.start();
  await tick();
  await resource.reload();
  assert.equal(resource.snapshot().status, "error");
  assert.equal(resource.snapshot().value, undefined);
  await resource.reload();
  assert.equal(resource.snapshot().status, "ready");
  stop();
});
test("cleanup and a newer reload prevent late old data from appearing", async () => {
  const pending = deferred();
  let reads = 0;
  const resource = new DashboardResource(async () =>
    ++reads === 1 ? pending.promise : empty(),
  );
  const stop = resource.start();
  await tick();
  await resource.reload();
  pending.resolve(full());
  await tick();
  assert.equal(resource.snapshot().value.counts.assessments, 0);
  stop();
  assert.equal(resource.snapshot().status, "loading");
});
test("StrictMode restart ignores results from the stopped lifecycle", async () => {
  const pending = deferred();
  let reads = 0;
  const resource = new DashboardResource(async () =>
    ++reads === 1 ? pending.promise : empty(),
  );
  const firstStop = resource.start();
  await tick();
  firstStop();
  const stop = resource.start();
  await tick();
  pending.resolve(full());
  await tick();
  assert.equal(resource.snapshot().value.counts.assessments, 0);
  stop();
});
test("a hung read times out to error and late results cannot populate dashboard", async () => {
  const pending = deferred();
  const resource = new DashboardResource(() => pending.promise, 10);
  const stop = resource.start();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(resource.snapshot().status, "error");
  pending.resolve(full());
  await tick();
  assert.equal(resource.snapshot().status, "error");
  stop();
});
