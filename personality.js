// A fleeting network follows the cursor over the seismic field.
(() => {
  const field = document.querySelector('[data-seismic-field]');
  const line = document.querySelector('[data-code-line]');
  if (line) {
    const phrases = ['from curiosity import insight', '# Apply ReLU to life', 'signal = listen(earth)', 'model.fit(curiosity)', 'insight = explore(signal)'];
    let phrase = 0, cursor = 0, deleting = false;
    line.textContent = '';
    function type() {
      const current = phrases[phrase];
      cursor += deleting ? -1 : 1;
      line.textContent = current.slice(0, Math.max(0, cursor));
      if (!deleting && cursor >= current.length) {
        deleting = true;
        setTimeout(type, 2600);
      } else if (deleting && cursor <= 0) {
        deleting = false;
        phrase = (phrase + 1) % phrases.length;
        setTimeout(type, 450);
      } else setTimeout(type, deleting ? 30 : 65);
    }
    type();
  }
  if (!field) return;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return;
  canvas.className = 'neural-overlay';
  canvas.setAttribute('aria-hidden','true');
  field.appendChild(canvas);
  let width=0, height=0, raf=0, last=0, points=[];
  function resize() {
    width=field.clientWidth; height=field.clientHeight;
    const ratio=Math.min(devicePixelRatio || 1, 1.5);
    canvas.width=Math.round(width*ratio); canvas.height=Math.round(height*ratio);
    context.setTransform(ratio,0,0,ratio,0,0);
  }
  function draw(now) {
    context.clearRect(0,0,width,height);
    points=points.filter(p=>now-p.time<1900);
    for(let i=0;i<points.length;i++) {
      const p=points[i], opacity=Math.max(0,1-(now-p.time)/1900);
      for(let j=i+1;j<points.length;j++) {
        const q=points[j], distance=Math.hypot(p.x-q.x,p.y-q.y);
        if(distance>115) continue;
        const alpha=Math.min(opacity,Math.max(0,1-(now-q.time)/1900)) * (1-distance/115);
        context.strokeStyle='rgba(40,103,96,'+(alpha*.32)+')';
        context.lineWidth=.75;
        context.beginPath(); context.moveTo(p.x,p.y); context.lineTo(q.x,q.y); context.stroke();
      }
      context.fillStyle='rgba(30,94,87,'+(opacity*.58)+')';
      context.beginPath(); context.arc(p.x,p.y,1.7,0,Math.PI*2); context.fill();
    }
    raf=points.length ? requestAnimationFrame(draw) : 0;
  }
  document.addEventListener('pointermove',event=>{
    if(event.pointerType!=='mouse') return;
    const now=performance.now();
    if(now-last<100) return;
    const rect=field.getBoundingClientRect();
    if(event.clientX<rect.left || event.clientX>rect.right || event.clientY<rect.top || event.clientY>rect.bottom) return;
    last=now;
    const x=event.clientX-rect.left,y=event.clientY-rect.top;
    points.push({x,y,time:now});
    const angle=now*.003;
    points.push({x:x+Math.cos(angle)*25,y:y+Math.sin(angle)*25,time:now});
    if(points.length>36) points.splice(0,points.length-36);
    if(!raf) raf=requestAnimationFrame(draw);
  },{passive:true});
  new ResizeObserver(resize).observe(field);
  resize();
})();

