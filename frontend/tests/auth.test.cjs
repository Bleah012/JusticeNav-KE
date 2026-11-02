const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// Compile only the proposed auth modules; all SDK/network operations below are doubles.
function load(name, stubs = {}, globals = {}) {
  const file = path.join(__dirname, "../src/auth", name + ".ts");
  const source = fs
    .readFileSync(file, "utf8")
    .replaceAll("import.meta.env", "testEnvironment");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(
    output,
    {
      module: mod,
      exports: mod.exports,
      require: (id) => {
        if (!(id in stubs)) throw Error("Unexpected dependency: " + id);
        return stubs[id];
      },
      AbortController,
      URL,
      fetch: () => {
        throw Error("Live network is forbidden in auth tests");
      },
      setTimeout,
      clearTimeout,
      ...globals,
    },
    { filename: file },
  );
  return mod.exports;
}
const model = load("session");
const identity = (uid = "user-a", role = "seeker") => ({
  uid,
  role,
  emailVerified: false,
});
const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function controller(t, verify, logout = async () => {}, library = model) {
  const subscriptions = [];
  const instance = new library.SessionController({
    subscribe: (next, error) => {
      subscriptions.push({ next, error });
      return () => {};
    },
    verify,
    signOut: logout,
  });
  instance.start();
  t.after(instance.stop);
  return {
    instance,
    subscriptions,
    emit: (user) => subscriptions.at(-1).next(user),
  };
}

test("identity requires matching UID, known role and boolean email verification", () => {
  for (const role of ["seeker", "provider", "admin"])
    assert.equal(
      model.parseIdentity(identity("user-a", role), "user-a").role,
      role,
    );
  for (const value of [
    null,
    {},
    identity("other"),
    identity("user-a", "owner"),
    { ...identity(), emailVerified: "true" },
  ])
    assert.throws(() => model.parseIdentity(value, "user-a"));
  assert.equal(model.workspaceFor("admin"), "/admin");
  assert.equal(model.workspaceFor("provider"), "/provider");
  assert.equal(model.workspaceFor("seeker"), "/app");
});

test("API origins reject credentials, insecure remote hosts, paths and URL payloads", () => {
  for (const url of [
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "https://api.example.test",
  ])
    assert(model.apiOrigin(url));
  for (const url of [
    "",
    "javascript:alert(1)",
    "http://remote.example",
    "https://user:pass@api.example",
    "https://api.example/path",
    "https://api.example?token=bad",
    "https://api.example#bad",
  ])
    assert.throws(() => model.apiOrigin(url));
});

test("identity request sends only an ephemeral bearer token to the configured API", async () => {
  let captured;
  const signal = new AbortController().signal;
  const result = await model.requestIdentity(
    "http://localhost:8000",
    "user-a",
    "test-token",
    signal,
    async (url, options) => {
      captured = { url, options };
      return { ok: true, status: 200, json: async () => identity() };
    },
  );
  assert.equal(result.uid, "user-a");
  assert.equal(captured.url, "http://localhost:8000/api/v1/auth/me");
  assert.equal(captured.options.headers.Authorization, "Bearer test-token");
  assert.equal(captured.options.credentials, "omit");
  assert.equal(captured.options.redirect, "error");
  assert.equal(captured.options.cache, "no-store");
  assert.equal(captured.options.referrerPolicy, "no-referrer");
  assert.equal(captured.options.signal, signal);
  assert.equal(captured.options.body, undefined);
});

test("API failures are denied without reading or exposing error response bodies", async () => {
  for (const status of [401, 403, 500, 503]) {
    await assert.rejects(
      model.requestIdentity(
        "http://localhost:8000",
        "user-a",
        "test-token",
        new AbortController().signal,
        async () => ({
          ok: false,
          status,
          json: () => {
            throw Error("Must not read private server errors");
          },
        }),
      ),
      /session|role|verification/,
    );
  }
  await assert.rejects(
    model.requestIdentity(
      "http://localhost:8000",
      "user-a",
      "test-token",
      new AbortController().signal,
      async () => ({
        ok: true,
        status: 200,
        json: async () => identity("other"),
      }),
    ),
  );
});

