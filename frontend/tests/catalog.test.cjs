const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const ts = require("typescript");
const published = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../../backend/app/public_catalog.json"),
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
const {
  CatalogError,
  checkedDate,
  officialSource,
  parseDirectoryService,
  parseService,
  parseResource,
  createCatalogApi,
} = load("catalog/catalogApi.ts");
const { PublicResource } = load("catalog/PublicResource.ts");
const signal = () => new AbortController().signal;
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function resource(t, loader, allowNotFound = false, timeoutMs) {
  const controller = new PublicResource(loader, allowNotFound, timeoutMs);
  controller.start();
  t.after(controller.stop);
  return controller;
}
function response(value) {
  return { ok: true, json: async () => value };
}
function envelope(change = {}) {
  return {
    schemaVersion: 1,
    checkedOn: published.checkedOn,
    services: published.services,
    resources: published.resources,
    ...change,
  };
}

test("published records have real official links and correctly parsed public fields", () => {
  assert.equal(published.services.length, 3);
  assert.equal(published.resources.length, 6);
  for (const service of published.services) {
    assert.equal(parseService(service, service.id).id, service.id);
    assert.equal(parseDirectoryService(service).contact, undefined);
  }
  for (const item of published.resources)
    assert.equal(parseResource(item).source.url, item.source.url);
});

test("source URLs reject unsafe schemes, misleading hosts, credentials, queries and fragments", () => {
  for (const value of [
    "http://www.cak.go.ke/",
    "javascript:alert(1)",
    "https://www.cak.go.ke.evil.invalid/",
    "https://user:pass@www.nlas.go.ke/",
    "https://127.0.0.1/",
    "https://www.nlas.go.ke/?private=test",
    "https://www.nlas.go.ke/#private",
    "https://www.nlas.go.ke:444/",
    "https://www.nlas.go.ke/ space",
    null,
  ])
    assert.equal(officialSource(value), false);
  assert.equal(checkedDate("2026-02-31"), false);
  assert.equal(checkedDate("2026-11-02"), true);
});

test("malformed source reviews and foreign service identities cannot render as a profile", () => {
  const record = published.services[0];
  for (const change of [
    { id: "../private" },
    { sourceReview: null },
    { sourceReview: { ...record.sourceReview, checkedOn: "bad" } },
    { sourceReview: { ...record.sourceReview, sources: [] } },
    {
      sourceReview: {
        ...record.sourceReview,
        sources: [{ name: "Bad", url: "https://untrusted.invalid/" }],
      },
    },
  ])
    assert.throws(() => parseDirectoryService({ ...record, ...change }));
  assert.throws(() => parseService(record, "another-service"));
  assert.throws(() =>
    parseService(
      { ...record, officialWebsite: "https://untrusted.invalid/" },
      record.id,
    ),
  );
  assert.equal(
    parseService({ ...record, internalNotes: "private-test-only" }, record.id)
      .internalNotes,
    undefined,
  );
});

test("public requests send no bearer, cookies, body or search text", async () => {
  let captured;
  const api = createCatalogApi(
    "http://localhost:8000",
    async (url, options) => {
      captured = { url, options };
      return response(envelope());
    },
  );
  await api.services(signal());
  assert.equal(captured.url, "http://localhost:8000/api/v1/services");
  assert.deepEqual(JSON.parse(JSON.stringify(captured.options.headers)), {
    Accept: "application/json",
  });
  assert.equal(captured.options.body, undefined);
  assert.equal(captured.options.credentials, "omit");
  assert.equal(captured.options.cache, "no-store");
  assert.equal(captured.options.redirect, "error");
  assert.equal(captured.options.referrerPolicy, "no-referrer");
});

test("invalid service paths are rejected before any fetch", async () => {
  let calls = 0;
  const api = createCatalogApi("http://localhost:8000", async () => {
    calls++;
    throw Error("Not expected");
  });
  for (const id of [
    "../profile/me",
    "https://untrusted.invalid",
    "",
    "service?token=private",
    "a".repeat(65),
  ])
    await assert.rejects(api.service(id, signal()));
  assert.equal(calls, 0);
});

