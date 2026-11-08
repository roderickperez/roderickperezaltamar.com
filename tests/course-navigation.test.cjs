const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../auth.js'), 'utf8');
function setup(hasCourses = true) {
  const listeners = {}, actions = [];
  const element = id => ({id, hidden:false, textContent:'', addEventListener(type, fn){listeners[id+':'+type]=fn}, showModal(){}, close(){actions.push('close')}});
  const items = {};
  for (const id of ['auth-dialog','auth-message','google-login','email-login','login-button','close-dialog','email-form','google-login','set-password-form','sign-out','signed-in','signed-out','signed-email','auth-title']) items[id]=element(id);
  const courses = {scrollIntoView(){actions.push('scroll')}};
  const document = {querySelector(selector){return items[selector.slice(1)] || null}, getElementById(id){return id === 'courses' && hasCourses ? courses : null}};
  const window = {location:{hash:'',origin:'https://example.test',pathname:'/'}};
  const context = {document,window,history:{pushState(_a,_b,path){actions.push(path)}},requestAnimationFrame(fn){fn()},fetch:async()=>({ok:false}),setTimeout,URLSearchParams};
  vm.runInNewContext(source,context);
  return {listeners,actions};
}
test('account navigation closes the dialog and scrolls to courses', () => {
  const {listeners,actions}=setup(); let prevented=false;
  listeners['auth-dialog:click']({target:{closest:()=>({})},button:0,preventDefault(){prevented=true}});
  assert.equal(prevented,true); assert.deepEqual(actions,['close','/#courses','scroll']);
});
test('other pages and modified clicks retain native navigation', () => {
  for (const options of [{hasCourses:false,ctrlKey:false},{hasCourses:true,ctrlKey:true}]) {
    const {listeners,actions}=setup(options.hasCourses);let prevented=false;
    listeners['auth-dialog:click']({target:{closest:()=>({})},button:0,ctrlKey:options.ctrlKey,preventDefault(){prevented=true}});
    assert.equal(prevented,false);assert.deepEqual(actions,[]);
  }
});