test("Firebase presence alone does not grant a workspace", async (t) => {
  const task = deferred();
  const { instance, emit } = controller(t, () => task.promise);
  emit({ uid: "user-a" });
  assert.equal(instance.snapshot().status, "verifying");
  task.resolve(identity());
  await flush();
  assert.equal(instance.snapshot().status, "ready");
});

test("sign-out clears verified access before the SDK resolves and rejects late results", async (t) => {
  const task = deferred(),
    logout = deferred();
  const { instance, emit } = controller(
    t,
    () => task.promise,
    () => logout.promise,
  );
  emit({ uid: "user-a" });
  await flush();
  const signingOut = instance.signOut();
  assert.equal(instance.snapshot().status, "signing-out");
  task.resolve(identity());
  await flush();
  assert.notEqual(instance.snapshot().status, "ready");
  logout.resolve();
  await signingOut;
  assert.equal(instance.snapshot().status, "guest");
});

test("token/user changes invalidate earlier permissions immediately", async (t) => {
  const tasks = [deferred(), deferred()];
  let calls = 0;
  const { instance, emit } = controller(t, () => tasks[calls++].promise);
  emit({ uid: "user-a" });
  await flush();
  emit({ uid: "user-b" });
  await flush();
  tasks[0].resolve(identity("user-a", "admin"));
  await flush();
  assert.equal(instance.snapshot().status, "verifying");
  tasks[1].resolve(identity("user-b"));
  await flush();
  assert.equal(instance.snapshot().identity.uid, "user-b");
  emit(null);
  assert.equal(instance.snapshot().status, "guest");
});

test("StrictMode restart ignores callbacks from an unsubscribed observer", async (t) => {
  const { instance, subscriptions, emit } = controller(t, async () =>
    identity(),
  );
  instance.stop();
  instance.start();
  subscriptions[0].next({ uid: "obsolete" });
  subscriptions[0].error();
  assert.equal(instance.snapshot().status, "loading");
  emit({ uid: "user-a" });
  await flush();
  assert.equal(instance.snapshot().status, "ready");
});

test("failed sign-out remains blocked and can be retried without duplicate calls", async (t) => {
  let attempts = 0;
  const { instance, emit } = controller(
    t,
    async () => identity(),
    async () => {
      attempts++;
      if (attempts === 1) throw Error("private SDK detail");
    },
  );
  emit({ uid: "user-a" });
  await flush();
  const first = instance.signOut();
  assert.equal(instance.signOut(), first);
  await first;
  assert.equal(attempts, 1);
  assert.equal(instance.snapshot().status, "error");
  assert(!instance.snapshot().message.includes("private"));
  await instance.signOut();
  assert.equal(instance.snapshot().status, "guest");
});

test("verification timeout blocks even when token retrieval ignores AbortSignal", async (t) => {
  let expire;
  const library = load(
    "session",
    {},
    {
      setTimeout: (fn) => {
        expire = fn;
        return 1;
      },
      clearTimeout: () => {},
    },
  );
  const { instance, emit } = controller(
    t,
    () => new Promise(() => {}),
    undefined,
    library,
  );
  emit({ uid: "user-a" });
  expire();
  await flush();
  assert.equal(instance.snapshot().status, "error");
  assert(instance.snapshot().message.includes("timed out"));
});

