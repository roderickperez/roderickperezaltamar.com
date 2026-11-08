const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../course-session-refresh.js'), 'utf8');
function setup({session, refreshed, cookieOK=true, probeOK=false}) {
  const calls=[], warnings=[];let listener;
  const client={auth:{getSession:async()=>({data:{session},error:null}),refreshSession:async()=>{calls.push('refresh');return {data:{session:refreshed},error:null}},onAuthStateChange(fn){listener=fn}}};
  const document={visibilityState:'visible',addEventListener(){},body:{prepend(x){warnings.push(x)}},createElement(tag){return {tag,append(){},setAttribute(){},remove(){}}}};
  const window={supabase:{createClient(){return client}}};
  const fetch=async (url,opts)=>{calls.push(url);if(url==='/api/config')return {ok:true,json:async()=>({url:'https://example.test',key:'public'})};if(url==='generated/course.json')return {ok:probeOK};assert.equal(opts.method,'POST');return {ok:cookieOK}};
  const context={location:{pathname:'/private-course/eage-python-course/index.html'},document,window,fetch,setTimeout,clearTimeout,setInterval(){},Date,JSON};vm.runInNewContext(source,context);
  return {window,calls,warnings,getListener:()=>listener};
}
test('renews a nearly expired token before updating the cookie',async()=>{
 const t=setup({session:{access_token:'old',expires_at:1},refreshed:{access_token:'new',expires_at:Math.floor(Date.now()/1000)+3600}});
 assert.equal(await t.window.refreshCourseSession(),true);assert.deepEqual(t.calls,['/api/config','refresh','/api/course-session']);assert.equal(t.warnings.length,0);
});
test('missing session gives recovery without attempting a cookie write',async()=>{
 const t=setup({session:null});assert.equal(await t.window.refreshCourseSession(),false);assert.deepEqual(t.calls,['/api/config','generated/course.json']);assert.equal(t.warnings.length,1);
});
test('failed cookie renewal surfaces recovery',async()=>{
 const t=setup({session:{access_token:'valid',expires_at:Math.floor(Date.now()/1000)+3600},cookieOK:false});assert.equal(await t.window.refreshCourseSession(),false);assert.equal(t.warnings.length,1);
});

test('a valid existing cookie works while identity refresh is unavailable',async()=>{
 const t=setup({session:null,probeOK:true});assert.equal(await t.window.refreshCourseSession(),true);assert.equal(t.warnings.length,0);
});
