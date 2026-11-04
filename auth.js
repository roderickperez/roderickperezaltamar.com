(() => {
  const dialog = document.querySelector("#auth-dialog");
  const message = document.querySelector("#auth-message");
  const google = document.querySelector("#google-login");
  const emailButton = document.querySelector("#email-login");
  const loginButton = document.querySelector("#login-button");
  let client;

  function render(session) {
    const user = session && session.user;
    document.querySelector("#signed-out").hidden = !!user;
    document.querySelector("#signed-in").hidden = !user;
    document.querySelector("#signed-email").textContent = user ? `Signed in as ${user.email || "your account"}.` : "";
    loginButton.textContent = user ? "Account ↗" : "Sign in ↗";
    const status = document.querySelector("#course-status");
    status.textContent = user ? "You're signed in. Course materials will appear here when they are ready." : "Sign in to access courses when they become available.";
    if (!user) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Sign in ↗";
      button.addEventListener("click", () => dialog.showModal());
      status.append(" ", button);
    }
  }

  loginButton.addEventListener("click", () => dialog.showModal());
  document.querySelector("#close-dialog").addEventListener("click", () => dialog.close());
  document.querySelector("#email-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!client) return;
    message.textContent = "Sending your sign-in link…";
    const { error } = await client.auth.signInWithOtp({ email: document.querySelector("#email").value.trim(), options: { shouldCreateUser: false, emailRedirectTo: window.location.origin + "/" } });
    message.textContent = error ? "Unable to send a link. Check your email or contact the site owner for an invitation." : "If your email has access, check your inbox for a sign-in link.";
  });
  google.addEventListener("click", async () => {
    if (!client) return;
    const { error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + "/" } });
    if (error) message.textContent = "Google sign-in is unavailable. Please try again later.";
  });
  document.querySelector("#sign-out").addEventListener("click", async () => {
    if (!client) return;
    const { error } = await client.auth.signOut();
    message.textContent = error ? "Could not sign out. Please try again." : "You are signed out.";
  });

  async function initialize() {
    try {
      const response = await fetch("/api/config", { cache: "no-store" });
      if (!response.ok) return;
      const config = await response.json();
      if (!config.url || !config.key || !window.supabase) return;
      client = window.supabase.createClient(config.url, config.key);
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      google.disabled = false;
      emailButton.disabled = false;
      message.textContent = "";
      render(data.session);
      client.auth.onAuthStateChange((_event, session) => render(session));
    } catch (_) {
      message.textContent = "Sign-in is temporarily unavailable. Please try again later.";
    }
  }
  initialize();
})();
