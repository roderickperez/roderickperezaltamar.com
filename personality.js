// Cycle the terminal-style code line.
(() => {
  const line = document.querySelector('[data-code-line]');
  if (line) {
    const phrases = ['from curiosity import insight', '# Apply ReLU to your life', 'signal = listen(earth)', 'model.fit(curiosity)', 'insight = explore(signal)'];
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
})();
