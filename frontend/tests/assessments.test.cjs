const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ts = require("typescript");
const cache = new Map();
function load(relative) {
  const file = path.resolve(__dirname, "../src", relative);
  if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: {} }; cache.set(file, mod);
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module: mod, exports: mod.exports, require: (id) => { if (!id.startsWith(".")) throw Error("Unexpected import"); return load(path.relative(path.join(__dirname, "../src"), path.resolve(path.dirname(file), id + ".ts"))); }, URL, AbortController, setTimeout, clearTimeout, fetch: () => { throw Error("Live network forbidden"); } }, { filename: file });
  return mod.exports;
}
const { AssessmentError, createAssessmentApi, createAssessmentRequest, parseAssessment } = load("assessments/assessmentApi.ts");
const { AssessmentResource } = load("assessments/AssessmentResource.ts");
const id = "a".repeat(32), other = "b".repeat(32);
const stamp = "2026-01-01T00:00:00Z";
const record = (changes = {}) => ({ id, uid: "user-a", description: "Non-sensitive test input", answers: { issue: null, timeframe: null, contact: null }, status: "draft", revision: 1, createdAt: stamp, updatedAt: stamp, ...changes });
const signal = () => new AbortController().signal;
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function controller(t, loader = async () => null, timeout) { const resource = new AssessmentResource(loader, timeout); resource.start(); t.after(resource.stop); return resource; }

test("records reject foreign identity, invalid references, bad answers and fabricated result states", () => {
  assert.equal(parseAssessment(record(), "user-a", id).description, record().description);
  for (const change of [{ uid: "user-b" }, { id: other }, { description: " " }, { description: "x".repeat(1501) }, { revision: true }, { status: "results-ready" }, { status: "awaiting-pathways" }, { answers: { issue: "invented", timeframe: null, contact: null } }, { updatedAt: "invalid" }]) assert.throws(() => parseAssessment(record(change), "user-a", id));
  const saved = parseAssessment(record({ answers: { issue: "consumer", timeframe: "unsure", contact: "no" }, status: "awaiting-pathways", role: "admin" }), "user-a", id);
  assert.equal(saved.role, undefined);
});

test("employment answers parse at partial and complete stages without changing saved Other records", () => {
  for (const issue of ["consumer", "money-debt", "employment", "other"]) {
    const partial = record({ status: "needs-clarification", answers: { issue, timeframe: null, contact: null } });
    const complete = record({ status: "awaiting-pathways", answers: { issue, timeframe: "recent", contact: "no" } });
    for (const saved of [partial, complete]) {
      const before = JSON.stringify(saved);
      assert.equal(parseAssessment(saved, "user-a", id).answers.issue, issue);
      assert.equal(JSON.stringify(saved), before);
    }
  }
  for (const issue of [undefined, "Employment", "toString", {}, []])
    assert.throws(() => parseAssessment(record({ answers: { issue, timeframe: null, contact: null } }), "user-a", id));
});

test("employment suggestions and clarification saves retain the selected category and revision", async () => {
  let captured;
  const answers = { issue: "employment", timeframe: "months", contact: "yes" };
  const api = createAssessmentApi("user-a", async (...args) => {
    captured = args;
    return args[2] === "GET"
      ? { assessmentId: id, revision: 2, issue: "employment" }
      : { assessment: record({ answers, status: "awaiting-pathways", revision: 3 }) };
  });
  assert.equal(await api.suggestIssue(id, 2, signal()), "employment");
  assert.equal(captured[5].suggestionRevision, 2);
  const saved = await api.save(id, { step: "clarify", answers, proceed: true }, 2, signal());
  assert.equal(saved.answers.issue, "employment");
  assert.equal(saved.revision, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(captured[3])), { step: "clarify", answers, proceed: true, expectedRevision: 2 });
});

