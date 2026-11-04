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
      URL, Date, Intl,
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


const { createReferralApi, parseReferral, parseSelection, validateContact, ReferralError, referralTime } = load("referrals/referralApi.ts");
const { ReferralResource } = load("referrals/ReferralResource.ts");
const ID = "a".repeat(32), UID = "owner";
const source = { pathway: { id: published.pathways[0].id, title: published.pathways[0].title }, service: { id: published.pathways[0].serviceId, name: "Published service" }, sourceReview: published.pathways[0].sourceReview, selectionVersion: "d".repeat(64) };
const contact = { fullName: "Test Person", email: "person@example.test", phone: null, contactMethod: "email", description: "Non-sensitive request", acknowledged: true };
const stamp = "2026-11-04T09:00:00.123456Z";
const record = (changes = {}) => { const fields = { ...contact }; delete fields.acknowledged; return { ...fields, id: ID, uid: UID, selection: source, scope: "school-demonstration", revision: 1, status: "saved", deliveryStatus: "not-sent", acknowledgementVersion: "project-request-v1", savedAt: stamp, updatedAt: stamp, acknowledgedAt: stamp, ...changes }; };
const user = { uid: UID, getIdToken: async () => "ephemeral-test-token" };
const signal = () => new AbortController().signal;
const response = (value) => ({ ok: true, json: async () => value });
const api = (request, currentUser = () => user) => createReferralApi({ baseUrl: "http://localhost:8000", uid: UID, currentUser, request });
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no; }); return {promise,resolve,reject}; }

test("saves whitelisted private fields in a body and validates the confirmed saved record", async () => {
  let sent;
  const result = await api(async (url, options) => { sent={url, options}; return response({referral:record()}); }).save(ID,source,{...contact,uid:"injected",status:"completed"},signal());
  assert.equal(result.deliveryStatus,"not-sent");
  assert.equal(sent.url,`http://localhost:8000/api/v1/referrals/${ID}`);
  const body=JSON.parse(sent.options.body); assert(!("uid" in body) && !("status" in body)); assert.equal(body.expectedRevision,0);
  assert.equal(sent.options.credentials,"omit"); assert.equal(sent.options.cache,"no-store"); assert.equal(sent.options.redirect,"error"); assert.equal(sent.options.referrerPolicy,"no-referrer"); assert.equal(sent.options.headers.Authorization,"Bearer ephemeral-test-token");
  assert(!sent.url.includes(contact.email));
});
test("record parser rejects foreign, fabricated delivery/status and inconsistent dates", () => {
  assert.equal(parseReferral(record(),UID,ID).id,ID);
  for(const changes of [{uid:"foreign"},{id:"b".repeat(32)},{status:"completed"},{deliveryStatus:"sent"},{revision:2},{acknowledgementVersion:"other"},{updatedAt:"2030-01-01T00:00:00Z"},{savedAt:"nope"}]) assert.throws(()=>parseReferral(record(changes),UID,ID));
  assert.throws(()=>parseSelection({...source,pathway:{id:"../bad",title:"bad"}}));
  assert.throws(()=>parseSelection(source,"different-pathway"));
});
test("microsecond server timestamps display in Kenya time",()=>{assert.match(referralTime(stamp),/2026/);assert.equal(referralTime("bad"),"Date unavailable");});
test("form validation requires acknowledgement, valid contact and bounded description",()=>{
  assert.equal(validateContact(contact),"");
  for(const changes of [{acknowledged:false},{email:"bad"},{contactMethod:"phone"},{phone:"0712345678"},{fullName:" "},{description:"x".repeat(1501)},{description:"\u0000private"}]) assert(validateContact({...contact,...changes}));
});
test("invalid references and contact data fail before any HTTP call",async()=>{
  let calls=0;const client=api(async()=>{calls++;throw Error("must not request");});
  await assert.rejects(client.get("../other",signal()));await assert.rejects(client.save(ID,source,{...contact,acknowledged:false},signal()));await assert.rejects(client.list("bad",signal()));assert.equal(calls,0);
});
test("account switch during token lookup prevents sending old token",async()=>{
  const pending=deferred();let current={uid:UID,getIdToken:()=>pending.promise},calls=0;
  const operation=api(async()=>{calls++;},()=>current).get(ID,signal());current=null;pending.resolve("token");await assert.rejects(operation);assert.equal(calls,0);
});
test("account switch after fetch or JSON prevents private response publication",async()=>{
  for(const phase of ["fetch","json"]){let current=user;const client=api(async()=>{if(phase==="fetch")current=null;return {ok:true,json:async()=>{if(phase==="json")current=null;return {referral:record()};}};},()=>current);await assert.rejects(client.get(ID,signal()));}
});
test("non-success and mismatched confirmation never report save success",async()=>{
  for(const status of [401,403,404,409,422,503])await assert.rejects(api(async()=>({ok:false,status})).save(ID,source,contact,signal()),e=>e.status===status);
  await assert.rejects(api(async()=>response({referral:record({description:"different"})})).save(ID,source,contact,signal()));
});
test("list parser rejects duplicate rows, foreign statuses and bad cursors",async()=>{
  const row={id:ID,pathwayTitle:source.pathway.title,serviceName:source.service.name,savedAt:stamp,status:"saved",deliveryStatus:"not-sent"};
  const result=await api(async()=>response({referrals:[row],nextCursor:ID})).list(undefined,signal());assert.equal(result.nextCursor,ID);
  for(const page of [{referrals:[row,row],nextCursor:null},{referrals:[{...row,status:"completed"}],nextCursor:null},{referrals:[row],nextCursor:"b".repeat(32)}])await assert.rejects(api(async()=>response(page)).list(undefined,signal()));
});
test("only one save starts and unknown outcome requires reload of same record",async()=>{
  const pending=deferred();let gets=0,writes=0;const resource=new ReferralResource(async()=>{gets++;return {id:ID,record:gets>1?record():null,selection:source};});const stop=resource.start();await tick();
  const first=resource.mutate(()=>{writes++;return pending.promise;});await tick();assert.equal(await resource.mutate(()=>{writes++;}),undefined);pending.reject(Error("lost response"));await first;
  assert.equal(writes,1);assert(resource.snapshot().needsReload);await resource.mutate(()=>{writes++;});assert.equal(writes,1);
  await resource.reload();assert.equal(resource.snapshot().value.record.id,ID);stop();
});
test("late save response after unmount is discarded",async()=>{const pending=deferred();const resource=new ReferralResource(async()=>null);const stop=resource.start();await tick();const saving=resource.mutate(()=>pending.promise);await tick();stop();pending.resolve(record());assert.equal(await saving,undefined);assert.equal(resource.snapshot().status,"loading");});
test("failed load is an error, not empty referrals or confirmation",async()=>{const resource=new ReferralResource(async()=>{throw new ReferralError(503);});const stop=resource.start();await tick();assert.equal(resource.snapshot().status,"error");stop();});
test("timeout aborts and blocks another save pending reload",async()=>{const resource=new ReferralResource(async()=>null,15);const stop=resource.start();await tick();let aborted=false;await resource.mutate((value,signal)=>new Promise(()=>signal.addEventListener("abort",()=>{aborted=true;})));assert(aborted);assert(resource.snapshot().needsReload);stop();});
