const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

test("zero-production case includes facilities, drilling and abandonment", () => {
  const elements = {};
  function element(id) {
    return elements[id] ||= {value:"", textContent:"", innerHTML:"", listeners:{}, addEventListener(name, fn){this.listeners[name]=fn}};
  }
  const panel = element("economics");
  Object.defineProperty(panel, "innerHTML", {set(markup){
    for (const match of markup.matchAll(/id="([^"]+)"(?: value="([^"]+)")?/g)) {
      const el=element(match[1]); if (match[2] !== undefined) el.value=match[2];
    }
  }});
  const document={getElementById:element,querySelectorAll:()=>[],querySelector:()=>({value:"classic"})};
  const context={document,window:{addEventListener(){}},fetch:()=>new Promise(()=>{}),Math,Error,Number,Set,Array};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../courses/ai-decision-economics.js"),"utf8"),context);
  for(const [key,value] of Object.entries({wells:1,perYear:1,price:70,gasPrice:3,initial:0,gasInitial:0,decline:25,gasDecline:20,capex:8,facility:20,opex:15,gasOpex:.6,royalty:20,gasRoyalty:20,working:100,tax:21,discount:0,abandon:1,years:1,success:65})) element("econ-"+key).value=String(value);
  element("run-model").listeners.click();
  assert.match(element("model-results").innerHTML,/Base NPV: −\$29\.0m/);
  assert.match(element("model-results").innerHTML,/Gross oil: 0\.00 MMbbl · gas: 0\.00 MMcf/);
});