test("transport keeps private descriptions and identity out of URLs and disables caching/cookies/redirects", async () => {
  const user = { uid: "user-a", getIdToken: async () => "unit-token" }; let captured;
  const request = createAssessmentRequest({ baseUrl: "http://localhost:8000", currentUser: () => user, request: async (url, options) => { captured = { url, options }; return { ok: true, json: async () => ({ assessment: record() }) }; } });
  await request("user-a", id, "PUT", { description: "private-test-only" }, signal());
  assert.equal(captured.url, `http://localhost:8000/api/v1/assessments/${id}`);
  assert(!captured.url.includes("user-a") && !captured.url.includes("private-test-only"));
  assert.equal(captured.options.headers.Authorization, "Bearer unit-token");
  assert.equal(captured.options.credentials, "omit"); assert.equal(captured.options.cache, "no-store"); assert.equal(captured.options.redirect, "error"); assert.equal(captured.options.referrerPolicy, "no-referrer");
});

test("invalid resource paths, status and cursors are rejected before fetching", async () => {
  const request = createAssessmentRequest({ baseUrl: "http://localhost:8000", currentUser: () => ({ uid: "user-a", getIdToken: async () => "unit-token" }) });
  for (const identifier of ["../other", "https://untrusted.invalid", "", "user@example.invalid"]) await assert.rejects(request("user-a", identifier, "GET", undefined, signal()));
  await assert.rejects(request("user-a", null, "GET", undefined, signal(), { status: "results-ready" }));
  await assert.rejects(request("user-a", null, "GET", undefined, signal(), { after: "foreign/path" }));
});

test("issue suggestions send only the saved reference and revision and accept abstention", async () => {
  const user = { uid: "user-a", getIdToken: async () => "unit-token" };
  let result = { assessmentId: id, revision: 2, issue: "consumer" };
  let calls = 0;
  const transport = createAssessmentRequest({
    baseUrl: "http://localhost:8000",
    currentUser: () => user,
    request: async (url, options) => {
      calls++;
      assert.equal(url, `http://localhost:8000/api/v1/assessments/${id}/issue-suggestion?revision=2`);
      assert.equal(options.method, "GET");
      assert.equal(options.body, undefined);
      assert.equal(options.cache, "no-store");
      return { ok: true, json: async () => result };
    },
  });
  const api = createAssessmentApi("user-a", transport);
  assert.equal(await api.suggestIssue(id, 2, signal()), "consumer");
  result = { ...result, issue: null };
  assert.equal(await api.suggestIssue(id, 2, signal()), null);
  for (const revision of [0, -1, 1.5, "2", Number.POSITIVE_INFINITY])
    await assert.rejects(api.suggestIssue(id, revision, signal()));
  assert.equal(calls, 2);
  for (const change of [{ assessmentId: other }, { revision: 3 }, { issue: "invented" }]) {
    const invalid = createAssessmentApi("user-a", async () => ({ ...result, ...change }));
    await assert.rejects(invalid.suggestIssue(id, 2, signal()), (error) => error.status === 502);
  }
});

test("missing or mismatched sessions and aborted requests never fetch", async () => {
  for (const user of [null, { uid: "foreign", getIdToken: async () => "unit-token" }]) {
    const request = createAssessmentRequest({ baseUrl: "http://localhost:8000", currentUser: () => user });
    await assert.rejects(request("user-a", id, "GET", undefined, signal()));
  }
  const abort = new AbortController(); abort.abort();
  const request = createAssessmentRequest({ baseUrl: "http://localhost:8000", currentUser: () => ({ uid: "user-a", getIdToken: async () => "unit-token" }) });
  await assert.rejects(request("user-a", id, "GET", undefined, abort.signal));
});

test("account changes during token retrieval or response reading discard obsolete results", async () => {
  for (const phase of ["token", "response", "json"]) {
    const task = deferred(); let user = { uid: "user-a", getIdToken: () => phase === "token" ? task.promise : Promise.resolve("unit-token") };
    const response = { ok: true, json: () => phase === "json" ? task.promise : Promise.resolve({ assessment: record() }) };
    const request = createAssessmentRequest({ baseUrl: "http://localhost:8000", currentUser: () => user, request: () => phase === "response" ? task.promise : Promise.resolve(response) });
    const pending = request("user-a", id, "GET", undefined, signal()); await tick();
    user = { uid: "user-b", getIdToken: async () => "other-token" };
    task.resolve(phase === "token" ? "unit-token" : phase === "response" ? response : { assessment: record() });
    await assert.rejects(pending, (error) => error instanceof AssessmentError && error.status === 401);
  }
});

