(() => {
  "use strict";
  let pumpStarted=false;
  window.openPumpScene=()=>{
    const dialog=document.getElementById("pump-dialog");dialog.showModal();
    if(pumpStarted)return;pumpStarted=true;
    if(!window.THREE){document.getElementById("pump-scene").textContent="3D renderer unavailable.";return}
    const host=document.getElementById("pump-scene"),scene=new THREE.Scene();scene.background=new THREE.Color(0x1b302b);
    const camera=new THREE.PerspectiveCamera(38,host.clientWidth/host.clientHeight,.1,100);camera.position.set(8,5,9);camera.lookAt(0,1.5,0);
    const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(host.clientWidth,host.clientHeight);host.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xe8f8eb,0x58634b,2));const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(3,8,5);scene.add(light);
    const steel=new THREE.MeshStandardMaterial({color:0x304f4b,metalness:.55,roughness:.48}),red=new THREE.MeshStandardMaterial({color:0xc87350,metalness:.45,roughness:.5}),dark=new THREE.MeshStandardMaterial({color:0x26332f,metalness:.5,roughness:.6});
    function box(w,h,d,mat,x,y,z,parent=scene){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);mesh.position.set(x,y,z);parent.add(mesh);return mesh}
    function beam(a,b,width,mat,parent=scene){const delta=new THREE.Vector3().subVectors(b,a),mesh=new THREE.Mesh(new THREE.BoxGeometry(width,delta.length(),width),mat);mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());parent.add(mesh);return mesh}
    box(8,.12,6,new THREE.MeshStandardMaterial({color:0x9b9576}),0,-.08,0);box(4,.22,2,steel,0,.1,0);
    for(const z of [-.65,.65]){beam(new THREE.Vector3(-1.3,.2,z),new THREE.Vector3(0,2.65,0),.16,steel);beam(new THREE.Vector3(1.3,.2,z),new THREE.Vector3(0,2.65,0),.16,steel)}
    box(1.7,.7,1.2,dark,-1.4,.5,0);box(1.1,.5,.9,red,-1.4,1,0);
    const pivot=new THREE.Group();pivot.position.set(0,2.7,0);scene.add(pivot);box(4.7,.24,.35,steel,0,0,0,pivot);
    const head=new THREE.Mesh(new THREE.CylinderGeometry(.55,.55,.32,32,1,false,0,Math.PI),red);head.rotation.x=Math.PI/2;head.rotation.z=Math.PI/2;head.position.set(2.25,-.25,0);pivot.add(head);
    box(.09,2.4,.09,dark,2.5,-1.35,0,pivot);box(.55,.3,.55,dark,2.5,-2.5,0,pivot);
    const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.52,.52,.22,24),red);wheel.rotation.x=Math.PI/2;wheel.position.set(-1.3,1.1,.7);scene.add(wheel);
    function animate(t){requestAnimationFrame(animate);if(!dialog.open)return;pivot.rotation.z=.13*Math.sin(t*.0016);wheel.rotation.y=t*.0016;renderer.render(scene,camera)}requestAnimationFrame(animate);
  };
  document.getElementById("close-pump").addEventListener("click",()=>document.getElementById("pump-dialog").close());
})();
