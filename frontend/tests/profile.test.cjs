const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const cache = new Map();
// Load pure API/controller modules only; a missing fake fetch fails immediately.
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
      require: (id) => {
        if (!id.startsWith(".")) throw Error("Unexpected import: " + id);
        return load(
          path.relative(
            path.join(__dirname, "../src"),
            path.resolve(path.dirname(file), id + ".ts"),
          ),
        );
      },
      URL,
      AbortController,
      setTimeout,
      clearTimeout,
      fetch: () => {
        throw Error("Live network is forbidden in profile tests");
      },
    },
    { filename: file },
  );
  return mod.exports;
}
const { createAuthenticatedRequest, ProfileApiError } = load(
  "api/authenticatedRequest.ts",
);
const { createProfileApi, parseProfile } = load("profile/profileModel.ts");
const { ProfileController } = load("profile/ProfileController.ts");
const fields = {
  fullName: "Test Person",
  phone: null,
  preferredLanguage: "en",
};
const profile = (uid = "user-a", revision = 1) => ({
  ...fields,
  uid,
  revision,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function makeController(t, api, timeoutMs) {
  const controller = new ProfileController(api, timeoutMs);
  controller.start();
  t.after(controller.stop);
  return controller;
}

test("profile schema rejects foreign owners, malformed fields, revisions and dates", () => {
  assert.equal(parseProfile(profile(), "user-a").fullName, fields.fullName);
  for (const change of [
    { uid: "other" },
    { fullName: "" },
    { fullName: "A\nB" },
    { phone: "0712345678" },
    { preferredLanguage: "xx" },
    { revision: true },
    { revision: 0 },
    { revision: "1" },
    { createdAt: "not-a-date" },
    { updatedAt: "2025-01-01T00:00:00Z" },
  ]) {
    assert.throws(() => parseProfile({ ...profile(), ...change }, "user-a"));
  }
  assert.equal(
    parseProfile(
      { ...profile(), role: "admin", email: "extra@example.invalid" },
      "user-a",
    ).role,
    undefined,
  );
});

test("API request sends token without cookies, redirects, cached responses or query data", async () => {
  const user = { uid: "user-a", getIdToken: async () => "unit-token" };
  let captured;
  const request = createAuthenticatedRequest({
    baseUrl: "http://localhost:8000",
    currentUser: () => user,
    request: async (url, options) => {
      captured = { url, options };
      return { ok: true, json: async () => ({ profile: null }) };
    },
  });
  await request("user-a", "GET", undefined, new AbortController().signal);
  assert.equal(captured.url, "http://localhost:8000/api/v1/profile/me");
  assert.equal(captured.options.headers.Authorization, "Bearer unit-token");
  assert.equal(captured.options.credentials, "omit");
  assert.equal(captured.options.redirect, "error");
  assert.equal(captured.options.cache, "no-store");
  assert.equal(captured.options.referrerPolicy, "no-referrer");
  assert.equal(captured.options.body, undefined);
});

test("account change during token retrieval prevents the request", async () => {
  const token = deferred();
  let user = { uid: "user-a", getIdToken: () => token.promise };
  let called = false;
  const request = createAuthenticatedRequest({
    baseUrl: "http://localhost:8000",
    currentUser: () => user,
    request: async () => {
      called = true;
    },
  });
  const pending = request(
    "user-a",
    "PUT",
    fields,
    new AbortController().signal,
  );
  user = { uid: "user-b", getIdToken: async () => "other" };
  token.resolve("unit-token");
  await assert.rejects(pending);
  assert.equal(called, false);
});

test("account changes while receiving a response discard the previous account's data", async () => {
  for (const phase of ["response", "json"]) {
    const task = deferred();
    let user = { uid: "user-a", getIdToken: async () => "unit-token" };
    const response = {
      ok: true,
      json: () =>
        phase === "json"
          ? task.promise
          : Promise.resolve({ profile: profile() }),
    };
    const request = createAuthenticatedRequest({
      baseUrl: "http://localhost:8000",
      currentUser: () => user,
      request: () =>
        phase === "response" ? task.promise : Promise.resolve(response),
    });
    const pending = request(
      "user-a",
      "GET",
      undefined,
      new AbortController().signal,
    );
    await tick();
    user = { uid: "user-b", getIdToken: async () => "other" };
    task.resolve(phase === "response" ? response : { profile: profile() });
    await assert.rejects(
      pending,
      (error) => error instanceof ProfileApiError && error.status === 401,
    );
  }
});

test("absent or mismatched identity and aborted requests never fetch", async () => {
  for (const user of [
    null,
    { uid: "other", getIdToken: async () => "unit-token" },
  ]) {
    const request = createAuthenticatedRequest({
      baseUrl: "http://localhost:8000",
      currentUser: () => user,
    });
    await assert.rejects(
      request("user-a", "GET", undefined, new AbortController().signal),
    );
  }
  const abort = new AbortController();
  abort.abort();
  const request = createAuthenticatedRequest({
    baseUrl: "http://localhost:8000",
    currentUser: () => ({
      uid: "user-a",
      getIdToken: async () => "unit-token",
    }),
  });
  await assert.rejects(request("user-a", "GET", undefined, abort.signal));
});

test("profile API serializes only writable fields and checks the saved owner/revision", async () => {
  let captured;
  const api = createProfileApi("user-a", async (uid, method, body) => {
    captured = { uid, method, body };
    return { profile: profile() };
  });
  await api.save(
    {
      ...fields,
      fullName: "  Test Person  ",
      uid: "other",
      email: "private@example.invalid",
      role: "admin",
      password: "private-test-only",
    },
    0,
    new AbortController().signal,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(captured)), {
    uid: "user-a",
    method: "PUT",
    body: { ...fields, expectedRevision: 0 },
  });
  const wrongOwner = createProfileApi("user-a", async () => ({
    profile: profile("other"),
  }));
  await assert.rejects(wrongOwner.load(new AbortController().signal));
  await assert.rejects(
    wrongOwner.save(fields, 0, new AbortController().signal),
  );
  const wrongRevision = createProfileApi("user-a", async () => ({
    profile: profile("user-a", 9),
  }));
  await assert.rejects(
    wrongRevision.save(fields, 0, new AbortController().signal),
  );
});

test("missing profile remains null and never triggers a write", async (t) => {
  let saves = 0;
  const controller = makeController(t, {
    load: async () => null,
    save: async () => {
      saves++;
      return profile();
    },
  });
  await tick();
  assert.equal(controller.snapshot().status, "ready");
  assert.equal(controller.snapshot().profile, null);
  assert.equal(controller.snapshot().notice, "");
  assert.equal(saves, 0);
});

test("successful save waits for confirmation and blocks duplicate submissions", async (t) => {
  const task = deferred();
  let writes = 0;
  const controller = makeController(t, {
    load: async () => null,
    save: async (_fields, revision) => {
      writes++;
      assert.equal(revision, 0);
      return task.promise;
    },
  });
  await tick();
  const pending = controller.save(fields);
  await controller.save(fields);
  await tick();
  assert.equal(writes, 1);
  assert.equal(controller.snapshot().saving, true);
  assert.equal(controller.snapshot().notice, "");
  task.resolve(profile());
  await pending;
  assert.equal(controller.snapshot().profile.revision, 1);
  assert.equal(
    controller.snapshot().notice,
    "Your profile changes were saved.",
  );
});

test("conflict preserves the loaded profile and requires a reload before another save", async (t) => {
  let loads = 0,
    writes = 0;
  const controller = makeController(t, {
    load: async () => {
      loads++;
      return profile("user-a", loads);
    },
    save: async () => {
      writes++;
      throw new ProfileApiError(409);
    },
  });
  await tick();
  await controller.save(fields);
  assert.equal(controller.snapshot().profile.revision, 1);
  assert.equal(controller.snapshot().needsReload, true);
  assert.equal(controller.snapshot().notice, "");
  await controller.save(fields);
  assert.equal(writes, 1);
  await controller.reload();
  assert.equal(controller.snapshot().profile.revision, 2);
  assert.equal(controller.snapshot().needsReload, false);
});

test("uncertain save failure never claims the data was not saved or invents success", async (t) => {
  const controller = makeController(t, {
    load: async () => profile(),
    save: async () => {
      throw Error("private server details");
    },
  });
  await tick();
  await controller.save(fields);
  assert.equal(controller.snapshot().notice, "");
  assert.equal(controller.snapshot().needsReload, true);
  assert(controller.snapshot().error.includes("could not be confirmed"));
  assert(!controller.snapshot().error.includes("private"));
});

test("server validation keeps the form editable without echoing submitted values", async (t) => {
  const controller = makeController(t, {
    load: async () => null,
    save: async () => {
      throw new ProfileApiError(422);
    },
  });
  await tick();
  await controller.save(fields);
  assert.equal(controller.snapshot().status, "ready");
  assert.equal(controller.snapshot().needsReload, false);
  assert.equal(controller.snapshot().profile, null);
});

test("authentication denial clears the profile from the controller", async (t) => {
  for (const status of [401, 403]) {
    const controller = makeController(t, {
      load: async () => profile(),
      save: async () => {
        throw new ProfileApiError(status);
      },
    });
    await tick();
    await controller.save(fields);
    assert.equal(controller.snapshot().status, "error");
    assert.equal(controller.snapshot().profile, undefined);
  }
});

test("late load/save responses cannot restore data after cleanup", async (t) => {
  const loadTask = deferred();
  const controller = makeController(t, {
    load: () => loadTask.promise,
    save: async () => profile(),
  });
  await tick();
  controller.stop();
  loadTask.resolve(profile());
  await tick();
  assert.equal(controller.snapshot().status, "loading");
  const saveTask = deferred();
  const saving = makeController(t, {
    load: async () => profile(),
    save: () => saveTask.promise,
  });
  await tick();
  const pending = saving.save(fields);
  await tick();
  saving.stop();
  saveTask.resolve(profile("user-a", 2));
  await pending;
  assert.equal(saving.snapshot().status, "loading");
});

test("a newer reload wins over an older response during StrictMode restart", async (t) => {
  const tasks = [deferred(), deferred()];
  let calls = 0;
  const controller = makeController(t, {
    load: () => tasks[calls++].promise,
    save: async () => profile(),
  });
  await tick();
  controller.stop();
  controller.start();
  await tick();
  tasks[1].resolve(profile("user-a", 2));
  await tick();
  tasks[0].resolve(profile("user-a", 1));
  await tick();
  assert.equal(controller.snapshot().profile.revision, 2);
});

test("a hung save times out, retains the loaded revision and requests reload", async (t) => {
  const controller = makeController(
    t,
    { load: async () => profile(), save: () => new Promise(() => {}) },
    20,
  );
  await tick();
  await controller.save(fields);
  assert.equal(controller.snapshot().profile.revision, 1);
  assert.equal(controller.snapshot().needsReload, true);
  assert.equal(controller.snapshot().notice, "");
});

test("failed HTTP responses are not parsed or exposed", async () => {
  const user = { uid: "user-a", getIdToken: async () => "unit-token" };
  for (const status of [401, 403, 409, 422, 503]) {
    const request = createAuthenticatedRequest({
      baseUrl: "http://localhost:8000",
      currentUser: () => user,
      request: async () => ({
        ok: false,
        status,
        json: () => {
          throw Error("Must not read server errors");
        },
      }),
    });
    await assert.rejects(
      request("user-a", "PUT", fields, new AbortController().signal),
      (error) => error instanceof ProfileApiError && error.status === status,
    );
  }
});
