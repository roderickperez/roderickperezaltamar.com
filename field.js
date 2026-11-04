// A compact, optional Three.js scene. The SVG remains visible if WebGL or the CDN is unavailable.
(async () => {
  const field = document.querySelector('[data-seismic-field]');
  if (!field) return;
  const view = field.querySelector('.field-view');
  const slider = field.querySelector('input[type="range"]');
  const output = field.querySelector('output');
  const pulseButton = field.querySelector('.field-button');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let frequency = Number(slider.value);
  let pulse = 0;
  let pointer = {x: 0, y: 0};
  let renderNow = () => {};
  slider.addEventListener('input', () => { frequency = Number(slider.value); output.textContent = frequency + ' Hz'; renderNow(); });
  pulseButton.addEventListener('click', () => { pulse = 1; renderNow(); });
  view.addEventListener('pointermove', event => {
    const rect = view.getBoundingClientRect();
    pointer = {x: (event.clientX - rect.left) / rect.width * 2 - 1, y: (event.clientY - rect.top) / rect.height * 2 - 1};
    if (motion.matches) renderNow();
  });
  view.addEventListener('pointerleave', () => { pointer = {x: 0, y: 0}; if (motion.matches) renderNow(); });
  try {
    const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js');
    const renderer = new THREE.WebGLRenderer({alpha:true, antialias:true, powerPreference:'low-power'});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
    renderer.setClearColor(0xffffff, 0);
    renderer.domElement.setAttribute('aria-hidden','true');
    view.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    camera.position.set(0, 4.2, 11);
    camera.lookAt(0,0,0);
    const group = new THREE.Group();
    group.rotation.z = -0.12;
    scene.add(group);
    const lines = [];
    const rows = 35, points = 115;
    for (let row = 0; row < rows; row++) {
      const positions = new Float32Array(points * 3);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const material = new THREE.LineBasicMaterial({color: row % 7 === 0 ? 0x43988a : 0x8ebbb0, transparent:true, opacity: row % 7 === 0 ? .72 : .44});
      const line = new THREE.Line(geometry, material);
      group.add(line);
      lines.push(geometry);
    }
    let width = 0, height = 0, active = true, frame = 0;
    function resize() {
      width = view.clientWidth; height = view.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.position.z = width < 390 ? 13 : 11;
      camera.updateProjectionMatrix();
    }
    function draw(time = 0) {
      const t = motion.matches ? 0 : time * .00042;
      const f = frequency / 30;
      const xOffset = pointer.x * .7;
      const zOffset = pointer.y * .5;
      lines.forEach((geometry, row) => {
        const array = geometry.attributes.position.array;
        const z = (row / (rows - 1) - .5) * 6;
        for (let i = 0; i < points; i++) {
          const x = (i / (points - 1) - .5) * 9;
          const d = Math.hypot(x - xOffset, (z - zOffset) * 1.35);
          const phase = (d - 1.15 - pulse * .9) * (3.2 + f * 2);
          const envelope = Math.exp(-d * d / 6.8);
          const ridge = Math.cos(phase - t * 2) * envelope * (.30 + pulse * .24);
          const strata = Math.sin(x * 1.1 + z * .95 + t) * .11 + Math.cos(x * .65 - z * 1.4) * .09;
          array[i * 3] = x; array[i * 3 + 1] = ridge + strata; array[i * 3 + 2] = z;
        }
        geometry.attributes.position.needsUpdate = true;
      });
      group.rotation.y = pointer.x * .10;
      renderer.render(scene,camera);
      if (!motion.matches && active) { pulse *= .985; frame = requestAnimationFrame(draw); }
    }
    renderNow = () => { if (motion.matches) { resize(); draw(); } };
    const observer = new IntersectionObserver(entries => {
      active = entries[0].isIntersecting;
      cancelAnimationFrame(frame);
      if (active) { resize(); draw(performance.now()); }
    });
    observer.observe(field);
    new ResizeObserver(() => { resize(); if (motion.matches) draw(); }).observe(view);
    motion.addEventListener('change', () => { cancelAnimationFrame(frame); if (active) draw(performance.now()); });
    field.classList.add('is-live');
    resize(); draw();
  } catch (error) {
    // The static illustration and controls keep the page usable without WebGL.
    pulseButton.hidden = true;
    slider.disabled = true;
    field.querySelector('.field-hint').textContent = 'Seismic field';
  }
})();

