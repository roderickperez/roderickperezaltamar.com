// A quiet seismic field behind the page. Click open space to send out a wave.
(async () => {
  const field = document.querySelector('[data-seismic-field]');
  if (!field) return;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let motionOptIn = true;
  const motionAllowed = () => !motion.matches || motionOptIn;
  try {
    const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js');
    const renderer = new THREE.WebGLRenderer({alpha:true, antialias:true, powerPreference:'low-power'});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0xffffff, 0);
    renderer.domElement.setAttribute('aria-hidden', 'true');
    field.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 9, 13);
    camera.lookAt(0, 0, 0);
    const lines = [];
    const rows = 86, points = 190;
    const sizeX = 25, sizeZ = 25;
    for (let row = 0; row < rows; row++) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points * 3), 3));
      const material = new THREE.LineBasicMaterial({color:0x111b1b, transparent:true, opacity:row % 5 === 0 ? .25 : .14});
      scene.add(new THREE.Line(geometry, material));
      lines.push(geometry);
    }

    const raycaster = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const pulses = [];
    let frame = 0, running = true;
    let source = null, lastSourcePulse = 0, lastMovePulse = 0, lastAmbientPulse = -10, ambientIndex = 0;

    function resize() {
      const width = field.clientWidth, height = field.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.position.z = width < 700 ? 17 : 13;
      camera.updateProjectionMatrix();
    }

    function draw(time = performance.now()) {
      const t = !motionAllowed() ? 0 : time / 1000;
      if (!!motionAllowed() && t - lastAmbientPulse >= 2.4) {
        const origins = [{x:-3.1, z:-0.8}, {x:2.8, z:1.1}, {x:0.4, z:-2.0}];
        pulses.push({...origins[ambientIndex++ % origins.length], time:t, strength:.50});
        lastAmbientPulse = t;
        if (pulses.length > 10) pulses.shift();
      }
      if (source && !!motionAllowed() && t - lastSourcePulse >= 1.25) {
        pulses.push({x:source.x, z:source.z, time:t, strength:0.55});
        lastSourcePulse = t;
        if (pulses.length > 10) pulses.shift();
      }
      for (let p = pulses.length - 1; p >= 0; p--) {
        if (!!motionAllowed() && t - pulses[p].time > 5) pulses.splice(p, 1);
      }
      lines.forEach((geometry, row) => {
        const positions = geometry.attributes.position.array;
        const z = (row / (rows - 1) - .5) * sizeZ;
        for (let i = 0; i < points; i++) {
          const x = (i / (points - 1) - .5) * sizeX;
          let y = Math.sin(x * .65 + z * .62 + t * .9) * .18 + Math.cos(x * .33 - z * 1.05 + t * .65) * .15;
          for (const pulse of pulses) {
            const age = !motionAllowed() ? .55 : Math.max(0, t - pulse.time);
            const distance = Math.hypot(x - pulse.x, z - pulse.z);
            const front = distance - age * 2.7;
            y += pulse.strength * Math.exp(-front * front / .38) * Math.cos(front * 7) * Math.exp(-age * .38);
          }
          positions[i * 3] = x;
          positions[i * 3 + 1] = y;
          positions[i * 3 + 2] = z;
        }
        geometry.attributes.position.needsUpdate = true;
      });
      renderer.render(scene, camera);
      if (running && !!motionAllowed()) frame = requestAnimationFrame(draw);
    }

    function pointOnField(clientX, clientY) {
      const rect = field.getBoundingClientRect();
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
      const point = new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(point, camera);
      const hit = new THREE.Vector3();
      return raycaster.ray.intersectPlane(plane, hit) ? {x:hit.x, z:hit.z} : null;
    }
    function addPulse(point, strength) {
      if (!point) return;
      pulses.push({...point, time:performance.now() / 1000, strength});
      if (pulses.length > 10) pulses.shift();
      if (!motionAllowed()) draw();
    }
    document.addEventListener('pointermove', event => {
      if (event.pointerType !== 'mouse' || !motionAllowed()) return;
      const now = performance.now();
      if (now - lastMovePulse < 160) return;
      lastMovePulse = now;
      addPulse(pointOnField(event.clientX, event.clientY), .38);
    }, {passive:true});
    document.addEventListener('pointerdown', event => {
      if (event.target.closest('a, button, input, select, textarea, dialog, summary')) return;
      const point = pointOnField(event.clientX, event.clientY);
      if (!point) return;
      const resume = !motionAllowed();
      motionOptIn = true;
      source = point;
      lastSourcePulse = performance.now() / 1000;
      addPulse(point, .7);
      if (resume && running) { cancelAnimationFrame(frame); draw(); }
    });
    document.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && (event.target === document.body || event.target === document.documentElement)) {
        const point = pointOnField(window.innerWidth / 2, window.innerHeight / 2);
        const resume = !motionAllowed();
        motionOptIn = true;
        source = point;
        lastSourcePulse = performance.now() / 1000;
        addPulse(point, .7);
        if (resume && running) { cancelAnimationFrame(frame); draw(); }
      }
    });
    new ResizeObserver(() => { resize(); if (!motionAllowed()) draw(); }).observe(field);
    let inView = true;
    function syncVisibility() {
      running = !document.hidden && inView;
      cancelAnimationFrame(frame);
      if (running) draw();
    }
    new IntersectionObserver(entries => { inView = entries[0].isIntersecting; syncVisibility(); }).observe(field);
    document.addEventListener('visibilitychange', syncVisibility);
    motion.addEventListener('change', () => { cancelAnimationFrame(frame); if (running) draw(); });
    resize();
    draw();
    field.classList.add('is-live');
  } catch (error) {
    // Keep the background animated even when WebGL or the Three.js CDN is unavailable.
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.setAttribute('aria-hidden', 'true');
    field.appendChild(canvas);
    field.classList.add('is-live');
    let width = 0, height = 0, frame = 0, source = null, visible = !document.hidden;
    let pointer = null, lastMove = 0;
    function resizeFallback() {
      width = field.clientWidth; height = field.clientHeight;
      const ratio = Math.min(devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    function paint(time = performance.now()) {
      const t = !motionAllowed() ? 0 : time / 1000;
      ctx.clearRect(0, 0, width, height);
      ctx.lineWidth = 1;
      for (let row = 0; row < 52; row++) {
        const base = height * (.2 + row * .013);
        ctx.strokeStyle = row % 5 === 0 ? 'rgba(17,27,27,.22)' : 'rgba(17,27,27,.13)';
        ctx.beginPath();
        for (let i = 0; i <= 140; i++) {
          const x = width * i / 140;
          let y = base + Math.sin(x / 110 + row * .11 + t * .9) * 6 + Math.cos(x / 180 - row * .17 + t * .65) * 4;
          const origins = [{x:width * .35, y:height * .48}, {x:width * .67, y:height * .55}];
          if (source) origins.push(source);
          if (pointer && time - pointer.time < 1800) origins.push(pointer);
          for (let j = 0; j < origins.length; j++) {
            const o = origins[j];
            const distance = Math.hypot((x - o.x) / Math.max(width, 1), (base - o.y) / Math.max(height, 1));
            const phase = distance * 35 - t * 3 + j * 2;
            y += Math.cos(phase) * Math.exp(-distance * 6) * (j < 2 ? 12 : 18);
          }
          if (i === 0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
        }
        ctx.stroke();
      }
      if (visible && !!motionAllowed()) frame = requestAnimationFrame(paint);
    }
    document.addEventListener('pointermove', event => {
      if (event.pointerType !== 'mouse' || performance.now() - lastMove < 100) return;
      lastMove = performance.now();
      const rect = field.getBoundingClientRect();
      if (event.clientY < rect.top || event.clientY > rect.bottom) return;
      pointer = {x:event.clientX - rect.left, y:event.clientY - rect.top, time:lastMove};
      if (!motionAllowed()) paint();
    }, {passive:true});
    document.addEventListener('pointerdown', event => {
      if (event.target.closest('a, button, input, select, textarea, dialog, summary')) return;
      const rect = field.getBoundingClientRect();
      if (event.clientY < rect.top || event.clientY > rect.bottom) return;
      const resume = !motionAllowed();
      motionOptIn = true;
      source = {x:event.clientX - rect.left, y:event.clientY - rect.top};
      if (resume && visible) { cancelAnimationFrame(frame); paint(); }
    });
    new ResizeObserver(() => { resizeFallback(); if (!motionAllowed()) paint(); }).observe(field);
    let inView = true;
    function syncVisibility() {
      visible = !document.hidden && inView;
      cancelAnimationFrame(frame);
      if (visible) paint();
    }
    new IntersectionObserver(entries => { inView = entries[0].isIntersecting; syncVisibility(); }).observe(field);
    document.addEventListener('visibilitychange', syncVisibility);
    motion.addEventListener('change', () => { cancelAnimationFrame(frame); if (visible) paint(); });
    resizeFallback(); paint();
  }
})();

