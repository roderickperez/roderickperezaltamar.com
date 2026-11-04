const assert = require("node:assert/strict");
const asset = require("./course-asset-with-manifest");
const hash = "a".repeat(64);
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "public";
function res() { return { headers:{}, setHeader(k,v){this.headers[k]=v}, status(v){this.code=v;return this}, send(v){this.body=v;return this}, end(){return this} }; }
const req = {method:"GET", query:{path:"fault-segmentation/app.js"}, headers:{cookie:"__Host-course_session=x.y"}};
async function check() {
 let calls=[];
 global.fetch=async url=>{calls.push(url);if(calls.length===1)return new Response(JSON.stringify({version:1,files:{"app.js":hash}}),{headers:{"content-type":"application/json"}});return new Response("new build",{headers:{"content-type":"text/javascript"}})};
 let r=res(); await asset(req,r);assert.equal(r.code,200);assert.match(calls[1],new RegExp("/objects/"+hash+"$"));assert.equal(r.body.toString(),"new build");
 calls=[];global.fetch=async url=>{calls.push(url);if(calls.length===1)return new Response(JSON.stringify({statusCode:"404"}),{status:400,headers:{"content-type":"application/json"}});return new Response("legacy")};
 r=res();await asset(req,r);assert.equal(r.code,200);assert.match(calls[1],/fault-segmentation\/app.js$/);
 calls=[];global.fetch=async url=>{calls.push(url);return new Response("denied",{status:403})};r=res();await asset(req,r);assert.equal(r.code,403);assert.equal(calls.length,1);
 calls=[];global.fetch=async url=>{calls.push(url);return new Response(JSON.stringify({version:1,files:{"app.js":"../escape"}}),{headers:{"content-type":"application/json"}})};r=res();await asset(req,r);assert.equal(r.code,404);assert.equal(calls.length,1);
 console.log("Manifest routing, legacy fallback, denied access and path checks passed.");
}
check().catch(e=>{console.error(e);process.exit(1)});
