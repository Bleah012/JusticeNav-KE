const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), ts = require("typescript");
const cache = new Map();
function load(relative) {
  const file = path.resolve(__dirname,"../src",relative);
  if(cache.has(file)) return cache.get(file).exports;
  const mod={exports:{}};cache.set(file,mod);
  const code=ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{module:mod,exports:mod.exports,require:name=>{
    if(!name.startsWith("."))throw Error("Unexpected import");
    return load(path.relative(path.resolve(__dirname,"../src"),path.resolve(path.dirname(file),`${name}.ts`)));
  },URL,URLSearchParams,Date,Intl,AbortController,setTimeout,clearTimeout,fetch:()=>{throw Error("Live fetch forbidden");}},{filename:file});
  return mod.exports;
}
const {createAdminUsersApi,parseAccount,validateAccount}=load("admin/adminUsersApi.ts");
const {AdminUsersResource}=load("admin/AdminUsersResource.ts");
const {AdminApiError}=load("admin/adminApi.ts");
const UID="admin-one",ID="c".repeat(32);
const user={uid:UID,getIdToken:async()=>"test-only-token"};
const input={name:"Development Provider",email:"provider@example.test",password:"Test-only-password-2026!",role:"provider",serviceId:"small-claims-courts",confirmed:true};
const account=(changes={})=>({id:`jn-${ID}`,name:input.name,email:input.email,role:"provider",disabled:false,serviceId:input.serviceId,createdAt:"2026-11-20T10:00:00Z",lastSignInAt:null,...changes});
const page={users:[account()],nextCursor:null};
const signal=()=>new AbortController().signal;
const response=value=>({ok:true,json:async()=>value});
const api=(request,currentUser=()=>user)=>createAdminUsersApi({baseUrl:"http://localhost:8000",uid:UID,currentUser,request});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function fake(changes={}){return{list:async()=>page,lookup:async()=>null,create:async()=>account(),...changes};}

