const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  ts = require("typescript");
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
            path.resolve(__dirname, "../src"),
            path.resolve(path.dirname(file), `${name}.ts`),
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
const { createPathwayManagementApi, parsePathwayList, preparePathwayCommand } =
  load("admin/pathwayManagementApi.ts");
const { CatalogManagementResource } = load(
  "admin/CatalogManagementResource.ts",
);
class PathwayManagementResource extends CatalogManagementResource {
  constructor(api, timeoutMs = 12000) {
    super(api, timeoutMs, "pathway");
  }
}
const { AdminApiError } = load("admin/adminApi.ts");
const seed = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../../backend/app/public_pathways.json"),
    "utf8",
  ),
).pathways[0];
const UID = "admin-user";
const envelope = { schemaVersion: 1, uid: UID, role: "admin" };
const copy = (value) => JSON.parse(JSON.stringify(value));
const pathway = {
  ...copy(seed),
  id: "development-pathway",
  title: "Development pathway",
};
const row = {
  pathway,
  publication: "draft",
  revision: 1,
  everPublished: false,
  reviewNote: "",
  updatedAt: "2026-11-01T12:00:00Z",
  updatedBy: UID,
};
const listing = {
  ...envelope,
  records: [row],
  protectedPathwayIds: [seed.id],
  publishedServices: [{ id: seed.serviceId, name: "Published service" }],
};
const command = {
  type: "save",
  pathway,
  expectedRevision: 0,
  publication: "draft",
  reviewed: false,
  reviewNote: "",
};
const signal = () => new AbortController().signal;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { resolve, reject, promise };
}
function setup(request) {
  let current = { uid: UID, getIdToken: async () => "temporary-token" };
  return {
    api: createPathwayManagementApi({
      baseUrl: "http://localhost:8000",
      uid: UID,
      currentUser: () => current,
      request,
    }),
    switchUser: (user) => {
      current = user;
    },
    user: current,
  };
}

test("pathway lists validate owner, publication history and duplicates and strip unexpected fields", () => {
  const parsed = parsePathwayList({ ...listing, credential: "PRIVATE" }, UID);
  assert.equal(parsed.records[0].pathway.id, pathway.id);
  assert.equal(parsed.credential, undefined);
  for (const mutate of [
    (value) => (value.uid = "foreign"),
    (value) => (value.role = "provider"),
    (value) => value.records.push(copy(row)),
    (value) => (value.records[0].publication = "delivered"),
    (value) => (value.records[0].publication = "published"),
    (value) => (value.records[0].revision = true),
    (value) =>
      (value.records[0].pathway.sourceReview.sources[0].url =
        "https://evil.test"),
    (value) => (value.records[0].pathway.sourceReview.checkedOn = "2999-01-01"),
  ]) {
    const invalid = copy(listing);
    mutate(invalid);
    assert.throws(() => parsePathwayList(invalid, UID));
  }
});

test("writes whitelist fields and verify the saved pathway, publication and next revision", async () => {
  const requests = [];
  const { api } = setup(async (url, options) => {
    requests.push([url, options]);
    return { ok: true, json: async () => ({ ...envelope, record: row }) };
  });
  await api.write(
    {
      ...command,
      secret: "PRIVATE",
      pathway: { ...pathway, privateToken: "PRIVATE" },
    },
    signal(),
  );
  const [url, options] = requests[0];
  assert.equal(
    url,
    "http://localhost:8000/api/v1/admin/pathway-records/development-pathway",
  );
  assert.equal(options.method, "PUT");
  assert.equal(options.headers.Authorization, "Bearer temporary-token");
  assert.equal(options.credentials, "omit");
  assert.equal(options.cache, "no-store");
  assert.equal(options.redirect, "error");
  assert(!options.body.includes("PRIVATE"));
  assert.deepEqual(Object.keys(JSON.parse(options.body)).sort(), [
    "expectedRevision",
    "pathway",
    "reviewNote",
    "reviewed",
  ]);
  for (const mutate of [
    (value) => (value.record.pathway.title = "Wrong confirmation"),
    (value) => (value.record.revision = 99),
    (value) => (value.record.publication = "archived"),
    (value) => (value.uid = "foreign"),
  ]) {
    const confirmation = { ...envelope, record: copy(row) };
    mutate(confirmation);
    const broken = setup(async () => ({
      ok: true,
      json: async () => confirmation,
    }));
    await assert.rejects(broken.api.write(command, signal()));
  }
});

