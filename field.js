// A quiet seismic field behind the page. Click open space to send out a wave.
(async () => {
  const field = document.querySelector('[data-seismic-field]');
  if (!field) return;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
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
    const rows = 62, points = 190;
    const sizeX = 25, sizeZ = 17;
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

    function resize() {
      const width = field.clientWidth, height = field.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.position.z = width < 700 ? 17 : 13;
      camera.updateProjectionMatrix();
    }

    function draw(time = performance.now()) {
      const t = motion.matches ? 0 : time / 1000;
      for (let p = pulses.length - 1; p >= 0; p--) {
        if (!motion.matches && t - pulses[p].time > 5) pulses.splice(p, 1);
      }
      lines.forEach((geometry, row) => {
        const positions = geometry.attributes.position.array;
        const z = (row / (rows - 1) - .5) * sizeZ;
        for (let i = 0; i < points; i++) {
          const x = (i / (points - 1) - .5) * sizeX;
          let y = Math.sin(x * .65 + z * .62 + t * .22) * .10 + Math.cos(x * .33 - z * 1.05 + t * .12) * .08;
          for (const pulse of pulses) {
            const age = motion.matches ? .55 : Math.max(0, t - pulse.time);
            const distance = Math.hypot(x - pulse.x, z - pulse.z);
            const front = distance - age * 2.7;
            y += .55 * Math.exp(-front * front / .38) * Math.cos(front * 7) * Math.exp(-age * .38);
          }
          positions[i * 3] = x;
          positions[i * 3 + 1] = y;
          positions[i * 3 + 2] = z;
        }
        geometry.attributes.position.needsUpdate = true;
      });
      renderer.render(scene, camera);
      if (running && !motion.matches) frame = requestAnimationFrame(draw);
    }

    function sendPulse(clientX, clientY) {
      const point = new THREE.Vector2(clientX / window.innerWidth * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
      raycaster.setFromCamera(point, camera);
      const hit = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(plane, hit)) return;
      pulses.push({x:hit.x, z:hit.z, time:performance.now() / 1000});
      if (pulses.length > 5) pulses.shift();
      if (motion.matches) draw();
    }
    document.addEventListener('pointerdown', event => {
      if (event.target.closest('a, button, input, select, textarea, dialog, summary')) return;
      sendPulse(event.clientX, event.clientY);
    });
    document.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && (event.target === document.body || event.target === document.documentElement)) {
        sendPulse(window.innerWidth / 2, window.innerHeight / 2);
      }
    });
    new ResizeObserver(() => { resize(); if (motion.matches) draw(); }).observe(field);
    document.addEventListener('visibilitychange', () => {
      running = !document.hidden;
      cancelAnimationFrame(frame);
      if (running) draw();
    });
    motion.addEventListener('change', () => { cancelAnimationFrame(frame); if (running) draw(); });
    resize();
    draw();
    field.classList.add('is-live');
  } catch (error) {
    // A light static illustration remains available if 3D cannot load.
  }
})();

