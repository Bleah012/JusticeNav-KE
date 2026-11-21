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
const {
  createResourceManagementApi,
  parseResourceList,
  prepareResourceCommand,
} = load("admin/resourceManagementApi.ts");
const { CatalogManagementResource } = load(
  "admin/CatalogManagementResource.ts",
);
class ResourceManagementResource extends CatalogManagementResource {
  constructor(api, timeoutMs = 12000) {
    super(api, timeoutMs, "resource");
  }
}
const { AdminApiError } = load("admin/adminApi.ts");
const seed = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../../backend/app/public_catalog.json"),
    "utf8",
  ),
).resources[0];
const UID = "admin-user";
const envelope = { schemaVersion: 1, uid: UID, role: "admin" };
const copy = (value) => JSON.parse(JSON.stringify(value));
const resource = {
  ...copy(seed),
  id: "development-resource",
  title: "Development resource",
};
const row = {
  resource,
  publication: "draft",
  revision: 1,
  everPublished: false,
  reviewNote: "",
  updatedAt: "2026-11-01T12:00:00Z",
  updatedBy: UID,
};
const listing = { ...envelope, records: [row] };
const command = {
  type: "save",
  resource,
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
    api: createResourceManagementApi({
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

test("resource lists validate owner, publication history and duplicates and strip unexpected fields", () => {
  const parsed = parseResourceList({ ...listing, credential: "PRIVATE" }, UID);
  assert.equal(parsed.records[0].resource.id, resource.id);
  assert.equal(parsed.credential, undefined);
  for (const mutate of [
    (value) => (value.uid = "foreign"),
    (value) => (value.role = "provider"),
    (value) => value.records.push(copy(row)),
    (value) => (value.records[0].publication = "delivered"),
    (value) => (value.records[0].publication = "published"),
    (value) => (value.records[0].revision = true),
    (value) => (value.records[0].resource.source.url = "https://evil.test"),
    (value) => (value.records[0].resource.source.checkedOn = "2999-01-01"),
  ]) {
    const invalid = copy(listing);
    mutate(invalid);
    assert.throws(() => parseResourceList(invalid, UID));
  }
});

test("writes whitelist fields and verify the saved resource, publication and next revision", async () => {
  const requests = [];
  const { api } = setup(async (url, options) => {
    requests.push([url, options]);
    return { ok: true, json: async () => ({ ...envelope, record: row }) };
  });
  await api.write(
    {
      ...command,
      secret: "PRIVATE",
      resource: { ...resource, privateToken: "PRIVATE" },
    },
    signal(),
  );
  const [url, options] = requests[0];
  assert.equal(
    url,
    "http://localhost:8000/api/v1/admin/resource-records/development-resource",
  );
  assert.equal(options.method, "PUT");
  assert.equal(options.headers.Authorization, "Bearer temporary-token");
  assert.equal(options.credentials, "omit");
  assert.equal(options.cache, "no-store");
  assert.equal(options.redirect, "error");
  assert(!options.body.includes("PRIVATE"));
  assert.deepEqual(Object.keys(JSON.parse(options.body)).sort(), [
    "expectedRevision",
    "resource",
    "reviewNote",
    "reviewed",
  ]);
  for (const mutate of [
    (value) => (value.record.resource.title = "Wrong confirmation"),
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
    { ...command, resource: { ...resource, id: "../escape" } },
    { ...command, expectedRevision: true },
    {
      ...command,
      resource: {
        ...resource,
        source: { ...resource.source, url: "https://evil.test" },
      },
    },
    {
      type: "publication",
      id: resource.id,
      expectedRevision: 1,
      publication: "published",
      reviewed: false,
      reviewNote: "",
    },
    { type: "delete", id: resource.id, expectedRevision: 0 },
  ]) {
    await assert.rejects(api.write(invalid, signal()));
  }
  assert.equal(calls, 0);
  assert.equal(prepareResourceCommand(command).method, "PUT");
});

test("delete requires exact server confirmation and non-success bodies are not read", async () => {
  const deletion = { type: "delete", id: resource.id, expectedRevision: 1 };
  let options;
  const good = setup(async (_, opts) => {
    options = opts;
    return {
      ok: true,
      json: async () => ({ ...envelope, deletedId: resource.id, revision: 2 }),
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

test("account switches during HTTP or JSON discard resource responses", async () => {
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
  const resource = new ResourceManagementResource({
    read: async () => parseResourceList(listing, UID),
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
  assert.equal(resource.snapshot().message, "Resource change saved.");
  stop();
});

test("conflicts and unknown writes block retries until reload; validation stays editable", async () => {
  for (const status of [409, 503, 422]) {
    let writes = 0;
    const resource = new ResourceManagementResource({
      read: async () => parseResourceList(listing, UID),
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
  const resource = new ResourceManagementResource({
    read: async () => {
      reads++;
      if (reads > 1) throw Error();
      return parseResourceList(listing, UID);
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
  const broken = new ResourceManagementResource({
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
  const resource = new ResourceManagementResource(
    {
      read: async () => parseResourceList(listing, UID),
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
  const hung = new ResourceManagementResource(
    {
      read: async () => parseResourceList(listing, UID),
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

test("permission denial clears previously loaded resource data", async () => {
  const resource = new ResourceManagementResource({
    read: async () => parseResourceList(listing, UID),
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

test("Employment resource commands preserve the category for admin saves and reads", () => {
  const employment = { ...resource, categories: ["employment"] };
  const prepared = prepareResourceCommand({ ...command, resource: employment });
  assert.equal(prepared.body.resource.categories[0], "employment");
  const parsed = parseResourceList({ ...listing, records: [{ ...row, resource: employment }] }, UID);
  assert.equal(parsed.records[0].resource.categories[0], "employment");
});

test("categories reject empty, duplicate and unsupported values before sending HTTP", async () => {
  let calls = 0;
  const state = setup(async () => {
    calls++;
    throw Error("Must not fetch");
  });
  for (const categories of [[], ["consumer", "consumer"], ["unknown"]]) {
    await assert.rejects(
      state.api.write(
        { ...command, resource: { ...resource, categories } },
        signal(),
      ),
    );
  }
  assert.equal(calls, 0);
});

test("resource lists accept confirmed emptiness and bound records to the catalogue limit", () => {
  assert.equal(
    parseResourceList({ ...envelope, records: [] }, UID).records.length,
    0,
  );
  const oversized = {
    ...envelope,
    records: Array.from({ length: 101 }, (_, index) => ({
      ...copy(row),
      resource: { ...copy(resource), id: `resource-${index}` },
    })),
  };
  assert.throws(() => parseResourceList(oversized, UID));
});

test("publication sends only named transition fields and requires exact confirmation", async () => {
  const publishing = {
    type: "publication",
    id: resource.id,
    expectedRevision: 1,
    publication: "published",
    reviewed: true,
    reviewNote: "Reviewed the official source.",
  };
  let sent;
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
  assert(sent[0].endsWith("/development-resource/publication"));
  assert.deepEqual(Object.keys(sent[1]).sort(), [
    "expectedRevision",
    "publication",
    "reviewNote",
    "reviewed",
  ]);
});
