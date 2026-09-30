import test from "node:test";
import assert from "node:assert/strict";
import { handleQlikStatus } from "../lib/security/qlik-status.js";
import { testQlikRest, getQlikApp } from "../lib/connectors/qlik.js";
const token="unit-test-only-token-not-a-real-secret-12345";
const env={SAHAIQ_ENABLE_QLIK_CHECK:"true",SAHAIQ_STATUS_TOKEN:token,QLIK_TENANT_URL:"https://demo.eu.qlikcloud.com",QLIK_API_KEY:"unit-test-only",QLIK_APP_ID:"demo-app"};
const request=(auth="Bearer "+token)=>new Request("https://example.invalid/api/qlik",{headers:{authorization:auth}});
const never=()=>{throw new Error("fetch must not be called");};
test("status disabled by default without network",async()=>{let calls=0;const r=await handleQlikStatus(request(),{},()=>calls++);assert.equal(r.status,503);assert.equal(calls,0)});
test("unauthenticated status cannot touch Qlik",async()=>{let calls=0;const r=await handleQlikStatus(request(""),env,()=>calls++);assert.equal(r.status,401);assert.equal(calls,0)});
test("wrong status token rejected",async()=>assert.equal((await handleQlikStatus(request("Bearer wrong"),env,never)).status,401));
test("weak configured token rejected",async()=>assert.equal((await handleQlikStatus(request("Bearer short"),{...env,SAHAIQ_STATUS_TOKEN:"short"},never)).status,401));
test("oversized authorization header rejected",async()=>assert.equal((await handleQlikStatus(request("Bearer "+"x".repeat(1000)),env,never)).status,401));
test("missing app configuration is not passed",async()=>{let calls=0;const r=await handleQlikStatus(request(),{...env,QLIK_APP_ID:""},()=>calls++); assert.equal(r.status,503);assert.equal(calls,0)});
test("HTTP auth failure is safely reported",async()=>{const r=await handleQlikStatus(request(),env,async()=>({ok:false,status:401})); assert.equal(r.status,502); assert.equal((await r.json()).checks.authentication,"failed");});
test("network exceptions cannot expose secrets",async()=>{const r=await handleQlikStatus(request(),env,async()=>{throw new Error("private-user-key SECRET")});assert.doesNotMatch(await r.text(),/SECRET|private-user/)});
test("metadata success explicitly does not verify business data",async()=>{const urls=[];const r=await handleQlikStatus(request(),env,async(url,opts)=>{urls.push(url);assert.equal(opts.method,"GET");assert.equal(opts.redirect,"error");assert.equal(opts.cache,"no-store");assert.ok(opts.signal);return{ok:true,status:200,json:async()=>({id:"demo",name:"Private Name",email:"private@example.invalid"})}});const body=await r.json();assert.equal(r.status,200);assert.equal(body.state,"metadata_only");assert.equal(body.checks.business_data,"not_verified");assert.equal(body.checks.read_only_permissions,"not_verified");assert.equal(urls.length,2);assert.doesNotMatch(JSON.stringify(body),/Private Name|private@example|unit-test-only/);assert.equal(r.headers.get("cache-control"),"no-store");});
test("app access failure is not connection success",async()=>{let n=0;const r=await handleQlikStatus(request(),env,async()=>++n===1?{ok:true,status:200,json:async()=>({id:"u"})}:{ok:false,status:403});assert.equal(r.status,502);assert.equal((await r.json()).checks.app_access,"failed");});
for(const url of ["http://demo.eu.qlikcloud.com","https://evil.example","https://demo.qlikcloud.com.evil.example","https://name:pass@demo.qlikcloud.com","https://demo.qlikcloud.com/path","https://demo.qlikcloud.com?token=test","https://demo.qlikcloud.com:444"]){
 test(`unsafe tenant rejected before network: ${url}`,async()=>{let calls=0;const r=await testQlikRest({tenantUrl:url,apiKey:"test"},()=>calls++);assert.equal(r.ok,false);assert.equal(calls,0)});
}
test("unexpected identity payload is not authenticated",async()=>assert.equal((await testQlikRest({tenantUrl:env.QLIK_TENANT_URL,apiKey:"test"},async()=>({ok:true,status:200,json:async()=>({})}))).ok,false));
test("unexpected app payload is rejected",async()=>assert.rejects(()=>getQlikApp({tenantUrl:env.QLIK_TENANT_URL,apiKey:"test",appId:"a"},async()=>({ok:true,json:async()=>({})}))));

test("official Qlik attributes response is normalized",async()=>{const app=await getQlikApp({tenantUrl:env.QLIK_TENANT_URL,apiKey:"test",appId:"a"},async()=>({ok:true,json:async()=>({attributes:{id:"a",name:"Demo"},privileges:["read"]})}));assert.equal(app.id,"a");assert.equal(app.name,"Demo")});