test("API writes only description or clarification fields and verifies revision/ownership", async () => {
  let captured;
  const api = createAssessmentApi("user-a", async (...args) => { captured = args; return { assessment: record() }; });
  await api.save(id, { step: "describe", description: "test", proceed: false, uid: "foreign", status: "results-ready", password: "private-test-only" }, 0, signal());
  assert.deepEqual(JSON.parse(JSON.stringify(captured[3])), { step: "describe", description: "test", proceed: false, expectedRevision: 0 });
  await api.save(id, { step: "clarify", proceed: false, answers: { issue: "consumer", timeframe: null, contact: null, role: "admin" } }, 0, signal());
  assert.equal(captured[3].answers.role, undefined);
  const wrong = createAssessmentApi("user-a", async () => ({ assessment: record({ revision: 5 }) }));
  await assert.rejects(wrong.save(id, { step: "describe", description: "test", proceed: false }, 0, signal()));
});

test("lists whitelist metadata, reject duplicate records, invalid pagination and mismatched status", async () => {
  const api = (value) => createAssessmentApi("user-a", async () => value);
  const page = await api({ assessments: [record()], nextCursor: null }).list({}, signal());
  assert.equal(page.assessments[0].description, undefined); assert.equal(page.assessments[0].uid, undefined);
  for (const value of [{ assessments: [record(), record()], nextCursor: null }, { assessments: [record()], nextCursor: other }, { assessments: [record({ revision: 0 })], nextCursor: null }, { assessments: [], nextCursor: id }]) await assert.rejects(api(value).list({}, signal()));
  await assert.rejects(api({ assessments: [record()], nextCursor: null }).list({ status: "awaiting-pathways" }, signal()));
});

test("loading and reopening records never saves or fabricates an assessment", async (t) => {
  const resource = controller(t, async () => record()); await tick();
  assert.equal(resource.snapshot().status, "ready");
  assert.equal(resource.snapshot().notice, "");
  assert.equal(resource.snapshot().value.revision, 1);
});

test("save confirmation waits for server response and blocks duplicate submits", async (t) => {
  const resource = controller(t); await tick(); const task = deferred(); let count = 0;
  const operation = () => { count++; return task.promise; };
  const pending = resource.mutate(operation); await resource.mutate(operation); await tick();
  assert.equal(count, 1); assert.equal(resource.snapshot().saving, true); assert.equal(resource.snapshot().notice, "");
  task.resolve(record()); await pending;
  assert.equal(resource.snapshot().notice, "Your assessment was saved.");
});

test("conflict and uncertain failures preserve saved data and block writes until reloaded", async (t) => {
  for (const failure of [new AssessmentError(409), new AssessmentError(503), new Error("private-sdk-detail")]) {
    const resource = controller(t, async () => record()); await tick();
    let writes = 0;
    const operation = async () => { writes++; throw failure; };
    assert.equal(await resource.mutate(operation), undefined);
    assert.equal(resource.snapshot().value.revision, 1); assert.equal(resource.snapshot().needsReload, true);
    assert.equal(resource.snapshot().notice, ""); assert(!resource.snapshot().error.includes("private-sdk-detail"));
    await resource.mutate(operation); assert.equal(writes, 1);
    await resource.reload(); assert.equal(resource.snapshot().needsReload, false);
  }
});

test("validation permits correction but identity denial and missing records clear loaded data", async (t) => {
  for (const status of [422, 401, 403, 404]) {
    const resource = controller(t, async () => record()); await tick(); await resource.mutate(async () => { throw new AssessmentError(status); });
    assert.equal(resource.snapshot().status, status === 422 ? "ready" : "error");
    if (status === 422) assert.equal(resource.snapshot().needsReload, false);
    else assert.equal(resource.snapshot().value, undefined);
  }
});

test("late load and write results cannot restore a departed account or navigate after cleanup", async (t) => {
  const task = deferred(), resource = controller(t, () => task.promise); resource.stop(); task.resolve(record()); await tick();
  assert.equal(resource.snapshot().status, "loading");
  const saving = controller(t); await tick(); const save = deferred(); const pending = saving.mutate(() => save.promise); await tick(); saving.stop(); save.resolve(record());
  assert.equal(await pending, undefined); assert.equal(saving.snapshot().status, "loading");
});

