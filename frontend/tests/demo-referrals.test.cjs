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
      URLSearchParams,
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

const { createDemoReferralApi, parseDemoPage, parseDemoRecord } = load(
  "referrals/demoReferralApi.ts",
);
const { ReferralResource } = load("referrals/ReferralResource.ts");
const UID = "unit-owner";
const REFERRAL = "a".repeat(32);
const KEY = "b".repeat(64);
const time = "2026-11-05T09:00:00.000123Z";
const shared = {
  id: KEY,
  serviceId: "small-claims-courts",
  serviceName: "Small Claims Courts",
  pathwayTitle: "Public pathway",
  status: "shared",
  revision: 1,
  history: [{ status: "shared", at: time }],
};
const assigned = {
  ...shared,
  status: "assigned",
  revision: 2,
  history: [...shared.history, { status: "assigned", at: time }],
};
const user = { uid: UID, getIdToken: async () => "unit-token" };
const options = {
  baseUrl: "http://localhost:8000",
  uid: UID,
  currentUser: () => user,
};
const signal = () => new AbortController().signal;
const result = (value) => ({ ok: true, json: async () => value });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("metadata parser strips extra fields and rejects fabricated history", () => {
  const parsed = parseDemoRecord({
    ...assigned,
    providerUid: "PRIVATE",
    description: "PRIVATE",
  });
  assert.equal(parsed.status, "assigned");
  assert.equal(JSON.stringify(parsed).includes("PRIVATE"), false);
  for (const change of [
    { revision: 3 },
    { status: "completed" },
    { id: "../other" },
    {
      history: [
        { status: "assigned", at: time },
        { status: "shared", at: time },
      ],
    },
    {
      history: [
        shared.history[0],
        { status: "assigned", at: "2026-01-01T00:00:00Z" },
      ],
    },
  ])
    assert.throws(() => parseDemoRecord({ ...assigned, ...change }));
});

test("queue parser rejects foreign identity, wrong stage and invalid cursor order", () => {
  const page = { uid: UID, referrals: [assigned], nextCursor: null };
  assert.equal(parseDemoPage(page, UID, "provider").referrals.length, 1);
  assert.throws(() => parseDemoPage(page, UID, "admin"));
  assert.throws(() =>
    parseDemoPage({ ...page, uid: "foreign" }, UID, "provider"),
  );
  assert.throws(() =>
    parseDemoPage(
      { ...page, referrals: [assigned, assigned] },
      UID,
      "provider",
    ),
  );
  assert.throws(() => parseDemoPage(page, UID, "provider", KEY));
  assert.throws(() =>
    parseDemoPage({ ...page, nextCursor: KEY }, UID, "provider"),
  );
});

test("opening own progress makes a GET and verifies the private referral reference", async () => {
  let calls = 0;
  const api = createDemoReferralApi({
    ...options,
    request: async (url, init) => {
      calls++;
      assert(url.endsWith(`/api/v1/demo-referrals/mine/${REFERRAL}`));
      assert.equal(init.method, "GET");
      assert.equal(init.body, undefined);
      assert.equal(init.credentials, "omit");
      return result({
        uid: UID,
        referralId: calls === 1 ? REFERRAL : "c".repeat(32),
        referral: null,
      });
    },
  });
  assert.equal(await api.mine(REFERRAL, signal()), null);
  await assert.rejects(api.mine(REFERRAL, signal()));
});

test("consent and assignment send only the named write fields", async () => {
  const writes = [];
  const api = createDemoReferralApi({
    ...options,
    request: async (url, init) => {
      writes.push({ url, body: JSON.parse(init.body), method: init.method });
      return result({
        uid: UID,
        referralId: REFERRAL,
        referral: writes.length === 1 ? shared : assigned,
      });
    },
  });
  await api.share(REFERRAL, signal());
  await api.assign(shared, "provider-test", signal());
  assert.deepEqual(
    writes.map((item) => item.body),
    [
      { confirmed: true, consentVersion: "demo-metadata-v1" },
      { expectedRevision: 1, providerUid: "provider-test" },
    ],
  );
  assert(
    writes.every(
      (item) => item.method === "PUT" && !item.url.includes("provider-test"),
    ),
  );
});

test("an update needs confirmation of the exact record, next revision and status", async () => {
  const reviewed = {
    ...assigned,
    revision: 3,
    status: "under-review",
    history: [...assigned.history, { status: "under-review", at: time }],
  };
  for (const row of [
    assigned,
    { ...reviewed, id: "c".repeat(64) },
    { ...reviewed, revision: 4 },
  ]) {
    const api = createDemoReferralApi({
      ...options,
      request: async () => result({ uid: UID, referral: row }),
    });
    await assert.rejects(api.progress(assigned, "under-review", signal()));
  }
  const api = createDemoReferralApi({
    ...options,
    request: async () => result({ uid: UID, referral: reviewed }),
  });
  assert.equal(
    (await api.progress(assigned, "under-review", signal())).revision,
    3,
  );
});

test("invalid identifiers, membership UID and skipped transitions stop before fetching", async () => {
  let calls = 0;
  const api = createDemoReferralApi({
    ...options,
    request: async () => {
      calls++;
    },
  });
  await assert.rejects(api.mine("bad", signal()));
  await assert.rejects(api.list("admin", "bad", signal()));
  await assert.rejects(api.assign(shared, "invalid uid", signal()));
  await assert.rejects(api.progress(assigned, "completed", signal()));
  assert.equal(calls, 0);
});

test("a provider result from a departed account is discarded", async () => {
  let current = user;
  const api = createDemoReferralApi({
    ...options,
    currentUser: () => current,
    request: async () => ({
      ok: true,
      json: async () => {
        current = null;
        return { uid: UID, referrals: [assigned], nextCursor: null };
      },
    }),
  });
  await assert.rejects(api.list("provider", undefined, signal()));
});

test("resource blocks another update when an outcome needs a refresh", async () => {
  let writes = 0;
  const resource = new ReferralResource(async () => shared);
  const stop = resource.start();
  await tick();
  await resource.mutate(
    async () => {
      writes++;
      throw Error("connection lost");
    },
    { unconfirmed: "Check the saved demo progress." },
  );
  assert.equal(resource.snapshot().needsReload, true);
  assert.equal(resource.snapshot().error, "Check the saved demo progress.");
  await resource.mutate(async () => {
    writes++;
    return assigned;
  });
  assert.equal(writes, 1);
  stop();
});
