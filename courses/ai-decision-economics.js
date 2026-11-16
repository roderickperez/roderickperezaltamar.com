(() => {
  "use strict";
  const $=id=>document.getElementById(id), panel=$("economics");
  const fields=[
    ["wells","Total wells across area",8,1,100,1],["perYear","Wells drilled per year",4,1,100,1],
    ["price","Oil price ($/bbl)",70,1,250,1],["gasPrice","Gas price ($/Mcf)",3.5,.01,50,.1],
    ["initial","Initial oil (bbl/day/well)",600,0,10000,10],["gasInitial","Initial gas (Mcf/day/well)",1200,0,50000,10],
    ["decline","Annual oil decline (%)",25,0,90,1],["gasDecline","Annual gas decline (%)",20,0,90,1],
    ["capex","Drill & complete ($m/well)",8,0,200,.5],["facility","Shared facilities ($m)",20,0,1000,1],
    ["opex","Oil operating cost ($/bbl)",15,0,150,1],["gasOpex","Gas operating cost ($/Mcf)",.6,0,20,.1],
    ["royalty","Oil royalty (%)",20,0,90,1],["gasRoyalty","Gas royalty (%)",20,0,90,1],
    ["working","Working interest (%)",100,1,100,1],["tax","Federal income tax proxy (%)",21,0,90,1],
    ["discount","Discount rate (%)",10,0,50,1],["abandon","Abandonment ($m/well)",1,0,100,.1],
    ["years","Project life (years)",15,1,40,1],["success","Commercial success probability (%)",65,1,99,1]
  ];
  panel.innerHTML='<details><summary>Area economics &amp; strategy <span>↘</span></summary><p>Illustrative Texas fiscal model, including when viewing Norway. Select a GLO state lease to apply its royalty terms, or edit the inputs. The model does not infer production or costs from a mapped well.</p><p id="lease-context">Lease terms: user assumptions.</p><div class="model-grid">'+fields.map(f=>'<label>'+f[1]+'<input type="number" id="econ-'+f[0]+'" value="'+f[2]+'" min="'+f[3]+'" max="'+f[4]+'" step="'+f[5]+'"></label>').join("")+'</div><button type="button" id="use-market" class="outline-button">Use latest observed benchmark prices</button><p id="data-status">Loading historical benchmark data…</p><button id="run-model" class="primary-button">Run area model ↗</button><div id="model-results" class="model-results" aria-live="polite">Choose inputs and run the model.</div><p>Annual cohorts, oil and gas sales, royalties, operating costs, Texas baseline production taxes (oil 4.6%, gas 7.5%), cleanup fees, capital, seven-year straight-line depreciation, simplified loss carryforward and abandonment. Income tax is a simplified proxy, not a tax return. No exemptions, federal tax adjustments, transportation basis, inflation or financing. Cash flows use illustrative inputs, not asset reserves. <a target="_blank" rel="noopener" href="https://comptroller.texas.gov/taxes/crude-oil/">Texas oil tax</a> · <a target="_blank" rel="noopener" href="https://comptroller.texas.gov/taxes/natural-gas/">Texas gas tax</a>.</p></details>';
  let history=null;
  fetch("/courses/data/eia-monthly-prices.json").then(r=>{if(!r.ok)throw Error();return r.json()}).then(d=>{if(!Array.isArray(d.rows)||d.rows.length<60)throw Error();history=d;$("data-status").innerHTML="EIA via FRED: "+d.rows.length+" monthly WTI and Henry Hub observations, "+d.rows[0].month+" to "+d.rows.at(-1).month+" (last month may be partial). <a href='https://fred.stlouisfed.org/series/DCOILWTICO' target='_blank' rel='noopener'>Oil</a> · <a href='https://fred.stlouisfed.org/series/DHHNGSP' target='_blank' rel='noopener'>Gas</a>.";}).catch(()=>{$("data-status").textContent="Price history unavailable; AI and RL require the included EIA/FRED snapshot."});
  $("use-market").addEventListener("click",()=>{if(!history){$("data-status").textContent="Price history unavailable.";return}const p=history.rows.at(-1);$("econ-price").value=p.oil.toFixed(2);$("econ-gasPrice").value=p.gas.toFixed(2);$("data-status").textContent="Benchmarks applied from "+p.month+" (monthly average; last month may be partial). Henry Hub $/MMBtu is used as an approximate $/Mcf input; no basis adjustment."});
  document.querySelectorAll('input[name="mode"]').forEach(input=>input.addEventListener("change",()=>{$("model-results").textContent="Mode changed. Run the area model to update results."}));
  window.addEventListener("decision-lease-selected",e=>{const p=e.detail;let applied=[];for(const [name,value] of [["royalty",p.oilRoyalty],["gasRoyalty",p.gasRoyalty]]){const n=Number(value);if(value!==null&&value!==""&&Number.isFinite(n)&&n>=0&&n<=.9){$("econ-"+name).value=(n*100).toFixed(2);applied.push(name==="royalty"?"oil":"gas")}}$("lease-context").textContent="GLO lease "+p.lease+" · net acres "+(p.netAcres??"unknown")+" · applied "+(applied.join(" and ")||"no valid")+" royalty terms. Acreage does not limit development wells: pooling and working interests require separate verification."});
  function inputs(){const a={};for(const [key,, ,min,max] of fields){const raw=$("econ-"+key).value,n=Number(raw);if(raw.trim()===""||!Number.isFinite(n)||n<min||n>max)throw Error("Check "+key+" is between "+min+" and "+max+".");a[key]=n}if(!Number.isInteger(a.wells)||!Number.isInteger(a.perYear)||!Number.isInteger(a.years))throw Error("Wells, wells per year and project life must be whole numbers.");if(Math.ceil(a.wells/a.perYear)>a.years)throw Error("Project life must cover the planned drilling schedule.");return a}
  function evaluate(a,wellCount=a.wells,oilPrice=a.price,initial=a.initial,gasPrice=a.gasPrice){
    const wi=a.working/100;let npv=-a.facility*wi,undiscounted=npv,volume=0,gasVolume=0,loss=0,rows=[],cohorts=[],capital=[];
    for(let y=1;y<=a.years;y++){
      const drilled=Math.min(a.perYear,Math.max(0,wellCount-(y-1)*a.perYear));if(drilled)cohorts.push({year:y,count:drilled});const drillCost=drilled*a.capex*wi;capital.push(drillCost);
      let oil=0,gas=0;for(const c of cohorts){oil+=c.count*initial*365*Math.pow(1-a.decline/100,y-c.year);gas+=c.count*a.gasInitial*365*Math.pow(1-a.gasDecline/100,y-c.year)}
      const oilGross=oil*oilPrice/1e6,gasGross=gas*gasPrice/1e6,royalty=(oilGross*a.royalty/100+gasGross*a.gasRoyalty/100)*wi;
      const severance=(oilGross*.046+gasGross*.075)*wi,fees=(oil*.00625+gas*.000667)*wi/1e6,opex=(oil*a.opex+gas*a.gasOpex)*wi/1e6;
      const depreciation=(y<=7?a.facility*wi/7:0)+capital.slice(Math.max(0,capital.length-7)).reduce((x,v)=>x+v/7,0);
      const abandonment=y===a.years?wellCount*a.abandon*wi:0,pretax=(oilGross+gasGross)*wi-royalty-severance-fees-opex-abandonment-depreciation;
      const offset=Math.min(loss,Math.max(0,pretax));loss=Math.max(0,loss-offset)+Math.max(0,-pretax);const tax=Math.max(0,pretax-offset)*a.tax/100;
      const cash=(oilGross+gasGross)*wi-royalty-severance-fees-opex-abandonment-tax-drillCost;
      volume+=oil;gasVolume+=gas;undiscounted+=cash;npv+=cash/Math.pow(1+a.discount/100,y);rows.push({year:y,oil,gas,cash});
    }
    return {npv,undiscounted,volume,gasVolume,rows};
  }
  const money=n=>(n<0?"−$":"$")+Math.abs(n).toFixed(1)+"m";
  function normal(){let u=0,v=0;while(!u)u=Math.random();while(!v)v=Math.random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)}
  function uncertainty(a){const values=[];for(let i=0;i<1000;i++){const price=Math.max(1,a.price*(1+.2*normal())),rate=Math.max(1,a.initial*Math.exp(.3*normal()-.045));values.push(Math.random()<a.success/100?evaluate(a,a.wells,price,rate).npv:-(a.capex+a.facility)*a.working/100)}values.sort((x,y)=>x-y);return {p10:values[100],p50:values[500],p90:values[900],mean:values.reduce((x,y)=>x+y,0)/values.length,loss:values.filter(v=>v<0).length/10}}
  // Fit y = intercept + slope*x to historical consecutive monthly benchmark prices.
  function trainAI(a){
    if(!history)throw Error("Historical benchmark data is unavailable; AI requires the EIA/FRED snapshot.");
    const rows=history.rows,n=rows.length,split=Math.floor((n-1)*.8),fit=key=>{const xs=rows.slice(0,split).map(r=>r[key]),ys=rows.slice(1,split+1).map(r=>r[key]),mx=xs.reduce((x,y)=>x+y,0)/xs.length,my=ys.reduce((x,y)=>x+y,0)/ys.length,den=xs.reduce((s,x)=>s+(x-mx)**2,0),b=den?xs.reduce((s,x,i)=>s+(x-mx)*(ys[i]-my),0)/den:0,intercept=my-b*mx;let error=0;for(let i=split;i<n-1;i++)error+=Math.abs(intercept+b*rows[i][key]-rows[i+1][key]);return {next:Math.max(.01,intercept+b*rows.at(-1)[key]),mae:error/(n-1-split)}};
    const oil=fit("oil"),gas=fit("gas");const options=[...new Set([Math.max(1,Math.round(a.wells/2)),a.wells,Math.min(100,Math.round(a.wells*1.5))])].filter(w=>Math.ceil(w/a.perYear)<=a.years).map(w=>({w,npv:evaluate(a,w,oil.next,a.initial,gas.next).npv})).sort((x,y)=>y.npv-x.npv);return {oil,gas,options,split};
  }
  function trainRL(a){
    if(!history)throw Error("Historical benchmark data is unavailable; RL requires the EIA/FRED snapshot.");
    const rows=history.rows,starts=rows.length-36;if(starts<20)throw Error("Insufficient history.");
    const q=Array.from({length:3},()=>Array.from({length:3},()=>[0,0,0]));const state=r=>r<.85?0:r>1.15?2:1;
    for(let episode=0;episode<12000;episode++){
      const start=Math.floor(Math.random()*starts),origin=rows[start];let s=1;
      for(let t=0;t<3;t++){
        const sample=rows[start+t*12],oilRatio=sample.oil/origin.oil,gasRatio=sample.gas/origin.gas,epsilon=Math.max(.05,.4*(1-episode/12000)),values=q[t][s],action=Math.random()<epsilon?Math.floor(Math.random()*3):values.indexOf(Math.max(...values));let reward=0;
        if(action===0)reward=Math.random()<a.success/100?evaluate(a,a.wells,a.price*oilRatio,a.initial,a.gasPrice*gasRatio).npv:-(a.capex+a.facility)*a.working/100;else if(action===1)reward=-a.facility*.03*a.working/100;
        const next=t<2?state(rows[start+(t+1)*12].oil/origin.oil):s;const future=action===1&&t<2?Math.max(...q[t+1][next])/(1+a.discount/100):0;q[t][s][action]+=.03*(reward+future-q[t][s][action]);if(action!==1)break;s=next;
      }
    }
    return {values:q[0][1],starts};
  }
  $("run-model").addEventListener("click",()=>{
    const out=$("model-results");try{const a=inputs(),mode=document.querySelector('input[name="mode"]:checked').value,base=evaluate(a),risk=uncertainty(a);
      let html="<strong>Base NPV: "+money(base.npv)+"</strong><br>Undiscounted cash flow: "+money(base.undiscounted)+"<br>Gross oil: "+(base.volume/1e6).toFixed(2)+" MMbbl · gas: "+(base.gasVolume/1e6).toFixed(2)+" MMcf<br>Simulated P10 / P50 / P90 NPV: "+money(risk.p10)+" / "+money(risk.p50)+" / "+money(risk.p90)+"<br>Mean: "+money(risk.mean)+" · loss frequency: "+risk.loss.toFixed(1)+"%. Monte Carlo uses illustrative distributions.";
      if(mode==="ai"){const m=trainAI(a),best=m.options[0];html+="<hr><strong>AI scenario: "+best.w+" wells · "+money(best.npv)+"</strong><br>One-month historical price forecasts: oil $"+m.oil.next.toFixed(2)+"/bbl, gas $"+m.gas.next.toFixed(2)+"/MMBtu. Chronological holdout MAE: $"+m.oil.mae.toFixed(2)+" oil, $"+m.gas.mae.toFixed(2)+" gas. Forecast prices are held constant over project life; training is benchmark price history, not well production. Scenario ranking is model-based."}
      if(mode==="rl"){const m=trainRL(a),q=m.values,best=q.indexOf(Math.max(...q));html+="<hr><strong>Q-learning action: "+["Develop now","Wait one year","Stop"][best]+"</strong><br>Estimated values: develop "+money(q[0])+", wait "+money(q[1])+", stop "+money(q[2])+".<br>12,000 simulated episodes sampled from "+m.starts+" overlapping historical price paths. Price history is observed; rewards, success probability and future production are assumptions. No independent policy validation."}
      out.innerHTML=html;
    }catch(e){out.textContent=e.message}
  });
})();
