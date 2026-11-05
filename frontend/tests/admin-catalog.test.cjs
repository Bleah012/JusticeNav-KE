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

const { createAdminApi, parseAdmin, AdminApiError } = load("admin/adminApi.ts");
const { AdminResource } = load("admin/AdminResource.ts");
const { filterCatalog } = load("admin/catalogFilter.ts");
const catalog = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../../backend/app/public_catalog.json"),
    "utf8",
  ),
);
const guides = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../../backend/app/public_pathways.json"),
    "utf8",
  ),
);
const UID = "unit-user",
  base = { schemaVersion: 1, uid: UID, role: "admin", readOnly: true };
const overview = {
  ...base,
  services: catalog.services.length,
  pathways: guides.pathways.length,
  resources: catalog.resources.length,
  catalogCheckedOn: catalog.checkedOn,
  pathwaysCheckedOn: guides.checkedOn,
};
const services = {
  ...base,
  checkedOn: catalog.checkedOn,
  services: catalog.services,
};
const pathways = {
  ...base,
  checkedOn: guides.checkedOn,
  pathways: guides.pathways,
  serviceIds: catalog.services.map((row) => row.id),
};
const copy = (value) => JSON.parse(JSON.stringify(value));
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};

test("admin parsers accept exact source catalogue projections and discard unexpected metadata", () => {
  assert.equal(
    parseAdmin(overview, UID, "overview").resources,
    catalog.resources.length,
  );
  const parsed = parseAdmin(
    { ...services, privateAccount: "PRIVATE" },
    UID,
    "services",
  );
  assert.equal(parsed.services.length, catalog.services.length);
  assert(!JSON.stringify(parsed).includes("privateAccount"));
  assert(!Object.hasOwn(parsed.services[0], "contact"));
  assert.equal(
    parseAdmin(pathways, UID, "pathways").pathways[0].serviceId,
    guides.pathways[0].serviceId,
  );
});
test("identity, role, read-only contract, dates and bounded totals fail closed", () => {
  for (const change of [
    { uid: "foreign" },
    { role: "provider" },
    { readOnly: false },
    { readOnly: 1 },
    { schemaVersion: 2 },
    { services: true },
    { resources: -1 },
    { pathways: 31 },
    { catalogCheckedOn: "2099-01-01" },
    { catalogCheckedOn: "2026-02-30" },
  ])
    assert.throws(() =>
      parseAdmin({ ...overview, ...change }, UID, "overview"),
    );
});
test("catalogues reject duplicate IDs, unsafe sources, unknown related services and contradictory review dates", () => {
  assert.throws(() =>
    parseAdmin(
      { ...services, services: [catalog.services[0], catalog.services[0]] },
      UID,
      "services",
    ),
  );
  const bad = copy(services);
  bad.services[0].sourceReview.sources[0].url = "https://evil.example/";
  assert.throws(() => parseAdmin(bad, UID, "services"));
  assert.throws(() =>
    parseAdmin({ ...services, checkedOn: "2020-01-01" }, UID, "services"),
  );
  assert.throws(() =>
    parseAdmin({ ...pathways, serviceIds: [] }, UID, "pathways"),
  );
  assert.throws(() =>
    parseAdmin(
      { ...pathways, pathways: [guides.pathways[0], guides.pathways[0]] },
      UID,
      "pathways",
    ),
  );
});
test("valid empty catalogues are confirmed empty and real zero counts remain zero", () => {
  assert.equal(
    parseAdmin(
      { ...overview, services: 0, pathways: 0, resources: 0 },
      UID,
      "overview",
    ).services,
    0,
  );
  assert.equal(
    parseAdmin({ ...services, services: [] }, UID, "services").services.length,
    0,
  );
  assert.equal(
    parseAdmin({ ...pathways, pathways: [], serviceIds: [] }, UID, "pathways")
      .pathways.length,
    0,
  );
});
test("GET transport uses only fixed admin paths and an ephemeral bearer without private URL fields", async () => {
  const user = { uid: UID, getIdToken: async () => "unit-token" };
  let calls = 0;
  const api = createAdminApi({
    baseUrl: "http://localhost:8000",
    uid: UID,
    currentUser: () => user,
    request: async (url, options) => {
      calls++;
      assert.equal(url, "http://localhost:8000/api/v1/admin/overview");
      assert.equal(options.method, "GET");
      assert.equal(options.headers.Authorization, "Bearer unit-token");
      assert.equal(options.body, undefined);
      assert.equal(options.credentials, "omit");
      assert.equal(options.redirect, "error");
      assert.equal(options.cache, "no-store");
      return { ok: true, json: async () => overview };
    },
  });
  await api("overview", new AbortController().signal);
  assert.equal(calls, 1);
  await assert.rejects(api("../users", new AbortController().signal));
  assert.equal(calls, 1);
});
test("missing, foreign and pre-aborted accounts cannot request administrative data", async () => {
  let calls = 0;
  const request = async () => {
    calls++;
  };
  for (const user of [
    null,
    { uid: "foreign", getIdToken: async () => "unused" },
  ]) {
    const api = createAdminApi({
      baseUrl: "http://localhost:8000",
      uid: UID,
      currentUser: () => user,
      request,
    });
    await assert.rejects(api("overview", new AbortController().signal));
  }
  const abort = new AbortController();
  abort.abort();
  const user = { uid: UID, getIdToken: async () => "unused" };
  await assert.rejects(
    createAdminApi({
      baseUrl: "http://localhost:8000",
      uid: UID,
      currentUser: () => user,
      request,
    })("services", abort.signal),
  );
  assert.equal(calls, 0);
});
test("account changes during token lookup, HTTP and JSON discard old results", async () => {
  for (const phase of ["token", "http", "json"]) {
    let current;
    const user = {
      uid: UID,
      getIdToken: async () => {
        if (phase === "token") current = null;
        return "unit-token";
      },
    };
    current = user;
    let calls = 0;
    const api = createAdminApi({
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
            return overview;
          },
        };
      },
    });
    await assert.rejects(api("overview", new AbortController().signal));
    assert.equal(calls, phase === "token" ? 0 : 1);
  }
});
test("forbidden and failed HTTP responses never parse or expose their bodies", async () => {
  let reads = 0;
  const user = { uid: UID, getIdToken: async () => "unit-token" };
  for (const status of [401, 403, 503]) {
    const api = createAdminApi({
      baseUrl: "http://localhost:8000",
      uid: UID,
      currentUser: () => user,
      request: async () => ({
        ok: false,
        status,
        json: async () => {
          reads++;
          throw Error("PRIVATE");
        },
      }),
    });
    await assert.rejects(
      api("services", new AbortController().signal),
      (error) => error.status === status && !error.message.includes("PRIVATE"),
    );
  }
  assert.equal(reads, 0);
});
test("resource opening and refresh publish only confirmed reads and failed refresh clears old totals", async () => {
  let calls = 0;
  const resource = new AdminResource(async () => {
    calls++;
    if (calls === 2) throw new AdminApiError(503);
    return parseAdmin(overview, UID, "overview");
  });
  const stop = resource.start();
  await tick();
  assert.equal(resource.snapshot().status, "ready");
  await resource.reload();
  assert.equal(resource.snapshot().status, "error");
  assert.equal(resource.snapshot().value, undefined);
  stop();
});
test("permission denial clears records and supports retry after session recovery", async () => {
  let denied = true;
  const resource = new AdminResource(async () => {
    if (denied) throw new AdminApiError(403);
    return overview;
  });
  const stop = resource.start();
  await tick();
  assert.equal(resource.snapshot().status, "forbidden");
  denied = false;
  await resource.reload();
  assert.equal(resource.snapshot().status, "ready");
  stop();
});
test("newer pages and stopped lifecycles cannot publish late administrative data", async () => {
  const old = deferred();
  let calls = 0;
  const resource = new AdminResource(async () =>
    ++calls === 1 ? old.promise : overview,
  );
  const stop = resource.start();
  await tick();
  await resource.reload();
  old.resolve({ PRIVATE: "old" });
  await tick();
  assert.equal(resource.snapshot().value, overview);
  stop();
  assert.equal(resource.snapshot().status, "loading");
});
test("hung admin reads time out instead of showing guessed empty catalogues", async () => {
  const pending = deferred();
  const resource = new AdminResource(() => pending.promise, true, 5);
  const stop = resource.start();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(resource.snapshot().status, "error");
  pending.resolve(overview);
  await tick();
  assert.equal(resource.snapshot().status, "error");
  stop();
});
test("local filters, source-date sorting and pagination retain stable actual rows", () => {
  const rows = Array.from({ length: 23 }, (_, i) => ({
    id: String(i),
    title: `Service ${String(i).padStart(2, "0")}`,
    category: i % 2 ? "Consumer" : "Civil",
    location: "Kenya",
    checkedOn: i % 2 ? "2026-11-02" : "2026-10-01",
    sources: [],
    publicPath: "/services/unit-service",
    serviceId: null,
  }));
  const second = filterCatalog(rows, "", "all", "title", 2);
  assert.equal(second.visible.length, 10);
  assert.equal(second.visible[0].id, "10");
  assert.equal(second.total, 23);
  assert.equal(
    filterCatalog(rows, "", "Consumer", "newest", 99).currentPage,
    2,
  );
  assert.equal(filterCatalog(rows, " kenya ", "Civil", "oldest", 1).total, 12);
  assert.equal(filterCatalog(rows, "missing", "all", "title", 2).total, 0);
  assert.equal(
    filterCatalog(rows, "Service 22", "all", "title", 1).visible[0].id,
    "22",
  );
  assert.equal(rows[0].id, "0");
});
