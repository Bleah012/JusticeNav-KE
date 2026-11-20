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

const {
  createAuditApi,
  parseAuditPage,
  auditParameters,
  initialAuditFilters: filters,
} = load("admin/auditApi.ts");
const { AdminResource } = load("admin/AdminResource.ts");
const { AdminApiError } = load("admin/adminApi.ts");
const UID = "test-administrator";
test("microsecond timestamps display in Kenya time across midnight", () => {
  const { formatAuditDate } = load("admin/auditApi.ts");
  const text = formatAuditDate("2026-11-18T21:05:00.123456Z");
  assert.match(text, /19 Nov 2026/);
  assert.match(text, /00:05|12:05/);
  assert.equal(formatAuditDate("invalid"), "Time unavailable");
});
const event = (
  kind = "resource",
  number = 1,
  stamp = "2026-11-19T09:00:00.123456Z",
) => ({
  id: `${kind}:${number.toString(16).padStart(32, "0")}`,
  occurredAt: stamp,
  actorReference: UID,
  action: `${kind}.update`,
  targetKind: kind,
  targetReference: "development-item",
  revision: number,
  outcome: "succeeded",
});
const page = (events = [event()], nextCursor = null) => ({
  schemaVersion: 1,
  uid: UID,
  role: "admin",
  readOnly: true,
  events,
  nextCursor,
});
const copy = (value) => JSON.parse(JSON.stringify(value));
const signal = () => new AbortController().signal;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const user = { uid: UID, getIdToken: async () => "test-token" };
const api = (request) =>
  createAuditApi({
    baseUrl: "http://localhost:8000",
    uid: UID,
    currentUser: () => user,
    request,
  });

test("audit parser whitelists successful metadata and preserves server microseconds", () => {
  const raw = page();
  raw.events[0].description = "PRIVATE";
  raw.events[0].contact = "PRIVATE";
  const result = parseAuditPage(raw, UID, filters, null);
  assert.equal(result.events[0].occurredAt, "2026-11-19T09:00:00.123456Z");
  assert.equal(result.events[0].description, undefined);
  assert.equal(result.events[0].contact, undefined);
  assert.equal(
    parseAuditPage(page([], "continuation"), UID, filters, null).nextCursor,
    "continuation",
  );
  assert.equal(parseAuditPage(page([]), UID, filters, null).events.length, 0);
});

test("rejects foreign envelopes, unsupported outcomes, broken metadata and contradictory pages", () => {
  const changes = [
    (value) => (value.uid = "foreign"),
    (value) => (value.role = "seeker"),
    (value) => (value.readOnly = false),
    (value) => (value.schemaVersion = 2),
    (value) =>
      (value.events = Array.from({ length: 26 }, (_, index) =>
        event("resource", index + 1),
      )),
    (value) => value.events.push(copy(value.events[0])),
    (value) => (value.nextCursor = "../bad"),
    (value) => (value.events[0].id = "resource:bad"),
    (value) => (value.events[0].actorReference = ""),
    (value) => (value.events[0].actorReference = "PRIVATE\x00"),
    (value) => (value.events[0].revision = true),
    (value) => (value.events[0].revision = 0),
    (value) => (value.events[0].outcome = "failed"),
    (value) => (value.events[0].action = "service.update"),
    (value) => (value.events[0].targetKind = "referral"),
    (value) => (value.events[0].occurredAt = "2026-02-30T09:00:00.123456Z"),
    (value) => (value.events[0].targetReference = "../private"),
    (value) => (value.events[0].occurredAt = "2026-11-19T09:00:00Z"),
  ];
  for (const mutate of changes) {
    const raw = page();
    mutate(raw);
    assert.throws(() => parseAuditPage(raw, UID, filters, null));
  }
  assert.throws(() => parseAuditPage(page([], "same"), UID, filters, "same"));
});

test("stable ordering retains sub-millisecond precision and namespaced IDs", () => {
  const raw = page([
    event("service", 1),
    event("resource", 1),
    event("pathway", 1),
    event("service", 9, "2026-11-19T09:00:00.123455Z"),
  ]);
  assert.equal(parseAuditPage(raw, UID, filters, null).events.length, 4);
  raw.events.reverse();
  assert.throws(() => parseAuditPage(raw, UID, filters, null));
});

test("validates exact applied type, action, references and inclusive Kenya dates", () => {
  const raw = page([event("resource", 1, "2026-11-18T21:00:00.000000Z")]);
  const selected = {
    ...filters,
    kind: "resource",
    action: "update",
    query: "DEVELOPMENT",
    from: "2026-11-19",
    to: "2026-11-19",
  };
  assert.equal(parseAuditPage(raw, UID, selected, null).events.length, 1);
  for (const change of [
    { kind: "service" },
    { action: "delete" },
    { query: "missing" },
    { to: "2026-11-18" },
    { from: "2026-11-20" },
  ])
    assert.throws(() =>
      parseAuditPage(raw, UID, { ...selected, ...change }, null),
    );
});