test("creation sends only approved fields in the body and validates role, service and active confirmation",async()=>{
  let sent;
  const result=await api(async(url,options)=>{sent={url,options};return response({uid:UID,account:account()});}).create(ID,{...input,uid:"victim",customClaims:{role:"admin"},disabled:false},signal());
  assert.equal(result.role,"provider");assert.equal(sent.url,`http://localhost:8000/api/v1/admin/users/${ID}`);
  assert.deepEqual(Object.keys(JSON.parse(sent.options.body)).sort(),Object.keys(input).sort());
  assert.equal(sent.options.method,"PUT");assert.equal(sent.options.credentials,"omit");assert.equal(sent.options.cache,"no-store");assert.equal(sent.options.redirect,"error");assert.equal(sent.options.referrerPolicy,"no-referrer");
  assert.equal(sent.options.headers.Authorization,"Bearer test-only-token");
  assert(!sent.url.includes(input.password)&&!sent.url.includes(input.email));
  for(const changes of [{role:"admin",serviceId:null},{disabled:true},{serviceId:"nlas-legal-aid"},{id:"foreign"},{email:"different@example.test"},{name:"Different"}]) await assert.rejects(api(async()=>response({uid:UID,account:account(changes)})).create(ID,input,signal()));
});
test("administrator creation never sends a provider membership",async()=>{
  let body;await api(async(_,options)=>{body=JSON.parse(options.body);return response({uid:UID,account:account({role:"admin",serviceId:null})});}).create(ID,{...input,role:"admin",serviceId:null},signal());
  assert.equal(body.serviceId,null);assert.equal(body.role,"admin");
});
test("validation requires new-account roles, provider service, password bounds and explicit confirmation",async()=>{
  assert.equal(validateAccount(input),"");
  let calls=0;const client=api(async()=>{calls++;throw Error("must not request");});
  for(const changes of [{name:" "},{email:"bad"},{password:"short"},{password:"x".repeat(129)},{password:"private\npassword2026"},{role:"seeker"},{serviceId:null},{role:"admin"},{confirmed:false}]){
    assert(validateAccount({...input,...changes}));await assert.rejects(client.create(ID,{...input,...changes},signal()));
  }
  await assert.rejects(client.create("bad",input,signal()));assert.equal(calls,0);
});
test("account projections discard hashes and claims and reject fabricated metadata",()=>{
  const clean=parseAccount({...account(),passwordHash:"NEVER",customClaims:{secret:"NEVER"}});
  assert(!JSON.stringify(clean).includes("NEVER"));
  for(const changes of [{id:""},{role:"super-admin"},{role:["admin"]},{disabled:"false"},{serviceId:"../bad"},{createdAt:"bad"},{lastSignInAt:"bad"}]) assert.throws(()=>parseAccount(account(changes)));
});
test("lists are bounded, duplicate-free and tied to the current administrator",async()=>{
  const value=await api(async()=>response({uid:UID,...page})).list(undefined,signal());assert.equal(value.users.length,1);
  for(const data of [{uid:"other",...page},{uid:UID,users:[account(),account()],nextCursor:null},{uid:UID,users:Array(51).fill(account()),nextCursor:null},{uid:UID,...page,nextCursor:123}])await assert.rejects(api(async()=>response(data)).list(undefined,signal()));
  const empty=await api(async()=>response({uid:UID,users:[],nextCursor:null})).list(undefined,signal());assert.equal(empty.users.length,0);
});
test("cursor values are encoded and invalid references never request",async()=>{
  let url,calls=0;const client=api(async(value)=>{calls++;url=value;return response({uid:UID,users:[],nextCursor:null});});
  await client.list("opaque+/= token",signal());assert.equal(new URL(url).searchParams.get("after"),"opaque+/= token");
  for(const value of ["", "x".repeat(4097),"bad\n"]){await assert.rejects(client.list(value,signal()));}
  await assert.rejects(client.lookup("bad",signal()));assert.equal(calls,1);
});
test("read-only lookup resolves missing and disabled partial accounts without claiming creation",async()=>{
  assert.equal(await api(async()=>({ok:false,status:404})).lookup(ID,signal()),null);
  const value=await api(async()=>response({uid:UID,account:account({disabled:true,role:"seeker",serviceId:null})})).lookup(ID,signal());assert(value.disabled);
  await assert.rejects(api(async()=>response({uid:UID,account:account({id:"other"})})).lookup(ID,signal()));
});
test("failure responses never parse private SDK errors",async()=>{
  for(const status of [401,403,409,422,503]){
    const client=api(async()=>({ok:false,status,json:()=>{throw Error("must not parse body");}}));
    await assert.rejects(client.create(ID,input,signal()),error=>error.status===status);
  }
});
test("missing, pre-aborted and switched accounts never send an old token",async()=>{
  let calls=0;const request=async()=>{calls++;throw Error("unexpected");};
  await assert.rejects(api(request,()=>null).create(ID,input,signal()));
  const abort=new AbortController();abort.abort();await assert.rejects(api(request).create(ID,input,abort.signal));
  const pending=deferred();let current={uid:UID,getIdToken:()=>pending.promise};
  const operation=api(request,()=>current).create(ID,input,signal());current=null;pending.resolve("token");await assert.rejects(operation);assert.equal(calls,0);
});
test("account changes after HTTP or JSON prevent account metadata publication",async()=>{
  for(const phase of ["http","json"]){let current=user;
    const client=api(async()=>{if(phase==="http")current=null;return{ok:true,json:async()=>{if(phase==="json")current=null;return{uid:UID,account:account()};}};},()=>current);
    await assert.rejects(client.create(ID,input,signal()),error=>error.status===401);
  }
});
test("creation waits for confirmation, blocks double submits and refreshes the listing",async()=>{
  const pending=deferred();let writes=0,reads=0;
  const resource=new AdminUsersResource(fake({list:async()=>{reads++;return page;},create:async()=>{writes++;return pending.promise;}}));const stop=resource.start();await tick();assert.equal(writes,0);
  const first=resource.create(ID,input);await tick();assert(resource.snapshot().busy);assert.equal(resource.snapshot().created,null);
  assert.equal(await resource.create(ID,input),false);pending.resolve(account());assert.equal(await first,true);assert.equal(writes,1);assert.equal(reads,2);assert.equal(resource.snapshot().created.id,`jn-${ID}`);stop();
});
test("unknown creation blocks another write until an exact account lookup and list refresh",async()=>{
  let writes=0,lookups=0;const resource=new AdminUsersResource(fake({create:async()=>{writes++;throw Error("lost response");},lookup:async id=>{lookups++;assert.equal(id,ID);return account({disabled:true});}}));const stop=resource.start();await tick();
  await resource.create(ID,input);assert(resource.snapshot().needsReload);assert.equal(resource.snapshot().created,null);assert.match(resource.snapshot().message,/could not be confirmed/);
  await resource.create(ID,input);assert.equal(writes,1);await resource.reload();assert.equal(lookups,1);assert(resource.snapshot().created.disabled);assert.equal(resource.snapshot().needsReload,false);stop();
});
test("confirmed creation with failed listing is reported separately and old rows are cleared",async()=>{
  let reads=0;const resource=new AdminUsersResource(fake({list:async()=>{if(reads++)throw new AdminApiError(503);return page;}}));const stop=resource.start();await tick();assert.equal(await resource.create(ID,input),true);
  assert.equal(resource.snapshot().status,"error");assert.equal(resource.snapshot().page,null);assert(resource.snapshot().created);assert.match(resource.snapshot().message,/was created, but/);stop();
});
test("validation permits correction while duplicate emails require reload",async()=>{
  for(const status of [422,409]){const resource=new AdminUsersResource(fake({create:async()=>{throw new AdminApiError(status);}}));const stop=resource.start();await tick();await resource.create(ID,input);assert.equal(resource.snapshot().needsReload,status!==422);stop();}
});
test("permission denial clears account results and never enables the form",async()=>{
  let denied=false;const resource=new AdminUsersResource(fake({list:async()=>{if(denied)throw new AdminApiError(403);return page;}}));const stop=resource.start();await tick();await resource.create(ID,input);denied=true;await resource.reload();
  assert.equal(resource.snapshot().status,"forbidden");assert.equal(resource.snapshot().page,null);assert.equal(resource.snapshot().created,null);assert.equal(await resource.create(ID,input),false);stop();
});
test("late responses after page departure are discarded and timeout requires inspection",async()=>{
  const pending=deferred();const resource=new AdminUsersResource(fake({create:()=>pending.promise}));const stop=resource.start();await tick();const operation=resource.create(ID,input);await tick();stop();pending.resolve(account());assert.equal(await operation,false);assert.equal(resource.snapshot().created,null);
  const timed=new AdminUsersResource(fake({create:()=>new Promise(()=>{})}),undefined,15);const end=timed.start();await tick();await timed.create(ID,input);assert(timed.snapshot().needsReload);assert.equal(timed.snapshot().busy,false);end();
});
