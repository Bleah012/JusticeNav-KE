const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const ts = require("typescript");
const published = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../../backend/app/public_pathways.json"),
    "utf8",
  ),
);
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

const { createChecklistApi, parseChecklist, parseTemplate, parseSummary, ChecklistError } = load("checklists/checklistApi.ts");
const { ChecklistResource } = load("checklists/ChecklistResource.ts");
const ID = "a".repeat(32), OTHER = "b".repeat(32), UID = "owner";
const stamp = "2026-11-04T09:00:00Z";
const user = { uid: UID, getIdToken: async () => "test-ephemeral-token" };
const pathway = published.pathways[0];
const template = { pathwayId: pathway.id, pathwayTitle: pathway.title, sourceReview: pathway.sourceReview, items: pathway.preparation, templateVersion: "d".repeat(64) };
const record = (changes = {}) => ({ ...template, id: ID, uid: UID, checkedIds: [template.items[0].id], revision: 1, status: "in-progress", createdAt: stamp, updatedAt: stamp, ...changes });
const summary = (changes = {}) => ({ id: ID, pathwayTitle: template.pathwayTitle, completedItems: 1, totalItems: 3, revision: 1, status: "in-progress", createdAt: stamp, updatedAt: stamp, ...changes });
const signal = () => new AbortController().signal;
const response = (value) => ({ ok: true, json: async () => value });
const api = (request, currentUser = () => user) => createChecklistApi({ baseUrl: "http://localhost:8000", uid: UID, currentUser, request });
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test("snapshots validate identities, source links, progress, versions and dates", () => {
  assert.equal(parseChecklist(record(), UID, ID).checkedIds[0], template.items[0].id);
  for (const changed of [{ uid: "foreign" }, { id: OTHER }, { checkedIds: ["foreign-item"] }, { checkedIds: [template.items[0].id, template.items[0].id] }, { status: "complete" }, { revision: 0 }, { updatedAt: "2020-01-01T00:00:00Z" }, { templateVersion: "not-a-version" }]) assert.throws(() => parseChecklist(record(changed), UID, ID));
  assert.throws(() => parseTemplate({ ...template, items: [template.items[0], template.items[0]] }));
  assert.throws(() => parseTemplate({ ...template, sourceReview: { ...template.sourceReview, sources: [{ name: "Unsafe", url: "javascript:alert(1)" }] } }));
});
test("summaries reject impossible counts and fabricated completion", () => {
  for (const changed of [{ completedItems: -1 }, { completedItems: 4 }, { totalItems: 16 }, { revision: true }, { status: "complete" }]) assert.throws(() => parseSummary(summary(changed)));
  assert.equal(parseSummary(summary({ totalItems: 0, completedItems: 0, status: "empty" })).status, "empty");
});
test("loading checklist templates and records sends no writes", async () => {
  const methods = [];
  const client = api(async (url, options) => { methods.push(options.method); return response(url.includes("/templates/") ? template : { checklist: record() }); });
  assert.equal((await client.template(template.pathwayId, signal())).templateVersion, template.templateVersion);
  assert.equal((await client.get(ID, signal())).revision, 1);
  assert.deepEqual(methods, ["GET", "GET"]);
});
test("saving whitelists tick fields and confirms owner, revision and returned selection", async () => {
  let captured;
  const checked = [template.items[0].id];
  const client = api(async (url, options) => { captured = { url, options }; return response({ checklist: record({ revision: 2 }) }); });
  await client.save(ID, { ...template, uid: "ignored", password: "ignored" }, checked, 1, signal());
  assert.equal(captured.url, `http://localhost:8000/api/v1/checklists/${ID}`);
  assert.deepEqual(JSON.parse(captured.options.body), { pathwayId: template.pathwayId, templateVersion: template.templateVersion, checkedIds: checked, expectedRevision: 1 });
  assert.equal(captured.options.credentials, "omit"); assert.equal(captured.options.redirect, "error"); assert.equal(captured.options.cache, "no-store"); assert.equal(captured.options.referrerPolicy, "no-referrer");
  for (const changed of [{ revision: 1 }, { uid: "foreign" }, { templateVersion: "c".repeat(64) }, { checkedIds: [], status: "in-progress" }]) {
    await assert.rejects(api(async () => response({ checklist: record({ revision: 2, ...changed }) })).save(ID, template, checked, 1, signal()));
  }
});
test("invalid references, filters and ticks cannot fetch", async () => {
  let calls = 0; const client = api(async () => { calls++; throw Error("Unexpected"); });
  await assert.rejects(client.get("../profile/me", signal()));
  await assert.rejects(client.template("path?secret=value", signal()));
  await assert.rejects(client.list({ status: "eligible" }, signal()));
  await assert.rejects(client.list({ after: "bad" }, signal()));
  await assert.rejects(client.save(ID, template, ["foreign-item"], 1, signal()));
  await assert.rejects(client.save(ID, template, [], -1, signal()));
  assert.equal(calls, 0);
});
test("private transport blocks absent, foreign and aborted identity before fetching", async () => {
  let calls = 0; const request = async () => { calls++; throw Error("Unexpected"); };
  await assert.rejects(api(request, () => null).get(ID, signal()));
  await assert.rejects(api(request, () => ({ ...user, uid: "foreign" })).get(ID, signal()));
  const abort = new AbortController(); abort.abort();
  await assert.rejects(api(request).get(ID, abort.signal)); assert.equal(calls, 0);
});
test("departed account responses cannot restore previous progress", async () => {
  let current = user;
  const pending = deferred();
  const client = api(async () => ({ ok: true, json: () => pending.promise }), () => current);
  const result = client.get(ID, signal()); await tick(); current = null; pending.resolve({ checklist: record() }); await assert.rejects(result);
  const token = deferred(); current = { uid: UID, getIdToken: () => token.promise };
  let fetched = false;
  const before = api(async () => { fetched = true; return response({ checklist: record() }); }, () => current).get(ID, signal());
  current = null; token.resolve("test-token"); await assert.rejects(before); assert.equal(fetched, false);
});
test("paginated lists validate duplicate references, status and cursor boundaries", async () => {
  const result = (value) => api(async () => response(value)).list({}, signal());
  assert.equal((await result({ checklists: [summary()], nextCursor: null })).checklists[0].completedItems, 1);
  for (const value of [{ checklists: [summary(), summary()], nextCursor: null }, { checklists: [summary()], nextCursor: OTHER }, { checklists: [], nextCursor: ID }]) await assert.rejects(result(value));
  await assert.rejects(api(async () => response({ checklists: [summary()], nextCursor: null })).list({ status: "complete" }, signal()));
});
test("HTTP failures preserve status without exposing response bodies", async () => {
  for (const status of [401, 403, 404, 409, 422, 503]) await assert.rejects(api(async () => ({ ok: false, status, json: () => { throw Error("Never read error body"); } })).get(ID, signal()), (error) => error instanceof ChecklistError && error.status === status);
});
test("controller loads without writes and waits for confirmed save, blocking duplicate clicks", async () => {
  const resource = new ChecklistResource(async () => record()); resource.start(); await tick();
  const pending = deferred(); let writes = 0;
  const saving = resource.mutate(() => { writes++; return pending.promise; }); await tick();
  assert.equal(resource.snapshot().saving, true); assert.equal(resource.snapshot().notice, "");
  assert.equal(await resource.mutate(async () => { writes++; return record(); }), undefined);
  pending.resolve(record({ revision: 2 })); await saving;
  assert.equal(writes, 1); assert.equal(resource.snapshot().value.revision, 2);
  assert.equal(resource.snapshot().notice, "Your checklist was saved."); resource.stop();
});
test("conflict and uncertain saves require reload before another write", async () => {
  for (const failure of [new ChecklistError(409), Error("private-network-details")]) {
    const resource = new ChecklistResource(async () => record()); resource.start(); await tick();
    await resource.mutate(async () => { throw failure; });
    assert.equal(resource.snapshot().needsReload, true); assert.equal(resource.snapshot().value.revision, 1);
    assert.equal(resource.snapshot().notice, ""); assert(!resource.snapshot().error.includes("private-network-details"));
    let writes = 0; await resource.mutate(async () => { writes++; return record(); }); assert.equal(writes, 0);
    await resource.reload(); assert.equal(resource.snapshot().needsReload, false); resource.stop();
  }
});
test("validation permits correction while missing or denied records clear loaded data", async () => {
  for (const status of [401, 403, 404, 422]) {
    const resource = new ChecklistResource(async () => record()); resource.start(); await tick();
    await resource.mutate(async () => { throw new ChecklistError(status); });
    if (status === 422) { assert.equal(resource.snapshot().status, "ready"); assert.equal(resource.snapshot().needsReload, false); }
    else { assert.equal(resource.snapshot().status, "error"); assert.equal(resource.snapshot().value, undefined); }
    resource.stop();
  }
});
test("cleanup and newer reloads ignore stale reads and confirmed writes", async () => {
  const old = deferred(); let calls = 0;
  const resource = new ChecklistResource(() => ++calls === 1 ? old.promise : Promise.resolve(record({ revision: 2 })));
  resource.start(); await tick(); await resource.reload(); old.resolve(record()); await tick(); assert.equal(resource.snapshot().value.revision, 2);
  const pending = deferred(); const saving = resource.mutate(() => pending.promise); await tick(); resource.stop(); pending.resolve(record({ revision: 3 })); assert.equal(await saving, undefined); assert.equal(resource.snapshot().status, "loading");
});
test("a save timeout retains the loaded revision and blocks ambiguous retries", async () => {
  const resource = new ChecklistResource(async () => record(), 15); resource.start(); await tick();
  const pending = deferred(); await resource.mutate(() => pending.promise);
  assert.equal(resource.snapshot().needsReload, true); assert.equal(resource.snapshot().value.revision, 1);
  pending.resolve(record({ revision: 2 })); await tick(); assert.equal(resource.snapshot().value.revision, 1); resource.stop();
});
