(() => {
  const dialog = document.querySelector("#auth-dialog");
  const message = document.querySelector("#auth-message");
  const google = document.querySelector("#google-login");
  const login = document.querySelector("#email-login");
  const loginButton = document.querySelector("#login-button");
  const panel = document.querySelector("#learning-content");
  const course = document.querySelector("[data-course]")?.dataset.course;
  let client, currentUser = null, checkVersion = 0;

  function panelText(title, text, offerLogin = false) {
    if (!panel) return;
    panel.replaceChildren();
    const h = document.createElement("h2"), p = document.createElement("p");
    h.textContent = title; p.textContent = text;
    panel.append(h, p);
    if (offerLogin) {
      const button = document.createElement("button");
      button.className = "auth-action"; button.type = "button"; button.textContent = "Sign in";
      button.addEventListener("click", () => dialog.showModal());
      panel.append(button);
    }
  }

  async function loadCourse(user) {
    const version = ++checkVersion;
    if (!panel) return;
    if (!client) return panelText("Sign-in is being set up", "Course access will be available once sign-in is configured.");
    if (!user) return panelText("Sign in to continue", "Access to this course is by invitation.", true);
    panelText("Checking access", "Please wait…");
    try {
      const [owner, grant] = await Promise.all([
        client.from("course_owners").select("user_id").eq("user_id", user.id).maybeSingle(),
        client.from("course_access").select("course_id").eq("user_id", user.id).eq("course_id", course).maybeSingle()
      ]);
      if (version !== checkVersion) return;
      if (owner.error || grant.error) throw new Error("Access check failed");
      if (!owner.data && !grant.data) return panelText("Access not yet granted", "Your account does not have access to this course. Contact the course owner for an invitation.");
      if (course === "python-renewable") {
        panelText("Python Renewable Course", "This existing course is currently hosted on a public website. The course itself can be opened without signing in; private hosting is not configured yet.");
        const link = document.createElement("a");
        link.href = "https://roderickperez.github.io/EAGE_PythonRenewableEnergyCourse/sandbox/";
        link.target = "_blank"; link.rel = "noopener noreferrer"; link.className = "auth-action";
        link.textContent = "Open course in a new tab ↗";
        const frame = document.createElement("iframe");
        frame.src = link.href;
        frame.title = "Python Renewable Energy interactive course";
        frame.loading = "lazy";
        frame.style.cssText = "display:block;width:100%;height:80vh;min-height:600px;border:1px solid #d4dcdf;margin-top:24px;background:white";
        panel.append(link, frame);
        return;
      }
      const { data, error } = await client.from("course_lessons").select("title, body, position").eq("course_id", course).order("position");
      if (version !== checkVersion) return;
      if (error) throw error;
      if (!data.length) return panelText("You're in", "There are no lessons published for this course yet.");
      panelText("Course lessons", "Select a lesson below to begin.");
      for (const lesson of data) {
        const article = document.createElement("article"), heading = document.createElement("h3"), text = document.createElement("p");
        article.className = "lesson"; heading.textContent = lesson.title; text.textContent = lesson.body;
        article.append(heading, text); panel.append(article);
      }
    } catch (_) {
      if (version === checkVersion) panelText("Course temporarily unavailable", "We couldn't verify access. Please try again later.");
    }
  }

  function render(session) {
    currentUser = session?.user || null;
    document.querySelector("#signed-out").hidden = !!currentUser;
    document.querySelector("#signed-in").hidden = !currentUser;
    document.querySelector("#signed-email").textContent = currentUser ? `Signed in as ${currentUser.email || "your account"}.` : "";
    loginButton.textContent = currentUser ? "Account ↗" : "Sign in ↗";
    document.querySelector("#auth-title").textContent = currentUser ? "Your account." : "Sign in.";
    const status = document.querySelector("#course-status");
    if (status) status.textContent = currentUser ? "Open a course to check your access." : "Sign in to access courses you have been invited to.";
    void loadCourse(currentUser);
  }
  loginButton.addEventListener("click", () => dialog.showModal());
  document.querySelector("#close-dialog").addEventListener("click", () => dialog.close());
  document.querySelector("#email-form").addEventListener("submit", async event => {
    event.preventDefault(); if (!client) return;
    message.textContent = "Signing in…";
    const { error } = await client.auth.signInWithPassword({ email: document.querySelector("#email").value.trim(), password: document.querySelector("#password").value });
    message.textContent = error ? "Could not sign in. Check your email and password, or request an invitation." : "Signed in.";
    if (!error) { document.querySelector("#password").value = ""; if (dialog.open) dialog.close(); }
  });
  google.addEventListener("click", async () => {
    if (!client) return;
    const { error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + window.location.pathname } });
    if (error) message.textContent = "Google sign-in is unavailable. Please try again later.";
  });
  document.querySelector("#set-password-form").addEventListener("submit", async event => {
    event.preventDefault(); if (!client || !currentUser) return;
    const { error } = await client.auth.updateUser({ password: document.querySelector("#new-password").value });
    message.textContent = error ? "Could not change your password. Choose a different new password and try again." : "Password updated.";
    if (!error) document.querySelector("#new-password").value = "";
  });
  document.querySelector("#sign-out").addEventListener("click", async () => {
    if (!client) return;
    const { error } = await client.auth.signOut();
    message.textContent = error ? "Could not sign out. Please try again." : "You are signed out.";
  });
  async function initialize() {
    try {
      const response = await fetch("/api/config", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const config = await response.json();
      if (!config.url || !config.key || !window.supabase) { panelText("Sign-in is being set up", "Course access will be available once sign-in is configured."); return; }
      client = window.supabase.createClient(config.url, config.key);
      client.auth.onAuthStateChange((_event, session) => { setTimeout(() => render(session), 0); });
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      google.disabled = false; login.disabled = false; message.textContent = "";
      render(data.session);
    } catch (_) {
      message.textContent = "Sign-in is temporarily unavailable. Please try again later.";
      panelText("Sign-in temporarily unavailable", "Please try again later.");
    }
  }
  initialize();
})();
