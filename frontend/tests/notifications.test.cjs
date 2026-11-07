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
  createNotificationApi,
  parseNotificationPage,
  parseNotification,
  notificationLink,
  NotificationError,
} = load("notifications/notificationApi.ts");
const { NotificationResource } = load("notifications/NotificationResource.ts");
const UID = "owner",
  RECORD = "a".repeat(32),
  stamp = "2026-11-04T09:00:00.123456Z",
  later = "2026-11-04T09:01:00Z";
const id = (number) => String(number).padStart(20, "0") + "-" + "b".repeat(64);
const row = (number = 1, changes = {}) => ({
  id: id(number),
  kind: "assessment",
  recordId: RECORD,
  recordRevision: number,
  assessmentStatus: "draft",
  createdAt: stamp,
  isRead: false,
  readAt: null,
  ...changes,
});
const page = (rows = [row(2), row(1)], nextCursor = null) => ({
  uid: UID,
  notifications: rows,
  nextCursor,
});
const user = { uid: UID, getIdToken: async () => "ephemeral-test-token" };
const signal = () => new AbortController().signal;
const response = (value) => ({ ok: true, json: async () => value });
const api = (request, currentUser = () => user) =>
  createNotificationApi({
    baseUrl: "http://localhost:8000",
    uid: UID,
    currentUser,
    request,
  });
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("safe notification pages exclude unexpected private fields and validate owner/filter/cursor", () => {
  const value = page([
    row(1, { description: "PRIVATE", email: "private@example.test" }),
  ]);
  const result = parseNotificationPage(value, UID, { unread: true });
  assert(!JSON.stringify(result).includes("PRIVATE"));
  assert(!JSON.stringify(result).includes("private@example.test"));
  for (const bad of [
    { ...value, uid: "foreign" },
    page([row(1), row(1)]),
    page([row(1), row(2)]),
    page([row(1)], id(9)),
    page([row(1, { isRead: true, readAt: later })]),
  ])
    assert.throws(() => parseNotificationPage(bad, UID, { unread: true }));
  assert.throws(() =>
    parseNotificationPage(value, UID, { unread: false, after: id(1) }),
  );
});
test("notification parser rejects unsafe source references, fabricated read state and unsupported updates", () => {
  for (const change of [
    { id: "bad" },
    { recordId: "../foreign" },
    { recordRevision: true },
    { recordRevision: 0 },
    { kind: "provider-response" },
    { assessmentStatus: "completed" },
    { kind: "referral" },
    { isRead: 1 },
    { isRead: true },
    { readAt: later },
    { isRead: true, readAt: "2020-01-01T00:00:00Z" },
  ])
    assert.throws(() => parseNotification(row(1, change)));
});
test("source links use only validated IDs and fixed application routes", () => {
  for (const [assessmentStatus, step] of [
    ["draft", "describe"],
    ["needs-clarification", "clarify"],
    ["awaiting-pathways", "results"],
  ])
    assert.equal(
      notificationLink(row(1, { assessmentStatus })),
      `/app/assessments/${RECORD}/${step}`,
    );
  assert.equal(
    notificationLink(row(1, { kind: "referral", assessmentStatus: null })),
    `/app/referrals/${RECORD}`,
  );
  assert.equal(
    notificationLink(row(1, { kind: "checklist", assessmentStatus: null })),
    `/app/checklists/${RECORD}`,
  );
});

