(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const themeButton=$("theme-toggle");
  function setTheme(light){document.documentElement.classList.toggle("light",light);themeButton.setAttribute("aria-pressed",String(light));themeButton.setAttribute("aria-label",light?"Switch to dark mode":"Switch to light mode");themeButton.innerHTML=light?'☾ <span>Dark</span>':'☀ <span>Light</span>';try{localStorage.setItem("decision-theme",light?"light":"dark")}catch(_){}}
  try{setTheme(localStorage.getItem("decision-theme")==="light")}catch(_){setTheme(false)}
  themeButton.addEventListener("click",()=>setTheme(!document.documentElement.classList.contains("light")));
  const lessons = [
    ["Start with<br>the <em>area.</em>","Every investment begins with context. Select a region to explore its geography, assets and opportunities.","Choose either the Norwegian North Sea or the Permian Basin to open its satellite view."],
    ["Frame the<br><em>decision.</em>","A decision is more than a single well. Define the area, the alternatives and what you know before committing capital.","Explore the area and identify the choices: acquire information, drill, develop, defer or walk away. Which uncertainties could change your decision?"],
    ["Make uncertainty<br><em>visible.</em>","A range of outcomes is more useful than a single forecast. Use Monte Carlo to see how geological risk changes the distribution of value.","Set a chance of success and the economic outcomes. Run the simulation and compare the result with your expectations."],
    ["Put value<br>on the <em>choice.</em>","Combine probabilities and outcomes in a decision tree. Include time, capital, operating costs, fiscal terms and abandonment when building a full economic model.","Use the example below to compare expected monetary value with the risk of loss. What information would make the decision more robust?"],
    ["Think in<br><em>strategies.</em>","A portfolio and a sequence of decisions can behave very differently from one prospect. Compare choices across the whole area of interest.","Consider capital constraints, shared infrastructure and learning between wells. How would your strategy change after a success or a failure?"]
  ];
  const regions = {
    norway:{name:"North Sea, Norway",subtitle:"Offshore exploration · Norwegian continental shelf",lat:59.5,lng:2.5,zoom:7,bbox:[1,58,5,61],source:"<strong>Norwegian North Sea</strong>Loading Norwegian Offshore Directorate licences, wellbores, facilities and pipelines…"},
    texas:{name:"Permian Basin, Texas",subtitle:"Unconventional exploration · West Texas",lat:31.8,lng:-102.2,zoom:11,bbox:[-102.32,31.72,-102.08,31.90],source:"<strong>Permian Basin, Texas</strong>Loading regulator well, pipeline and land-survey data…"}
  };
  let currentLesson=0, map, layerGroup, globe;
  const info=$("map-info-content");
  function lesson(index){
    currentLesson=Math.max(0,Math.min(4,index)); const item=lessons[currentLesson];
    document.querySelectorAll(".lesson").forEach((el,i)=>el.classList.toggle("active",i===currentLesson));
    $("lesson-title").innerHTML=item[0]; $("lesson-description").textContent=item[1]; $("lesson-task").textContent=item[2];
    $("step-label").textContent="LESSON 0"+(currentLesson+1)+" / 05"; $("progress-bar").style.width=((currentLesson+1)*20)+"%";
    $("calculator").hidden=![2,3].includes(currentLesson);
    $("next-lesson").innerHTML=currentLesson===4?'Return to lesson 01 <span>↺</span>':'Continue to lesson 0'+(currentLesson+2)+' <span>→</span>';
  }
  document.querySelectorAll(".lesson").forEach(button=>button.addEventListener("click",()=>lesson(Number(button.dataset.lesson))));
  $("next-lesson").addEventListener("click",()=>lesson(currentLesson===4?0:currentLesson+1));
  $("toggle-sidebar").addEventListener("click",()=>{const closed=$("shell").classList.toggle("collapsed");$("toggle-sidebar").setAttribute("aria-expanded",String(!closed));setTimeout(()=>{if(map)map.invalidateSize();resizeGlobe()},100)});
  const notes={classic:["CLASSIC / MANUAL","Set the assumptions and calculate discounted field cash flows and risk."],ai:["AI / PRICE REGRESSION","Train a local benchmark-price forecast on observed history, then compare modelled development scenarios."],rl:["RL / Q-LEARNING","Train a local agent on observed historical price paths with simulated production and economic rewards."]};
  document.querySelectorAll("input[name=mode]").forEach(input=>input.addEventListener("change",()=>{const [title,body]=notes[input.value];$("mode-note").innerHTML="<strong>"+title+"</strong><p>"+body+"</p>"}));
  $("chance").addEventListener("input",()=>$("chance-out").value=$("chance").value+"%");
  $("simulate").addEventListener("click",()=>{
    const p=Number($("chance").value)/100,up=Number($("upside").value),down=Number($("downside").value);
    if(!Number.isFinite(up)||!Number.isFinite(down)||up<0||down<0){$("result").textContent="Enter non-negative values for both outcomes.";return}
    let sum=0,wins=0;for(let i=0;i<5000;i++){const win=Math.random()<p;wins+=win?1:0;sum+=win?up:-down}
    const emv=p*up-(1-p)*down;
    $("result").textContent="Expected value: $"+emv.toFixed(1)+"m · Simulated mean: $"+(sum/5000).toFixed(1)+"m · Loss frequency: "+(100*(1-wins/5000)).toFixed(1)+"%. Outcomes are illustrative, before further cash-flow modelling.";
  });
  function resizeGlobe(){if(globe)globe.resize()}
  if(window.THREE){
    const host=$("globe"), scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(38,1,.1,100);
    camera.position.z=4.3;
    const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));host.appendChild(renderer.domElement);
    const earth=new THREE.Group();scene.add(earth);
    const texture=new THREE.TextureLoader().load("https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg");
    earth.add(new THREE.Mesh(new THREE.SphereGeometry(1,64,48),new THREE.MeshPhongMaterial({map:texture,shininess:6})));
    scene.add(new THREE.AmbientLight(0xffffff,.8));const sun=new THREE.DirectionalLight(0xffffff,1.3);sun.position.set(-3,2,5);scene.add(sun);
    const locations=[{lat:59.5,lng:2.5,name:"NORTH SEA",region:"norway"},{lat:31.8,lng:-102.2,name:"TEXAS",region:"texas"}];
    function position(lat,lng){const phi=(90-lat)*Math.PI/180,theta=(lng+180)*Math.PI/180;return new THREE.Vector3(-Math.sin(phi)*Math.cos(theta),Math.cos(phi),Math.sin(phi)*Math.sin(theta)).multiplyScalar(1.015)}
    const markers=locations.map(loc=>{const mesh=new THREE.Mesh(new THREE.SphereGeometry(.018,12,8),new THREE.MeshBasicMaterial({color:0xc5ffda}));mesh.position.copy(position(loc.lat,loc.lng));earth.add(mesh);const label=document.createElement("button");label.className="globe-label";label.textContent="● "+loc.name;label.addEventListener("click",()=>openRegion(loc.region));host.appendChild(label);return {mesh,label}});
    earth.rotation.y=-.55;earth.rotation.x=.18;
    let dragging=false,lastX=0,lastY=0;
    renderer.domElement.addEventListener("pointerdown",e=>{dragging=true;lastX=e.clientX;lastY=e.clientY;renderer.domElement.setPointerCapture(e.pointerId)});
    renderer.domElement.addEventListener("pointermove",e=>{if(!dragging)return;earth.rotation.y+=(e.clientX-lastX)*.006;earth.rotation.x=Math.max(-1.3,Math.min(1.3,earth.rotation.x+(e.clientY-lastY)*.006));lastX=e.clientX;lastY=e.clientY});
    renderer.domElement.addEventListener("pointerup",()=>dragging=false);renderer.domElement.addEventListener("pointercancel",()=>dragging=false);
    renderer.domElement.addEventListener("wheel",e=>{e.preventDefault();camera.position.z=Math.max(2.3,Math.min(7,camera.position.z+e.deltaY*.002))},{passive:false});
    globe={resize(){const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix()}};
    function animate(){requestAnimationFrame(animate);if(host.hidden)return;if(!dragging)earth.rotation.y+=.001;scene.updateMatrixWorld();markers.forEach(({mesh,label})=>{const p=mesh.getWorldPosition(new THREE.Vector3()),visible=p.z>0;p.project(camera);label.style.display=visible?"block":"none";label.style.left=((p.x+1)*host.clientWidth/2)+"px";label.style.top=((1-p.y)*host.clientHeight/2)+"px"});renderer.render(scene,camera)}
    resizeGlobe();window.addEventListener("resize",resizeGlobe);animate();
  }else{$("globe").innerHTML='<p style="padding:80px;text-align:center">Globe unavailable. Choose a region below.</p>'}
  function safe(value){const div=document.createElement("div");div.textContent=String(value);return div.innerHTML}
  function polygonAcres(geometry){
    if(!geometry||!["Polygon","MultiPolygon"].includes(geometry.type))return null;
    const polygons=geometry.type==="Polygon"?[geometry.coordinates]:geometry.coordinates;
    const ringArea=ring=>{let sum=0;for(let i=0;i<ring.length-1;i++){const a=ring[i],b=ring[i+1];sum+=(b[0]-a[0])*Math.PI/180*(2+Math.sin(a[1]*Math.PI/180)+Math.sin(b[1]*Math.PI/180))}return Math.abs(sum*6378137*6378137/2)};
    return polygons.reduce((total,poly)=>total+Math.max(0,ringArea(poly[0])-poly.slice(1).reduce((n,r)=>n+ringArea(r),0)),0)/4046.8564224;
  }
  async function loadNorway(region){
    const base="https://factmaps.sodir.no/api/rest/services/Factmaps/FactMapsWGS84/MapServer/";
    const defs=[{id:616,name:"Production licence",color:"#bdf4ce",weight:1},{id:311,name:"Pipeline",color:"#ffcf78",weight:2},{id:201,name:"Wellbore",color:"#91d9f2",point:true},{id:304,name:"Facility",color:"#ffd17a",point:true}];
    let loaded=0;
    const results=await Promise.allSettled(defs.map(async d=>{
      const params=new URLSearchParams({where:"1=1",geometry:region.bbox.join(","),geometryType:"esriGeometryEnvelope",inSR:"4326",spatialRel:"esriSpatialRelIntersects",outFields:"*",outSR:"4326",f:"geojson",resultRecordCount:"1000"});
      const response=await fetch(base+d.id+"/query?"+params);if(!response.ok)throw Error("Layer unavailable");
      const data=await response.json();if(!data.features)throw Error("Invalid layer");return {d,data};
    }));
    if(!layerGroup||$("map").hidden||$("location-label").textContent!=="NORWEGIAN NORTH SEA")return;
    results.forEach(result=>{
      if(result.status!=="fulfilled")return;const {d,data}=result.value;loaded++;
      L.geoJSON(data,{style:feature=>feature.geometry.type==="Point"?{radius:d.id===304?5:2.5,color:d.color,weight:1,fillOpacity:.8}:{color:d.color,weight:d.weight||1,fillOpacity:.06},pointToLayer:(_,latlng)=>L.circleMarker(latlng,{radius:d.id===304?5:2.5,color:d.color,weight:1,fillOpacity:.8}),onEachFeature:(feature,layer)=>{
        const entries=Object.entries(feature.properties||{}).filter(([k,v])=>v!==null&&v!==""&&!/^(objectid|shape|globalid)/i.test(k)).slice(0,8);
        const details="<strong>"+safe(d.name)+"</strong>"+entries.map(([k,v])=>"<br>"+safe(k)+": "+safe(v)).join("");
        layer.bindTooltip(details,{sticky:true});layer.on("click",()=>{info.innerHTML=details+'<br><a href="https://www.sodir.no/en/facts/data-and-analyses/open-data/" target="_blank" rel="noopener">Source: Norwegian Offshore Directorate ↗</a>'});
      }}).addTo(layerGroup);
    });
    info.innerHTML="<strong>Norwegian North Sea</strong>"+loaded+' of 4 official layers loaded. Hover or select a feature for its attributes. Coverage is limited to the initial study area; some layers may be truncated at 1,000 records. <a href="https://www.sodir.no/en/facts/data-and-analyses/open-data/" target="_blank" rel="noopener">Source &amp; data limitations ↗</a>';
  }
  async function loadTexas(region){
    const base="https://gis.rrc.texas.gov/server/rest/services/rrc_public/RRC_Public_Viewer_Srvs/MapServer/";
    const defs=[{id:24,name:"Original land survey",color:"#c5f5ce",weight:1},{id:13,name:"Pipeline",color:"#ffca76",weight:2},{id:1,name:"Well location",color:"#91d9f2",point:true}];
    const results=await Promise.allSettled(defs.map(async d=>{
      const q=new URLSearchParams({where:"1=1",geometry:region.bbox.join(","),geometryType:"esriGeometryEnvelope",inSR:"4326",spatialRel:"esriSpatialRelIntersects",outFields:"*",outSR:"4326",f:"geojson",resultRecordCount:"1000"});
      const res=await fetch(base+d.id+"/query?"+q);if(!res.ok)throw Error("Layer unavailable");const data=await res.json();if(!data.features)throw Error("Invalid layer");return {d,data};
    }));
    if($("map").hidden||$("location-label").textContent!=="PERMIAN BASIN")return;
    let loaded=0;
    results.forEach(result=>{if(result.status!=="fulfilled")return;loaded++;const {d,data}=result.value;
      L.geoJSON(data,{style:feature=>feature.geometry.type==="Point"?{radius:3,color:d.color,weight:1,fillOpacity:.85}:{color:d.color,weight:d.weight||1,fillOpacity:.04},pointToLayer:(_,ll)=>L.circleMarker(ll,{radius:3,color:d.color,weight:1,fillOpacity:.85}),onEachFeature:(feature,layer)=>{
        const props=feature.properties||{}, keys=d.id===24?["ABSTRACT_NUMBER","LEVEL1_SURVEY_NAME","LEVEL2_BLOCK_NUMBER","LEVEL3_SURVEY_NUMBER"]:d.id===1?["API","GIS_WELL_NUMBER","GIS_SYMBOL_DESCRIPTION","GIS_LOCATION_SOURCE"]:["OPERATOR","SYSTEM_NAME","COMMODITY_DESCRIPTION","DIAMETER","STATUS"];
        const acres=d.id===24?polygonAcres(feature.geometry):null;
        const details="<strong>"+safe(d.name)+"</strong>"+keys.filter(k=>props[k]!=null&&props[k]!=="").map(k=>"<br>"+safe(k.replaceAll("_"," "))+": "+safe(props[k])).join("")+(acres!==null?"<br>Approximate mapped area: "+acres.toFixed(1)+" acres":"");
        layer.bindTooltip(details,{sticky:true});
        layer.on("click",()=>{info.innerHTML=details+(d.id===24?"<br>Original survey, not a verified lease boundary.":"")+(d.id===1?'<br><button id="show-pump" class="outline-button">View representative 3D pumping jack ↗</button>':"")+'<br><a href="https://gis.rrc.texas.gov/gisviewer/" target="_blank" rel="noopener">Texas Railroad Commission GIS ↗</a>';if(d.id===1)$("show-pump").addEventListener("click",()=>window.openPumpScene())});
      }}).addTo(layerGroup);
    });
    info.innerHTML="<strong>Permian study area</strong>"+loaded+' of 3 RRC layers loaded: original land surveys, well locations and pipelines. Surveys are not lease boundaries. Initial fixed area; up to 1,000 records per layer. Select a well to view an illustrative 3D pumping jack. <a href="https://gis.rrc.texas.gov/gisviewer/" target="_blank" rel="noopener">Official GIS ↗</a>';
    loadStateLeases(region);
  }
  async function loadStateLeases(region){
    const source="https://services1.arcgis.com/YWG34dhJxrbxQWdF/arcgis/rest/services/Oil_and_Gas_Leases_Active/FeatureServer/0/query";
    const q=new URLSearchParams({where:"1=1",geometry:region.bbox.join(","),geometryType:"esriGeometryEnvelope",inSR:"4326",spatialRel:"esriSpatialRelIntersects",outFields:"*",outSR:"4326",f:"geojson",resultRecordCount:"1000"});
    try{
      const response=await fetch(source+"?"+q);if(!response.ok)throw Error("Service unavailable");const data=await response.json();if(!Array.isArray(data.features))throw Error("Invalid response");
      if($("map").hidden||$("location-label").textContent!=="PERMIAN BASIN")return;
      L.geoJSON(data,{style:{color:"#ec80d9",weight:2,fillColor:"#ec80d9",fillOpacity:.15},onEachFeature:(feature,layer)=>{
        const p=feature.properties||{};const details="<strong>Texas GLO state lease "+safe(p.LEASE_NUMBER||"")+"</strong><br>Status: "+safe(p.LEASE_STATUS||"unknown")+"<br>Field: "+safe(p.FIELD_NAME||"not stated")+"<br>Current gross / net acres: "+safe(p.CURRENT_GROSS_ACRES??"unknown")+" / "+safe(p.CURRENT_NET_ACRES??"unknown")+"<br>Oil / gas royalty: "+safe(p.LEASE_ROYALTY_OIL??"unknown")+" / "+safe(p.LEASE_ROYALTY_GAS??"unknown");
        layer.bindTooltip(details,{sticky:true});layer.on("click",()=>{info.innerHTML=details+'<br><button id="use-lease" class="outline-button">Use lease terms in model ↗</button><br><a href="https://services1.arcgis.com/YWG34dhJxrbxQWdF/arcgis/rest/services/Oil_and_Gas_Leases_Active/FeatureServer" target="_blank" rel="noopener">Source: Texas General Land Office ↗</a>';document.getElementById("use-lease").addEventListener("click",()=>{window.dispatchEvent(new CustomEvent("decision-lease-selected",{detail:{lease:p.LEASE_NUMBER,oilRoyalty:p.LEASE_ROYALTY_OIL,gasRoyalty:p.LEASE_ROYALTY_GAS,netAcres:p.CURRENT_NET_ACRES}}));document.querySelector("#economics details").open=true})});
      }}).addTo(layerGroup);
      info.innerHTML+='<br><strong>Pink: '+data.features.length+' Texas GLO state lease geometries</strong> (up to 1,000; not private lease coverage). <a href="https://services1.arcgis.com/YWG34dhJxrbxQWdF/arcgis/rest/services/Oil_and_Gas_Leases_Active/FeatureServer" target="_blank" rel="noopener">GLO lease source ↗</a>';
    }catch(_){if(!$("map").hidden&&$("location-label").textContent==="PERMIAN BASIN")info.innerHTML+='<br>Texas GLO lease layer unavailable. <a href="https://gisweb.glo.texas.gov/glomap/index.html" target="_blank" rel="noopener">Open GLO viewer ↗</a>'}
  }
  function openRegion(key){
    const region=regions[key];$("globe").hidden=true;$("globe-hint").hidden=true;$("map").hidden=false;$("map-info").hidden=false;$("back-globe").hidden=false;
    $("location-label").textContent=key==="norway"?"NORWEGIAN NORTH SEA":"PERMIAN BASIN";$("workspace-title").textContent=region.name+".";$("workspace-subtitle").textContent=region.subtitle;$("map-badge").textContent="◉   SATELLITE / STUDY AREA";$("map-caption").textContent="PAN & ZOOM  ·  HOVER OR SELECT A FEATURE";info.innerHTML=region.source;
    if(!window.L){info.textContent="Map library unavailable. Check your connection.";return}
    if(!map){map=L.map("map",{zoomControl:true}).setView([region.lat,region.lng],region.zoom);L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{attribution:"Tiles © Esri, Maxar, Earthstar Geographics and the GIS User Community",maxZoom:19}).addTo(map);layerGroup=L.layerGroup().addTo(map)}else{layerGroup.clearLayers();map.setView([region.lat,region.lng],region.zoom)}
    setTimeout(()=>map.invalidateSize(),50);if(key==="norway")loadNorway(region);else loadTexas(region);
  }
  document.querySelectorAll("[data-region]").forEach(button=>button.addEventListener("click",()=>openRegion(button.dataset.region)));
  $("back-globe").addEventListener("click",()=>{$("map").hidden=true;$("map-info").hidden=true;$("back-globe").hidden=true;$("globe").hidden=false;$("globe-hint").hidden=false;$("location-label").textContent="GLOBAL VIEW";$("workspace-title").innerHTML="A world of decisions<span>.</span>";$("workspace-subtitle").textContent="Two regions. Different geology. One question: where would you invest?";$("map-badge").textContent="◉   GLOBAL EXPLORATION";$("map-caption").textContent="DRAG TO ROTATE  ·  SCROLL TO ZOOM";resizeGlobe()});
})();