test("invalid IDs, source links, revisions and missing review fail before sending HTTP", async () => {
  let calls = 0;
  const { api } = setup(async () => {
    calls++;
    throw Error("Must not fetch");
  });
  for (const invalid of [
    { ...command, pathway: { ...pathway, id: "../escape" } },
    { ...command, expectedRevision: true },
    {
      ...command,
      pathway: {
        ...pathway,
        sourceReview: {
          ...pathway.sourceReview,
          sources: [{ name: "Source", url: "https://evil.test" }],
        },
      },
    },
    {
      type: "publication",
      id: pathway.id,
      expectedRevision: 1,
      publication: "published",
      reviewed: false,
      reviewNote: "",
    },
    { type: "delete", id: pathway.id, expectedRevision: 0 },
  ]) {
    await assert.rejects(api.write(invalid, signal()));
  }
  assert.equal(calls, 0);
  assert.equal(preparePathwayCommand(command).method, "PUT");
});

test("delete requires exact server confirmation and non-success bodies are not read", async () => {
  const deletion = { type: "delete", id: pathway.id, expectedRevision: 1 };
  let options;
  const good = setup(async (_, opts) => {
    options = opts;
    return {
      ok: true,
      json: async () => ({ ...envelope, deletedId: pathway.id, revision: 2 }),
    };
  });
  await good.api.write(deletion, signal());
  assert.equal(options.method, "DELETE");
  assert.deepEqual(JSON.parse(options.body), { expectedRevision: 1 });
  const wrong = setup(async () => ({
    ok: true,
    json: async () => ({ ...envelope, deletedId: "foreign", revision: 2 }),
  }));
  await assert.rejects(wrong.api.write(deletion, signal()));
  const failed = setup(async () => ({
    ok: false,
    status: 403,
    json: async () => {
      throw Error("Private error body was read");
    },
  }));
  await assert.rejects(
    failed.api.write(deletion, signal()),
    (error) => error.status === 403,
  );
});

test("missing, pre-aborted or switched accounts never send an old token", async () => {
  let calls = 0;
  const state = setup(async () => {
    calls++;
    return { ok: true, json: async () => listing };
  });
  const token = deferred();
  state.user.getIdToken = () => token.promise;
  const reading = state.api.read(signal());
  state.switchUser({ uid: "other" });
  token.resolve("old-token");
  await assert.rejects(reading);
  assert.equal(calls, 0);
  state.switchUser(null);
  await assert.rejects(state.api.read(signal()));
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(state.api.write(command, abort.signal));
  assert.equal(calls, 0);
});

test("account switches during HTTP or JSON discard pathway responses", async () => {
  for (const stage of ["http", "json"]) {
    let state;
    state = setup(async () => {
      if (stage === "http") state.switchUser(null);
      return {
        ok: true,
        json: async () => {
          if (stage === "json") state.switchUser(null);
          return listing;
        },
      };
    });
    await assert.rejects(state.api.read(signal()));
  }
});

test("opening is read-only; writes wait for confirmation and block double submits", async () => {
  const pending = deferred();
  let writes = 0;
  const resource = new PathwayManagementResource({
    read: async () => parsePathwayList(listing, UID),
    write: async () => {
      writes++;
      await pending.promise;
    },
  });
  const stop = resource.start();
  await tick();
  assert.equal(writes, 0);
  const saving = resource.change(command);
  assert.equal(resource.snapshot().busy, true);
  assert.equal(await resource.change(command), false);
  assert.equal(writes, 1);
  pending.resolve();
  assert.equal(await saving, true);
  assert.equal(resource.snapshot().busy, false);
  assert.equal(resource.snapshot().message, "Pathway change saved.");
  stop();
});

test("conflicts and unknown writes block retries until reload; validation stays editable", async () => {
  for (const status of [409, 503, 422]) {
    let writes = 0;
    const resource = new PathwayManagementResource({
      read: async () => parsePathwayList(listing, UID),
      write: async () => {
        writes++;
        throw new AdminApiError(status);
      },
    });
    const stop = resource.start();
    await tick();
    assert.equal(await resource.change(command), false);
    assert.equal(resource.snapshot().needsReload, status !== 422);
    if (status !== 422) {
      await resource.change(command);
      assert.equal(writes, 1);
    }
    await resource.reload();
    assert.equal(resource.snapshot().needsReload, false);
    stop();
  }
});

