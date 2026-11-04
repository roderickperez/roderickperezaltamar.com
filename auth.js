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
      const isOwner = !!owner.data;
      const { data: indexFile, error: indexError } = await client.storage.from("private-courses").download(course + "/index.html");
      if (version !== checkVersion) return;
      if (indexFile && !indexError) {
        panelText("Course ready", "Open the full-page course. Python runs in your browser using Pyodide.");
        const open = document.createElement("button");
        open.type = "button"; open.className = "auth-action"; open.textContent = "Open full-page course ↗";
        open.addEventListener("click", async () => {
          open.disabled = true;
          try {
            const { data: session } = await client.auth.getSession();
            if (!session.session) throw new Error("Please sign in again.");
            const response = await fetch("/api/course-session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: session.session.access_token }) });
            if (!response.ok) throw new Error("Could not start the course session.");
            window.location.assign("/private-course/" + encodeURIComponent(course) + "/index.html");
          } catch (_) {
            panelText("Could not open the course", "Please sign in again, then retry.");
          }
        });
        panel.append(open);
      } else {
        panelText("Course not uploaded yet", isOwner ? "Upload the prepared course folder below after private storage is configured." : "This course has not been published yet.");
        if (course === "python-renewable") {
          const note = document.createElement("p");
          note.textContent = "The existing renewable course is still public and is not protected by the course login.";
          const publicLink = document.createElement("a");
          publicLink.href = "https://roderickperez.github.io/EAGE_PythonRenewableEnergyCourse/sandbox/";
          publicLink.className = "auth-action"; publicLink.textContent = "Open existing public course ↗";
          panel.append(note, publicLink);
        }
      }
      if (isOwner) {
        const section = document.createElement("section");
        const help = document.createElement("p");
        help.textContent = "Owner: select the prepared sandbox folder to upload or update this course. Only the browser course files and generated student assets will be uploaded.";
        const input = document.createElement("input");
        input.type = "file"; input.multiple = true; input.setAttribute("webkitdirectory", ""); input.setAttribute("directory", ""); input.setAttribute("aria-label", "Choose prepared course folder");
        const button = document.createElement("button"); button.type = "button"; button.className = "auth-action"; button.textContent = "Upload selected course";
        const progress = document.createElement("p"); progress.setAttribute("role", "status");
        button.addEventListener("click", async () => {
          const rootFiles = new Set(["index.html", "app.js", "styles.css", "python-worker.js", "eagelogo.jpg", "flag-es.svg", "flag-uk.svg", "explorer-python.js", "explorers.css", "explorers.html", "explorers.js", "decision-lab.css", "decision-lab.html", "decision-lab.js", "guide.html"]);
          const chosen = [...input.files].map(file => ({file, path: file.webkitRelativePath.split("/").slice(1).join("/")}));
          const files = chosen.filter(({path}) => (rootFiles.has(path) || path.startsWith("generated/") || path.startsWith("vendor/")) && !/(^|\/)(instructor_private|private|\.git)(\/|$)|test_answer_key|final_project_solution|projectsolution|\.bak$/i.test(path));
          if (!files.some(x => x.path === "index.html") || !files.some(x => x.path === "generated/course.json")) { progress.textContent = "Choose the built sandbox folder containing index.html and generated/course.json."; return; }
          files.sort((a, b) => Number(a.path === "index.html") - Number(b.path === "index.html"));
          button.disabled = true; input.disabled = true;
          try {
            for (let i = 0; i < files.length; i++) {
              const {file, path} = files[i];
              progress.textContent = `Uploading ${i + 1} of ${files.length}…`;
              const {error} = await client.storage.from("private-courses").upload(course + "/" + path, file, {upsert: true, cacheControl: "0", contentType: file.type || "application/octet-stream"});
              if (error) throw error;
            }
            progress.textContent = "Upload complete. Refresh this page to open the course.";
          } catch (_) { progress.textContent = "Upload failed. Check that private storage is configured, then retry."; }
          finally { button.disabled = false; input.disabled = false; }
        });
        section.append(help, input, button, progress); panel.append(section);
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
    await fetch("/api/course-session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clear: true }) }).catch(() => {});
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