test("demonstration progress shares the inbox and opens the original referral", () => {
  const progress = [
    row(4, { kind: "referral-completed", assessmentStatus: null }),
    row(3, { kind: "referral-under-review", assessmentStatus: null }),
    row(2, {
      kind: "referral-assigned",
      assessmentStatus: null,
      isRead: true,
      readAt: later,
    }),
  ];
  const saved = row(1, { kind: "referral", assessmentStatus: null });
  const mixed = parseNotificationPage(page([...progress, saved]), UID, {
    unread: false,
  });
  assert.equal(mixed.notifications.length, 4);
  assert.equal(mixed.notifications[2].isRead, true);
  for (const item of mixed.notifications) {
    assert.equal(notificationLink(item), `/app/referrals/${RECORD}`);
  }
  assert.throws(() =>
    parseNotificationPage(page(progress), UID, { unread: true }),
  );
  for (const item of progress) {
    assert.throws(() => parseNotification({ ...item, recordRevision: 1 }));
    assert.throws(() =>
      parseNotification({ ...item, assessmentStatus: "draft" }),
    );
    assert.throws(() =>
      parseNotification({ ...item, recordId: "b".repeat(64) }),
    );
  }
});
test("read transport uses safe references/filters only and writes only selected notification IDs", async () => {
  const calls = [];
  const client = api(async (url, options) => {
    calls.push({ url, options });
    return response(
      options.method === "PUT"
        ? { uid: UID, notificationIds: [id(1)] }
        : page([]),
    );
  });
  await client.list({ unread: true, after: id(4) }, signal());
  await client.markRead([id(1)], signal());
  assert(calls[0].url.includes("unread=true"));
  assert(!calls[0].url.includes(UID));
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.body, undefined);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    notificationIds: [id(1)],
  });
  for (const call of calls) {
    assert.equal(call.options.credentials, "omit");
    assert.equal(call.options.cache, "no-store");
    assert.equal(call.options.redirect, "error");
    assert.equal(call.options.referrerPolicy, "no-referrer");
    assert.equal(
      call.options.headers.Authorization,
      "Bearer ephemeral-test-token",
    );
  }
});
test("invalid filters, empty batches and duplicates fail before fetching", async () => {
  let calls = 0;
  const client = api(async () => {
    calls++;
  });
  for (const ids of [[], ["bad"], [id(1), id(1)]])
    await assert.rejects(client.markRead(ids, signal()));
  await assert.rejects(
    client.list({ unread: true, after: "../bad" }, signal()),
  );
  assert.equal(calls, 0);
});
test("mark confirmation must match the owner and exactly the selected IDs", async () => {
  for (const result of [
    { uid: "foreign", notificationIds: [id(1)] },
    { uid: UID, notificationIds: [id(2)] },
    { uid: UID, notificationIds: [] },
    { uid: UID, notificationIds: [id(1), id(1)] },
  ])
    await assert.rejects(
      api(async () => response(result)).markRead([id(1)], signal()),
    );
});
test("departed sessions cannot fetch or publish old responses", async () => {
  for (const phase of ["token", "http", "json"]) {
    let current;
    current = {
      uid: UID,
      getIdToken: async () => {
        if (phase === "token") current = null;
        return "token";
      },
    };
    await assert.rejects(
      api(
        async () => {
          if (phase === "http") current = null;
          return {
            ok: true,
            json: async () => {
              if (phase === "json") current = null;
              return page();
            },
          };
        },
        () => current,
      ).list({ unread: false }, signal()),
    );
  }
});
test("missing or aborted identities never fetch and HTTP errors never expose bodies", async () => {
  let calls = 0;
  const request = async () => {
    calls++;
  };
  await assert.rejects(
    api(request, () => null).list({ unread: false }, signal()),
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(api(request).markRead([id(1)], abort.signal));
  assert.equal(calls, 0);
  for (const status of [401, 403, 404, 503])
    await assert.rejects(
      api(async () => ({
        ok: false,
        status,
        json: () => {
          throw Error("must not read");
        },
      })).list({ unread: false }, signal()),
      (error) => error.status === status,
    );
});
test("opening and filtering never mark a notification read", async () => {
  let reads = 0,
    writes = 0;
  const resource = new NotificationResource(
    async () => {
      reads++;
      return page();
    },
    async () => {
      writes++;
    },
  );
  const stop = resource.start();
  await tick();
  await resource.reload();
  assert.equal(reads, 2);
  assert.equal(writes, 0);
  assert.equal(resource.snapshot().value.notifications[0].isRead, false);
  stop();
});
test("read badges wait for confirmed write and refreshed list; duplicate clicks and invisible IDs are blocked", async () => {
  let writes = 0,
    read = false;
  const pending = deferred();
  const resource = new NotificationResource(
    async () => page([row(1, { isRead: read, readAt: read ? later : null })]),
    async () => {
      writes++;
      await pending.promise;
      read = true;
    },
  );
  const stop = resource.start();
  await tick();
  const marking = resource.markRead([id(1)]);
  await tick();
  assert.equal(resource.snapshot().value.notifications[0].isRead, false);
  await resource.markRead([id(1)]);
  assert.equal(writes, 1);
  pending.resolve();
  await marking;
  assert.equal(resource.snapshot().value.notifications[0].isRead, true);
  await resource.markRead([id(9)]);
  assert.equal(writes, 1);
  stop();
});
test("uncertain writes require a fresh load before another action", async () => {
  let writes = 0;
  const resource = new NotificationResource(
    async () => page(),
    async () => {
      writes++;
      throw new NotificationError(503);
    },
  );
  const stop = resource.start();
  await tick();
  await resource.markRead([id(1)]);
  assert.equal(resource.snapshot().status, "error");
  assert.equal(resource.snapshot().value, undefined);
  await resource.markRead([id(1)]);
  assert.equal(writes, 1);
  await resource.reload();
  assert.equal(resource.snapshot().status, "ready");
  stop();
});
test("successful mark followed by failed list refresh reports saved read state without stale badges", async () => {
  let reads = 0;
  const resource = new NotificationResource(
    async () => {
      if (++reads > 1) throw Error("offline");
      return page();
    },
    async () => {},
  );
  const stop = resource.start();
  await tick();
  await resource.markRead([id(1)]);
  assert.equal(resource.snapshot().status, "error");
  assert.match(resource.snapshot().message, /was saved/);
  assert.equal(resource.snapshot().value, undefined);
  stop();
});
test("unmount and newer filter lifecycles discard late results", async () => {
  const pending = deferred();
  let reads = 0;
  const resource = new NotificationResource(
    async () => (++reads === 1 ? pending.promise : page([])),
    async () => {},
  );
  const firstStop = resource.start();
  await tick();
  firstStop();
  const stop = resource.start();
  await tick();
  pending.resolve(page());
  await tick();
  assert.equal(resource.snapshot().value.notifications.length, 0);
  stop();
});
test("read-state timeout clears the list and ignores late success", async () => {
  const pending = deferred();
  const resource = new NotificationResource(
    async () => page(),
    () => pending.promise,
    10,
  );
  const stop = resource.start();
  await tick();
  await resource.markRead([id(1)]);
  assert.equal(resource.snapshot().status, "error");
  pending.resolve();
  await tick();
  assert.equal(resource.snapshot().status, "error");
  stop();
});