test("failed reads are errors and confirmed writes with failed refresh stay honestly saved", async () => {
  let reads = 0;
  const resource = new PathwayManagementResource({
    read: async () => {
      reads++;
      if (reads > 1) throw Error();
      return parsePathwayList(listing, UID);
    },
    write: async () => {},
  });
  const stop = resource.start();
  await tick();
  assert.equal(await resource.change(command), true);
  assert.equal(resource.snapshot().status, "error");
  assert.equal(resource.snapshot().value, null);
  assert(resource.snapshot().message.includes("was saved"));
  stop();
  const broken = new PathwayManagementResource({
    read: async () => {
      throw Error();
    },
    write: async () => {},
  });
  const close = broken.start();
  await tick();
  assert.equal(broken.snapshot().status, "error");
  assert.equal(broken.snapshot().value, null);
  close();
});

test("late unmounted writes cannot restore records and hung writes require reload", async () => {
  const pending = deferred();
  const resource = new PathwayManagementResource(
    {
      read: async () => parsePathwayList(listing, UID),
      write: () => pending.promise,
    },
    20,
  );
  const stop = resource.start();
  await tick();
  const saving = resource.change(command);
  stop();
  pending.resolve();
  assert.equal(await saving, false);
  assert.equal(resource.snapshot().value, null);
  const hung = new PathwayManagementResource(
    {
      read: async () => parsePathwayList(listing, UID),
      write: () => new Promise(() => {}),
    },
    15,
  );
  const close = hung.start();
  await tick();
  assert.equal(await hung.change(command), false);
  assert.equal(hung.snapshot().needsReload, true);
  assert.equal(hung.snapshot().busy, false);
  close();
});

test("permission denial clears previously loaded pathway data", async () => {
  const resource = new PathwayManagementResource({
    read: async () => parsePathwayList(listing, UID),
    write: async () => {
      throw new AdminApiError(403);
    },
  });
  const stop = resource.start();
  await tick();
  await resource.change(command);
  assert.equal(resource.snapshot().status, "forbidden");
  assert.equal(resource.snapshot().value, null);
  stop();
});

test("duplicate preparation IDs and forged service options are rejected", () => {
  const duplicate = copy(listing);
  duplicate.records[0].pathway.preparation.push(
    copy(duplicate.records[0].pathway.preparation[0]),
  );
  assert.throws(() => parsePathwayList(duplicate, UID));
  const foreign = copy(listing);
  foreign.records[0].publication = "published";
  foreign.records[0].everPublished = true;
  foreign.publishedServices = [];
  assert.throws(() => parsePathwayList(foreign, UID));
  const repeated = copy(listing);
  repeated.publishedServices.push(copy(repeated.publishedServices[0]));
  assert.throws(() => parsePathwayList(repeated, UID));
});

test("publishing uses the publication endpoint and validates its confirmation", async () => {
  let sent;
  const publishing = {
    type: "publication",
    id: pathway.id,
    expectedRevision: 1,
    publication: "published",
    reviewed: true,
    reviewNote: "Checked the sources.",
  };
  const state = setup(async (url, options) => {
    sent = [url, JSON.parse(options.body)];
    return {
      ok: true,
      json: async () => ({
        ...envelope,
        record: {
          ...row,
          publication: "published",
          everPublished: true,
          revision: 2,
        },
      }),
    };
  });
  await state.api.write(publishing, signal());
  assert(sent[0].endsWith("/development-pathway/publication"));
  assert.deepEqual(Object.keys(sent[1]).sort(), [
    "expectedRevision",
    "publication",
    "reviewNote",
    "reviewed",
  ]);
  assert.equal(sent[1].reviewed, true);
});

test("source-review dates use the Nairobi day across UTC midnight", () => {
  const { reviewToday } = load("catalog/reviewDate.ts");
  assert.equal(reviewToday(new Date("2026-11-18T21:30:00Z")), "2026-11-19");
  assert.equal(reviewToday(new Date("2026-11-18T20:59:59Z")), "2026-11-18");
});
