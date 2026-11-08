// Keep the private-course cookie aligned with the user's Supabase session.
(() => {
  if (!location.pathname.startsWith('/private-course/eage-python-course/')) return;
  let clientPromise;
  let pending;
  let warning;
  function showWarning() {
    if (warning) return;
    warning = document.createElement('div');
    warning.className = 'session-warning';
    warning.setAttribute('role', 'status');
    warning.append('Your course session needs renewal. Saved drafts remain in this browser. ');
    const link = document.createElement('a');
    link.href = '/courses/eage-python-course-learn.html';
    link.textContent = 'Sign in and reopen the course';
    warning.append(link);
    document.body.prepend(warning);
  }
  function clearWarning() {
    warning?.remove();
    warning = null;
  }
  async function updateCookie(session) {
    if (!session?.access_token) return false;
    const response = await fetch('/api/course-session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: session.access_token }), cache: 'no-store'
    });
    return response.ok;
  }
  function getClient() {
    if (!clientPromise) clientPromise = (async () => {
      if (!window.supabase) throw new Error('Authentication is unavailable');
      const response = await fetch('/api/config', { cache: 'no-store' });
      if (!response.ok) throw new Error('Authentication is unavailable');
      const config = await response.json();
      if (!config.url || !config.key) throw new Error('Authentication is unavailable');
      const client = window.supabase.createClient(config.url, config.key);
      client.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') showWarning();
        else if (event === 'TOKEN_REFRESHED' && session) {
          setTimeout(() => updateCookie(session).then(ok => { if (ok) clearWarning(); else showWarning(); }).catch(showWarning), 0);
        }
      });
      return client;
    })().catch(error => { clientPromise = undefined; throw error; });
    return clientPromise;
  }
  window.refreshCourseSession = () => {
    if (pending) return pending;
    pending = (async () => {
      try {
        const client = await getClient();
        let { data, error } = await client.auth.getSession();
        if (error || !data.session) throw new Error('No active session');
        if (data.session.expires_at && data.session.expires_at * 1000 < Date.now() + 120000) {
          ({ data, error } = await client.auth.refreshSession());
          if (error || !data.session) throw new Error('Session expired');
        }
        if (!await updateCookie(data.session)) throw new Error('Session could not be renewed');
        clearWarning();
        return true;
      } catch (_) {
        // If the identity SDK is briefly unavailable, a still-valid cookie can
        // continue to authorize the course. Never treat a failed probe as access.
        try {
          const probe = await fetch('generated/course.json', { method: 'HEAD', cache: 'no-store' });
          if (probe.ok) { clearWarning(); return true; }
        } catch (_) { /* The course cannot be reached either. */ }
        showWarning();
        return false;
      }
    })().finally(() => { pending = null; });
    return pending;
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void window.refreshCourseSession();
  });
  setInterval(() => void window.refreshCourseSession(), 15 * 60 * 1000);
})();