test("timeouts request reload without claiming that an uncertain write failed", async (t) => {
  const resource = controller(t, async () => record(), 15); await tick();
  await resource.mutate(() => new Promise(() => {}));
  assert.equal(resource.snapshot().needsReload, true);
  assert(resource.snapshot().error.includes("could not be confirmed"));
});

test("old reads cannot replace a newer filter/account lifecycle", async (t) => {
  const task = deferred(); let reads = 0;
  const resource = controller(t, () => ++reads === 1 ? task.promise : Promise.resolve(record({ id: other })));
  await tick(); resource.stop(); resource.start(); await tick(); task.resolve(record()); await tick();
  assert.equal(resource.snapshot().value.id, other);
});

test("HTTP error bodies are never parsed or shown to the user", async () => {
  const user = { uid: "user-a", getIdToken: async () => "unit-token" }; let parsed = false;
  const request = createAssessmentRequest({ baseUrl: "http://localhost:8000", currentUser: () => user, request: async () => ({ ok: false, status: 503, json: () => { parsed = true; throw Error("private-details"); } }) });
  await assert.rejects(request("user-a", id, "GET", undefined, signal()), (error) => error.status === 503 && !error.message.includes("private-details"));
  assert.equal(parsed, false);
});

const DELETE_UID = "user-a";
const deleteUser = {uid: DELETE_UID, getIdToken: async () => "test-ephemeral-token"};
const deleteResponse = value => ({ok:true,json:async () => value});
const deleteSummary = (changes={}) => ({id,status:"draft",revision:1,createdAt:stamp,updatedAt:stamp,...changes});
function deleteApi(request,currentUser=()=>deleteUser) {
  return createAssessmentApi(DELETE_UID,createAssessmentRequest({baseUrl:"http://localhost:8000",currentUser,request}));
}

test("DELETE sends only the saved revision and requires exact owner, id and revision confirmation", async () => {
  const receipt = { uid: DELETE_UID, deletedId: id, revision: 1 };
  await deleteApi(async (url, options) => {
    assert.equal(url, `http://localhost:8000/api/v1/assessments/${id}`);
    assert.equal(options.method, "DELETE");
    assert.deepEqual(JSON.parse(options.body), { expectedRevision: 1 });
    assert.equal(options.headers.Authorization, "Bearer test-ephemeral-token");
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    return deleteResponse(receipt);
  }).remove(id, 1, signal());
  for (const changes of [
    { uid: "foreign" },
    { deletedId: other },
    { revision: 2 },
    { revision: true },
  ])
    await assert.rejects(
      deleteApi(async () => deleteResponse({ ...receipt, ...changes })).remove(
        id,
        1,
        signal(),
      ),
    );
  let calls = 0;
  const invalid = deleteApi(async () => {
    calls++;
    return deleteResponse(receipt);
  });
  for (const revision of [0, -1, true, "1", NaN])
    await assert.rejects(invalid.remove(id, revision, signal()));
  await assert.rejects(invalid.remove("../bad", 1, signal()));
  assert.equal(calls, 0);
});

test("delete errors never parse response bodies and account changes discard late receipts", async () => {
  for (const status of [401, 403, 404, 409, 503]) {
    let parsed = false;
    await assert.rejects(
      deleteApi(async () => ({
        ok: false,
        status,
        json: async () => {
          parsed = true;
          return {};
        },
      })).remove(id, 1, signal()),
      (error) => error.status === status,
    );
    assert.equal(parsed, false);
  }
  for (const phase of ["token", "http", "json"]) {
    let current,
      calls = 0;
    const account = {
      uid: DELETE_UID,
      getIdToken: async () => {
        if (phase === "token") current = null;
        return "old";
      },
    };
    current = account;
    const client = deleteApi(
      async () => {
        calls++;
        if (phase === "http") current = null;
        return {
          ok: true,
          json: async () => {
            if (phase === "json") current = null;
            return { uid: DELETE_UID, deletedId: id, revision: 1 };
          },
        };
      },
      () => current,
    );
    await assert.rejects(client.remove(id, 1, signal()));
    assert.equal(calls, phase === "token" ? 0 : 1);
  }
});

