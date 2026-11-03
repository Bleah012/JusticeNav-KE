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

const {
  createPathwayApi,
  createNavigationRequest,
  parseNavigation,
  parsePathway,
  parseReview,
} = load("pathways/pathwayApi.ts");
const { CatalogError } = load("catalog/catalogApi.ts");
const { PublicResource } = load("catalog/PublicResource.ts");
const signal = () => new AbortController().signal;
const response = (value) => ({ ok: true, json: async () => value });
const copy = (value) => JSON.parse(JSON.stringify(value));
const ID = "a".repeat(32);
const user = { uid: "owner", getIdToken: async () => "ephemeral-test-token" };
const navigation = () => ({
  schemaVersion: 1,
  assessmentId: ID,
  uid: user.uid,
  revision: 2,
  method: "selected-category-v1",
  selectedIssue: "consumer",
  checkedOn: published.checkedOn,
  pathways: published.pathways
    .slice(0, 2)
    .map((pathway) => ({ pathway, reason: "Saved category selection only." })),
});
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

test("reviewed pathways and preparation items parse with genuine source URLs", () => {
  assert.equal(published.pathways.length, 3);
  for (const pathway of published.pathways) {
    const parsed = parsePathway(pathway, pathway.id);
    assert.equal(parsed.sourceReview.checkedOn, "2026-11-03");
    assert.equal(parsed.preparation.length, 3);
  }
  assert(published.pathways[2].whoMayUse.includes("debt recovery"));
});
test("foreign pathway identities, duplicate tick IDs and invalid sources are rejected", () => {
  const pathway = copy(published.pathways[0]);
  assert.throws(() => parsePathway(pathway, "other-pathway"));
  pathway.preparation.push(pathway.preparation[0]);
  assert.throws(() => parsePathway(pathway));
  for (const url of [
    "javascript:alert(1)",
    "https://cak.go.ke.untrusted.invalid/",
    "https://cak.go.ke/?private=data",
  ]) {
    assert.throws(() =>
      parseReview({
        ...published.pathways[0].sourceReview,
        sources: [{ name: "Invalid", url }],
      }),
    );
  }
});
test("public detail and checklist transport sends no token, cookie, body or query", async () => {
  const requests = [];
  const pathway = published.pathways[0];
  const api = createPathwayApi(
    "http://localhost:8000",
    async (url, options) => {
      requests.push({ url, options });
      return response(
        url.endsWith("/preparation")
          ? {
              schemaVersion: 1,
              pathwayId: pathway.id,
              pathwayTitle: pathway.title,
              sourceReview: pathway.sourceReview,
              items: pathway.preparation,
            }
          : { schemaVersion: 1, pathway },
      );
    },
  );
  await api.get(pathway.id, signal());
  await api.preparation(pathway.id, signal());
  for (const { url, options } of requests) {
    assert(!url.includes("?"));
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.credentials, "omit");
    assert.equal(options.body, undefined);
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    assert.equal(options.referrerPolicy, "no-referrer");
  }
});
test("public lists validate dates, duplicate guides and empty published data", async () => {
  const api = (value) =>
    createPathwayApi("http://localhost:8000", async () => response(value));
  assert.equal((await api(published).list(signal())).length, 3);
  assert.equal(
    (await api({ ...published, pathways: [] }).list(signal())).length,
    0,
  );
  await assert.rejects(
    api({
      ...published,
      pathways: [published.pathways[0], published.pathways[0]],
    }).list(signal()),
  );
  await assert.rejects(
    api({ ...published, checkedOn: "2026-01-01" }).list(signal()),
  );
  await assert.rejects(
    api({ ...published, schemaVersion: true }).list(signal()),
  );
});
test("unsafe identifiers and pre-aborted public requests never fetch", async () => {
  let calls = 0;
  const api = createPathwayApi("http://localhost:8000", async () => {
    calls++;
    throw Error("Unexpected");
  });
  for (const id of ["../profile/me", "", "x?secret=private", "a".repeat(65)]) {
    await assert.rejects(api.get(id, signal()));
    await assert.rejects(api.preparation(id, signal()));
  }
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(api.list(abort.signal));
  assert.equal(calls, 0);
});
test("results verify owner, reference, revision, method, category and exact mapping", () => {
  assert.equal(parseNavigation(navigation(), user.uid, ID).pathways.length, 2);
  for (const update of [
    { uid: "foreign" },
    { assessmentId: "b".repeat(32) },
    { revision: 0 },
    { method: "ai-guessed" },
    { selectedIssue: "invented" },
    { selectedIssue: "money-debt" },
    { pathways: [] },
    { checkedOn: "2026-01-01" },
  ])
    assert.throws(() =>
      parseNavigation({ ...navigation(), ...update }, user.uid, ID),
    );
  const other = { ...navigation(), selectedIssue: "other", pathways: [] };
  assert.equal(parseNavigation(other, user.uid, ID).pathways.length, 0);
});
test("private result request has only opaque path and bearer; no description or answers", async () => {
  let captured;
  const get = createNavigationRequest({
    baseUrl: "http://localhost:8000",
    currentUser: () => user,
    request: async (url, options) => {
      captured = { url, options };
      return response(navigation());
    },
  });
  await get(user.uid, ID, signal());
  assert.equal(
    captured.url,
    `http://localhost:8000/api/v1/assessments/${ID}/pathways`,
  );
  assert.equal(captured.options.method, "GET");
  assert.equal(captured.options.body, undefined);
  assert.equal(
    captured.options.headers.Authorization,
    "Bearer ephemeral-test-token",
  );
  assert.equal(captured.options.credentials, "omit");
  assert.equal(captured.options.cache, "no-store");
  assert.equal(captured.options.redirect, "error");
  assert.equal(captured.options.referrerPolicy, "no-referrer");
});
test("missing, foreign or aborted identity and invalid assessment ID cannot fetch", async () => {
  let calls = 0;
  const get = (currentUser) =>
    createNavigationRequest({
      baseUrl: "http://localhost:8000",
      currentUser,
      request: async () => {
        calls++;
        throw Error("Unexpected");
      },
    });
  await assert.rejects(get(() => null)(user.uid, ID, signal()));
  await assert.rejects(get(() => user)("foreign", ID, signal()));
  await assert.rejects(get(() => user)(user.uid, "bad", signal()));
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(get(() => user)(user.uid, ID, abort.signal));
  assert.equal(calls, 0);
});
test("account changes during token retrieval or response JSON discard old results", async () => {
  let current = user,
    calls = 0;
  const token = deferred();
  current = { uid: user.uid, getIdToken: () => token.promise };
  const get = createNavigationRequest({
    baseUrl: "http://localhost:8000",
    currentUser: () => current,
    request: async () => {
      calls++;
      return response(navigation());
    },
  });
  const pending = get(user.uid, ID, signal());
  current = null;
  token.resolve("private");
  await assert.rejects(pending);
  assert.equal(calls, 0);
  current = user;
  const payload = deferred();
  const read = createNavigationRequest({
    baseUrl: "http://localhost:8000",
    currentUser: () => current,
    request: async () => ({ ok: true, json: () => payload.promise }),
  });
  const reading = read(user.uid, ID, signal());
  await tick();
  current = null;
  payload.resolve(navigation());
  await assert.rejects(reading);
});
test("HTTP errors are preserved without parsing error bodies", async () => {
  for (const status of [401, 403, 404, 409, 503]) {
    const get = createNavigationRequest({
      baseUrl: "http://localhost:8000",
      currentUser: () => user,
      request: async () => ({
        ok: false,
        status,
        json: () => {
          throw Error("Do not parse");
        },
      }),
    });
    await assert.rejects(
      get(user.uid, ID, signal()),
      (error) => error instanceof CatalogError && error.status === status,
    );
  }
});
test("checklist parser rejects another pathway and duplicate item identities", async () => {
  const pathway = published.pathways[0];
  const data = {
    schemaVersion: 1,
    pathwayId: pathway.id,
    pathwayTitle: pathway.title,
    sourceReview: pathway.sourceReview,
    items: pathway.preparation,
  };
  for (const change of [
    { pathwayId: "another-pathway" },
    { items: [data.items[0], data.items[0]] },
  ]) {
    const api = createPathwayApi("http://localhost:8000", async () =>
      response({ ...data, ...change }),
    );
    await assert.rejects(api.preparation(pathway.id, signal()));
  }
});
test("result controller cleanup prevents late owner results appearing after departure", async () => {
  const pending = deferred();
  const resource = new PublicResource(() => pending.promise, true);
  resource.start();
  await tick();
  resource.stop();
  pending.resolve(navigation());
  await tick();
  assert.equal(resource.snapshot().status, "loading");
});