function client(stubs = {}, environment = {}) {
  const calls = [];
  const sdk = {
    browserSessionPersistence: "session",
    initializeAuth: (_app, options) => {
      calls.push(["initialize", options.persistence]);
      return {};
    },
    validatePassword: async () => ({ isValid: true }),
    createUserWithEmailAndPassword: async (_auth, email) => {
      calls.push(["create", email]);
      return { user: {} };
    },
    updateProfile: async (_user, profile) => {
      calls.push(["profile", profile.displayName]);
    },
    signInWithEmailAndPassword: async (_auth, email, password) => {
      calls.push(["sign-in", email, password]);
    },
    sendPasswordResetEmail: async () => {},
    verifyPasswordResetCode: async () => "not-displayed@example.test",
    confirmPasswordReset: async () => {
      calls.push(["reset"]);
    },
    ...stubs,
  };
  const auth = load(
    "firebaseClient",
    {
      "firebase/app": { getApps: () => [], initializeApp: () => ({}) },
      "firebase/auth": sdk,
      "./session": model,
    },
    {
      testEnvironment: {
        VITE_API_BASE_URL: "http://localhost:8000",
        VITE_FIREBASE_API_KEY: "test-only",
        VITE_FIREBASE_AUTH_DOMAIN: "test.example",
        VITE_FIREBASE_PROJECT_ID: "test-project",
        VITE_FIREBASE_STORAGE_BUCKET: "test-bucket",
        VITE_FIREBASE_MESSAGING_SENDER_ID: "test-sender",
        VITE_FIREBASE_APP_ID: "test-app",
        ...environment,
      },
    },
  );
  return { auth, calls };
}

test("SDK initializes only session auth and preserves passwords while trimming email", async () => {
  const { auth, calls } = client();
  await auth.signIn(" a@example.test ", " do not trim ");
  assert.deepEqual(calls[0], ["initialize", "session"]);
  assert.deepEqual(calls[1], ["sign-in", "a@example.test", " do not trim "]);
});

test("missing configuration fails before creating an account", async () => {
  const { auth, calls } = client({}, { VITE_FIREBASE_API_KEY: "PASTE_apiKey" });
  assert.equal(auth.firebaseConfigured, false);
  await assert.rejects(
    auth.register("a@example.test", "test-password", "Test"),
  );
  assert.equal(calls.length, 0);
});

test("password policy failure creates no account", async () => {
  const { auth, calls } = client({
    validatePassword: async () => ({ isValid: false }),
  });
  await assert.rejects(auth.register("a@example.test", "weak", "Test"));
  assert(!calls.some(([type]) => type === "create"));
});

test("display-name failure reports a created account instead of retrying creation", async () => {
  const { auth, calls } = client({
    updateProfile: async () => {
      throw Error("profile unavailable");
    },
  });
  const message = await auth.register(
    "a@example.test",
    "test-password",
    "Test",
  );
  assert(message.includes("was created"));
  assert(message.includes("Do not create another"));
  assert.equal(calls.filter(([type]) => type === "create").length, 1);
});

test("password-reset success is returned only after Firebase confirms the change", async () => {
  const { auth } = client({
    confirmPasswordReset: async () => {
      throw { code: "auth/expired-action-code" };
    },
  });
  await assert.rejects(auth.finishReset("not-a-real-code", "test-password"));
  const success = client();
  assert(
    (
      await success.auth.finishReset("not-a-real-code", "test-password")
    ).includes("was reset"),
  );
  assert.equal(success.calls.filter(([type]) => type === "reset").length, 1);
});

test("recovery errors never expose raw SDK messages, email, tokens or action codes", async () => {
  const { auth } = client();
  assert(
    !auth
      .authError({ message: "private-email@example.test token=private" })
      .includes("private"),
  );
  assert.equal(
    auth.authError({ code: "auth/user-not-found" }),
    auth.authError({ code: "auth/wrong-password" }),
  );
  assert(
    (await auth.requestReset("a@example.test")).startsWith(
      "If an account exists",
    ),
  );
});

test("unknown recovery account receives the same generic outcome", async () => {
  const missing = client({
    sendPasswordResetEmail: async () => {
      throw { code: "auth/user-not-found" };
    },
  });
  assert.equal(
    await missing.auth.requestReset("missing@example.test"),
    await client().auth.requestReset("a@example.test"),
  );
});