test("delete keeps the loaded row until confirmation and refreshed list, blocking double submits", async () => {
  const confirmation = deferred(),
    refresh = deferred();
  let loads = 0,
    writes = 0;
  const original = { assessments: [deleteSummary()], nextCursor: null };
  const resource = new AssessmentResource(() =>
    ++loads === 1 ? Promise.resolve(original) : refresh.promise,
  );
  const stop = resource.start();
  await tick();
  const deleting = resource.mutate(async (previous) => {
    writes++;
    await confirmation.promise;
    return previous;
  }, "delete");
  await tick();
  assert.equal(resource.snapshot().value.assessments.length, 1);
  assert.equal(resource.snapshot().notice, "");
  await resource.mutate(async (previous) => {
    writes++;
    return previous;
  }, "delete");
  assert.equal(writes, 1);
  confirmation.resolve();
  await tick();
  assert.equal(resource.snapshot().saving, true);
  assert.equal(resource.snapshot().value.assessments.length, 1);
  refresh.resolve({ assessments: [], nextCursor: null });
  await deleting;
  assert.equal(resource.snapshot().value.assessments.length, 0);
  assert.equal(resource.snapshot().notice, "Assessment deleted.");
  stop();
});

test("stale or uncertain deletion requires reload and never reports success", async () => {
  for (const failure of [
    new AssessmentError(409),
    new AssessmentError(502),
    Error("PRIVATE"),
  ]) {
    const resource = new AssessmentResource(async () => ({
      assessments: [deleteSummary()],
      nextCursor: null,
    }));
    const stop = resource.start();
    await tick();
    let writes = 0;
    await resource.mutate(async () => {
      writes++;
      throw failure;
    }, "delete");
    assert.equal(resource.snapshot().needsReload, true);
    assert.equal(resource.snapshot().notice, "");
    assert.equal(resource.snapshot().value.assessments.length, 1);
    assert(!resource.snapshot().error.includes("PRIVATE"));
    await resource.mutate(async (previous) => {
      writes++;
      return previous;
    }, "delete");
    assert.equal(writes, 1);
    stop();
  }
});

test("confirmed deletion followed by failed reload clears stale rows with an accurate message", async () => {
  let loads = 0;
  const resource = new AssessmentResource(async () => {
    if (++loads === 2) throw new AssessmentError(503);
    return { assessments: loads === 1 ? [deleteSummary()] : [], nextCursor: null };
  });
  const stop = resource.start();
  await tick();
  await resource.mutate(async (previous) => previous, "delete");
  assert.equal(resource.snapshot().status, "error");
  assert.match(resource.snapshot().message, /was deleted/);
  assert.equal(resource.snapshot().value, undefined);
  await resource.reload();
  assert.equal(resource.snapshot().value.assessments.length, 0);
  stop();
});

test("delete timeout and unmounted refresh discard late outcomes", async () => {
  const pending = deferred();
  const resource = new AssessmentResource(
    async () => ({ assessments: [deleteSummary()], nextCursor: null }),
    15,
  );
  const stop = resource.start();
  await tick();
  await resource.mutate(() => pending.promise, "delete");
  assert.equal(resource.snapshot().needsReload, true);
  assert.equal(resource.snapshot().notice, "");
  pending.resolve({ assessments: [], nextCursor: null });
  await tick();
  assert.equal(resource.snapshot().value.assessments.length, 1);
  stop();
  let loads = 0;
  const reload = deferred();
  const late = new AssessmentResource(() =>
    ++loads === 1
      ? Promise.resolve({ assessments: [deleteSummary()], nextCursor: null })
      : reload.promise,
  );
  const cleanup = late.start();
  await tick();
  const deleting = late.mutate(async (previous) => previous, "delete");
  await tick();
  cleanup();
  reload.resolve({ assessments: [], nextCursor: null });
  await deleting;
  assert.equal(late.snapshot().status, "loading");
});