test("duplicate records, future review dates and unsupported envelopes are rejected", async () => {
  const catalog = (value) =>
    createCatalogApi("http://localhost:8000", async () => response(value));
  for (const value of [
    envelope({ schemaVersion: 2 }),
    envelope({ schemaVersion: true }),
    envelope({ services: [published.services[0], published.services[0]] }),
    envelope({ checkedOn: "2026-01-01" }),
  ])
    await assert.rejects(catalog(value).services(signal()));
  await assert.rejects(
    catalog(
      envelope({ resources: [published.resources[0], published.resources[0]] }),
    ).resources(signal()),
  );
  assert.throws(() =>
    parseResource({ ...published.resources[0], categories: ["invented"] }),
  );
});

test("empty published arrays are successful data rather than a fabricated unavailable state", async () => {
  const api = createCatalogApi("http://localhost:8000", async () =>
    response(envelope({ services: [], resources: [] })),
  );
  assert.equal((await api.services(signal())).length, 0);
  assert.equal((await api.resources(signal())).length, 0);
});

test("HTTP error bodies are not read, disclosed or converted to an empty catalogue", async () => {
  let parsed = false;
  const api = createCatalogApi("http://localhost:8000", async () => ({
    ok: false,
    status: 503,
    json: () => {
      parsed = true;
      throw Error("private-server-details");
    },
  }));
  await assert.rejects(
    api.services(signal()),
    (error) =>
      error.status === 503 && !error.message.includes("private-server-details"),
  );
  assert.equal(parsed, false);
});

test("aborted requests do not fetch or return late JSON", async () => {
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    createCatalogApi("http://localhost:8000").services(abort.signal),
  );
  const task = deferred(),
    controller = new AbortController();
  const api = createCatalogApi("http://localhost:8000", async () => ({
    ok: true,
    json: () => task.promise,
  }));
  const pending = api.resources(controller.signal);
  await tick();
  controller.abort();
  task.resolve(envelope());
  await assert.rejects(pending);
});

test("public resources publish loading and confirmed data without submitting anything", async (t) => {
  const task = deferred(),
    controller = resource(t, () => task.promise);
  assert.equal(controller.snapshot().status, "loading");
  task.resolve(published.services);
  await tick();
  assert.equal(controller.snapshot().status, "ready");
  assert.equal(controller.snapshot().value.length, 3);
});

test("404 is a profile not-found state but an unavailable-list error", async (t) => {
  const profile = resource(
    t,
    async () => {
      throw new CatalogError(404);
    },
    true,
  );
  const directory = resource(t, async () => {
    throw new CatalogError(404);
  });
  await tick();
  assert.equal(profile.snapshot().status, "not-found");
  assert.equal(directory.snapshot().status, "error");
});

test("unavailable reads support explicit retry without leaking failure details", async (t) => {
  let calls = 0;
  const controller = resource(t, async () => {
    if (++calls === 1) throw Error("private-details");
    return published.resources;
  });
  await tick();
  assert.equal(controller.snapshot().status, "error");
  assert.equal(controller.snapshot().message, undefined);
  await controller.reload();
  assert.equal(controller.snapshot().status, "ready");
  assert.equal(calls, 2);
});

test("late results cannot replace a newer service or restart lifecycle", async (t) => {
  const task = deferred();
  let calls = 0;
  const controller = resource(t, () =>
    ++calls === 1 ? task.promise : Promise.resolve(published.services[1]),
  );
  await tick();
  controller.stop();
  controller.start();
  await tick();
  task.resolve(published.services[0]);
  await tick();
  assert.equal(controller.snapshot().value.id, published.services[1].id);
});

test("hung requests time out into an error and ignore later completions", async (t) => {
  const task = deferred(),
    controller = resource(t, () => task.promise, false, 15);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(controller.snapshot().status, "error");
  controller.stop();
  task.resolve(published.services);
  await tick();
  assert.equal(controller.snapshot().status, "loading");
});