test("fixed GET transport encodes filters/cursor and never sends a write", async () => {
  let calls = 0;
  await api(async (url, options) => {
    calls++;
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/api/v1/admin/audit-logs");
    assert.equal(parsed.searchParams.get("kind"), "resource");
    assert.equal(parsed.searchParams.get("query"), "development-item");
    assert.equal(parsed.searchParams.get("cursor"), "continuation");
    assert.equal(options.method, "GET");
    assert.equal(options.body, undefined);
    assert.equal(options.headers.Authorization, "Bearer test-token");
    assert.equal(options.cache, "no-store");
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.equal(options.referrerPolicy, "no-referrer");
    return { ok: true, json: async () => page() };
  })(
    { ...filters, kind: "resource", query: " development-item " },
    "continuation",
    signal(),
  );
  assert.equal(calls, 1);
});

test("bad filters and cursor fail locally before HTTP", async () => {
  let calls = 0;
  const read = api(async () => {
    calls++;
  });
  for (const change of [
    { kind: "referral" },
    { action: "access-denied" },
    { query: "x".repeat(201) },
    { query: "private\0" },
    { from: "2026-02-30" },
    { from: "2026-11-20", to: "2026-11-19" },
    { to: "9999-12-31" },
  ])
    await assert.rejects(
      read({ ...filters, ...change }, null, signal()),
      (error) => error.status === 422,
    );
  assert.throws(() => auditParameters(filters, "bad/cursor"));
  assert.equal(calls, 0);
});

test("account switch during token, HTTP or JSON prevents private publication", async () => {
  for (const phase of ["token", "http", "json"]) {
    let current,
      calls = 0;
    const owner = {
      uid: UID,
      getIdToken: async () => {
        if (phase === "token") current = null;
        return "old-token";
      },
    };
    current = owner;
    const read = createAuditApi({
      baseUrl: "http://localhost:8000",
      uid: UID,
      currentUser: () => current,
      request: async () => {
        calls++;
        if (phase === "http") current = null;
        return {
          ok: true,
          json: async () => {
            if (phase === "json") current = null;
            return page();
          },
        };
      },
    });
    await assert.rejects(
      read(filters, null, signal()),
      (error) => error.status === 401,
    );
    assert.equal(calls, phase === "token" ? 0 : 1);
  }
});

test("foreign, missing or aborted accounts never fetch", async () => {
  let calls = 0;
  for (const owner of [null, { ...user, uid: "foreign" }]) {
    const read = createAuditApi({
      baseUrl: "http://localhost:8000",
      uid: UID,
      currentUser: () => owner,
      request: async () => {
        calls++;
      },
    });
    await assert.rejects(read(filters, null, signal()));
  }
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    api(async () => {
      calls++;
    })(filters, null, abort.signal),
  );
  assert.equal(calls, 0);
});

test("failed reads never parse private HTTP bodies", async () => {
  let parsed = 0;
  for (const status of [401, 403, 422, 503])
    await assert.rejects(
      api(async () => ({
        ok: false,
        status,
        json: async () => {
          parsed++;
          throw Error("PRIVATE");
        },
      }))(filters, null, signal()),
      (error) => error.status === status && !error.message.includes("PRIVATE"),
    );
  assert.equal(parsed, 0);
});

test("failed refresh and permission loss clear old audit rows", async () => {
  for (const code of [403, 503]) {
    let fail = false;
    const resource = new AdminResource(async () => {
      if (fail) throw new AdminApiError(code);
      return page();
    });
    const stop = resource.start();
    await tick();
    assert.equal(resource.snapshot().status, "ready");
    fail = true;
    await resource.reload();
    assert.equal(
      resource.snapshot().status,
      code === 403 ? "forbidden" : "error",
    );
    assert.equal(resource.snapshot().value, undefined);
    stop();
  }
});

test("unmounted or replaced reads discard late audit pages", async () => {
  let resolve,
    calls = 0;
  const pending = new Promise((done) => (resolve = done));
  const resource = new AdminResource(async () =>
    ++calls === 1 ? pending : page([]),
  );
  const stop = resource.start();
  await tick();
  await resource.reload();
  resolve(page());
  await tick();
  assert.equal(resource.snapshot().value.events.length, 0);
  stop();
  assert.equal(resource.snapshot().status, "loading");
});

test("timeouts show errors and never turn uncertain reads into empty history", async () => {
  const resource = new AdminResource(() => new Promise(() => {}), true, 5);
  const stop = resource.start();
  await new Promise((done) => setTimeout(done, 25));
  assert.equal(resource.snapshot().status, "error");
  assert.equal(resource.snapshot().value, undefined);
  stop();
});
