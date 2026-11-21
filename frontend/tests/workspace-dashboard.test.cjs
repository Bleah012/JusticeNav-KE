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
const {createAdminDashboardApi,parseAdminDashboard,parseProviderDashboard,demoTotal}=load("dashboard/workspaceDashboardApi.ts");
const {AdminResource}=load("admin/AdminResource.ts");
const {createDemoReferralApi}=load("referrals/demoReferralApi.ts");
const UID="admin-one", stamp="2026-11-21T09:00:00Z";
const counts={shared:4,assigned:22,underReview:2,completed:3,withdrawn:1};
const data={schemaVersion:1,uid:UID,role:"admin",readOnly:true,services:3,pathways:2,resources:4,catalogCheckedOn:"2026-11-03",pathwaysCheckedOn:"2026-11-03",accounts:{total:54,active:53,disabled:1,seeker:51,provider:1,admin:1,unsupported:1},demonstrations:counts,refreshedAt:stamp};
const user={uid:UID,getIdToken:async()=>"ephemeral-test-token"};
const signal=()=>new AbortController().signal;
const response=value=>({ok:true,json:async()=>value});
const api=(request,currentUser=()=>user)=>createAdminDashboardApi({baseUrl:"http://localhost:8000",uid:UID,currentUser,request});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test("admin dashboard accepts complete real totals and strips unrelated private metadata",()=>{
 const result=parseAdminDashboard({...data,privateDescription:"NEVER"},UID);
 assert.equal(result.accounts.total,54);assert.equal(demoTotal(result.demonstrations),32);assert(!JSON.stringify(result).includes("NEVER"));
 for(const changed of [{uid:"foreign"},{accounts:{...data.accounts,total:10}},{accounts:{...data.accounts,provider:-1}},{accounts:{...data.accounts,total:54.5}},{accounts:{...data.accounts,total:6000}},{demonstrations:{...counts,assigned:1001}},{refreshedAt:"bad"}])assert.throws(()=>parseAdminDashboard({...data,...changed},UID));
});
test("unavailable demonstration mode is not represented as a zero total",()=>{
 assert.equal(parseAdminDashboard({...data,demonstrations:null},UID).demonstrations,null);
 assert.throws(()=>parseAdminDashboard({...data,demonstrations:undefined},UID));
});
test("provider totals require matching identity, valid membership and no withdrawn or shared records",()=>{
 const value={uid:"provider-one",serviceId:"small-claims-courts",counts:{shared:0,assigned:21,underReview:2,completed:3,withdrawn:0},refreshedAt:stamp};
 assert.equal(parseProviderDashboard(value,"provider-one").counts.assigned,21);
 for(const changed of [{uid:"other"},{serviceId:"../bad"},{counts:{...value.counts,shared:1}},{counts:{...value.counts,withdrawn:1}},{counts:{...value.counts,completed:"3"}}])assert.throws(()=>parseProviderDashboard({...value,...changed},"provider-one"));
});
test("admin dashboard transport is read-only and checks account identity before and after every response",async()=>{
 let sent;await api(async(url,options)=>{sent={url,options};return response(data);})(signal());
 assert.equal(sent.url,"http://localhost:8000/api/v1/admin/dashboard");assert(!sent.options.body);assert.equal(sent.options.cache,"no-store");assert.equal(sent.options.credentials,"omit");assert.equal(sent.options.redirect,"error");assert.equal(sent.options.referrerPolicy,"no-referrer");
 for(const phase of ["token","http","json"]){let current=phase==="token"?{uid:UID,getIdToken:async()=>{current=null;return "old-token";}}:user,calls=0;
  await assert.rejects(api(async()=>{calls++;if(phase==="http")current=null;return {ok:true,json:async()=>{if(phase==="json")current=null;return data;}};},()=>current)(signal()));if(phase==="token")assert.equal(calls,0);
 }
});
test("failed dashboard requests never parse an error body or report zero records",async()=>{
 for(const status of [401,403,503])await assert.rejects(api(async()=>({ok:false,status,json:()=>{throw Error("must not parse");}}))(signal()),error=>error.status===status);
 let fails=false;const resource=new AdminResource(async()=>{if(fails)throw Error("unavailable");return parseAdminDashboard(data,UID);});const stop=resource.start();await tick();fails=true;await resource.reload();assert.equal(resource.snapshot().status,"error");assert(!resource.snapshot().value);stop();
});
test("provider summary uses the authenticated fixed endpoint rather than counting a list page",async()=>{
 let url;const provider={uid:"provider-one",getIdToken:async()=>"provider-token"};
 const result=await createDemoReferralApi({baseUrl:"http://localhost:8000",uid:provider.uid,currentUser:()=>provider,request:async value=>{url=value;return response({uid:provider.uid,serviceId:"small-claims-courts",counts:{shared:0,assigned:21,underReview:2,completed:3,withdrawn:0},refreshedAt:stamp});}}).summary(signal());
 assert.equal(url,"http://localhost:8000/api/v1/demo-referrals/provider/summary");assert.equal(result.counts.assigned+result.counts.underReview+result.counts.completed,26);
});
