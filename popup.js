/**
 * Cheatly — Popup Script
 *
 * Manages auth state, extension settings via chrome.storage.local,
 * and communicates with background service worker.
 */

const BACKEND_URL = "https://answersnap-backend.fly.dev";

// DOM refs
const authView = document.getElementById("auth-view");
const mainView = document.getElementById("main-view");
const logoutBtn = document.getElementById("logout-btn");
const authError = document.getElementById("auth-error");

// Auth tabs
const authTabs = document.querySelectorAll(".auth-tab");
const loginForm = document.getElementById("login-form");
const signupForm = document.getElementById("signup-form");

// Login form
const loginEmail = document.getElementById("login-email");
const loginPassword = document.getElementById("login-password");
const loginBtn = document.getElementById("login-btn");

// Signup form
const signupEmail = document.getElementById("signup-email");
const signupPassword = document.getElementById("signup-password");
const signupBtn = document.getElementById("signup-btn");

// Main view
const userEmailEl = document.getElementById("user-email");
const subscriptionBadge = document.getElementById("subscription-badge");
const subscribeCta = document.getElementById("subscribe-cta");
const settingsSection = document.getElementById("settings-section");
const enabledToggle = document.getElementById("enabled-toggle");
const modeBtns = document.querySelectorAll(".mode-btn");
const statusEl = document.getElementById("status");

let currentMode = "homework";

// ── Auth State ────────────────────────────────────────────────────────────

function showAuthView() {
  authView.style.display = "";
  mainView.style.display = "none";
  logoutBtn.style.display = "none";
  authError.textContent = "";
}

function showMainView(user) {
  authView.style.display = "none";
  mainView.style.display = "";
  logoutBtn.style.display = "";

  userEmailEl.textContent = user.email;

  const status = user.subscription_status || "none";
  if (status === "active") {
    subscriptionBadge.textContent = "Active";
    subscriptionBadge.className = "subscription-badge active";
    subscribeCta.style.display = "none";
    settingsSection.style.display = "";
  } else if (status === "trialing") {
    subscriptionBadge.textContent = "Trial";
    subscriptionBadge.className = "subscription-badge trialing";
    subscribeCta.style.display = "none";
    settingsSection.style.display = "";
  } else {
    subscriptionBadge.textContent = "No Subscription";
    subscriptionBadge.className = "subscription-badge inactive";
    subscribeCta.style.display = "";
    settingsSection.style.display = "none";
  }
}

// ── Init: check stored token ──────────────────────────────────────────────

chrome.storage.local.get(["authToken", "userEmail", "subscriptionStatus"], (data) => {
  if (data.authToken) {
    // Verify token is still valid
    fetchUserInfo(data.authToken);
  } else {
    showAuthView();
  }
});

function fetchUserInfo(token) {
  fetch(`${BACKEND_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
    .then((r) => {
      if (!r.ok) throw new Error("Token expired");
      return r.json();
    })
    .then((user) => {
      chrome.storage.local.set({
        authToken: token,
        userEmail: user.email,
        subscriptionStatus: user.subscription_status,
      });
      showMainView(user);
      loadSettings();
    })
    .catch(() => {
      chrome.storage.local.remove(["authToken", "userEmail", "subscriptionStatus"]);
      showAuthView();
    });
}

// ── Auth Actions ──────────────────────────────────────────────────────────

authTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    authTabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    authError.textContent = "";

    if (tab.dataset.tab === "login") {
      loginForm.style.display = "";
      signupForm.style.display = "none";
    } else {
      loginForm.style.display = "none";
      signupForm.style.display = "";
    }
  });
});

loginBtn.addEventListener("click", () => {
  const email = loginEmail.value.trim();
  const password = loginPassword.value;
  if (!email || !password) {
    authError.textContent = "Enter email and password";
    return;
  }
  authError.textContent = "";
  loginBtn.disabled = true;
  loginBtn.textContent = "Logging in...";

  fetch(`${BACKEND_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
    .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
    .then(({ ok, data }) => {
      if (!ok) throw new Error(data.detail || "Login failed");
      chrome.storage.local.set({
        authToken: data.token,
        userEmail: data.email,
        subscriptionStatus: data.subscription_status,
      });
      // Notify background to reload token
      chrome.runtime.sendMessage({ type: "AUTH_CHANGED" });
      showMainView(data);
      loadSettings();
    })
    .catch((err) => {
      authError.textContent = err.message;
    })
    .finally(() => {
      loginBtn.disabled = false;
      loginBtn.textContent = "Log In";
    });
});

signupBtn.addEventListener("click", () => {
  const email = signupEmail.value.trim();
  const password = signupPassword.value;
  if (!email || !password) {
    authError.textContent = "Enter email and password";
    return;
  }
  if (password.length < 6) {
    authError.textContent = "Password must be at least 6 characters";
    return;
  }
  authError.textContent = "";
  signupBtn.disabled = true;
  signupBtn.textContent = "Creating account...";

  fetch(`${BACKEND_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
    .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
    .then(({ ok, data }) => {
      if (!ok) throw new Error(data.detail || "Registration failed");
      chrome.storage.local.set({
        authToken: data.token,
        userEmail: data.email,
        subscriptionStatus: data.subscription_status,
      });
      chrome.runtime.sendMessage({ type: "AUTH_CHANGED" });
      showMainView(data);
      loadSettings();
    })
    .catch((err) => {
      authError.textContent = err.message;
    })
    .finally(() => {
      signupBtn.disabled = false;
      signupBtn.textContent = "Sign Up";
    });
});

logoutBtn.addEventListener("click", () => {
  chrome.storage.local.remove(["authToken", "userEmail", "subscriptionStatus"]);
  chrome.runtime.sendMessage({ type: "AUTH_CHANGED" });
  showAuthView();
});

// ── Settings (same as before) ─────────────────────────────────────────────

function loadSettings() {
  chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (settings) => {
    if (!settings) return;

    enabledToggle.checked = settings.enabled;
    currentMode = settings.displayMode || "homework";

    modeBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === currentMode);
    });

    updateStatus(settings);
  });
}

function saveSettings() {
  const settings = {
    enabled: enabledToggle.checked,
    displayMode: currentMode,
  };

  chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings }, () => {
    updateStatus(settings);
  });
}

function updateStatus(settings) {
  if (!settings.enabled) {
    statusEl.textContent = "Extension is disabled";
    statusEl.className = "status";
  } else {
    statusEl.textContent = "Ready — double-click any question";
    statusEl.className = "status success";
  }
}

enabledToggle.addEventListener("change", saveSettings);

modeBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    modeBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentMode = btn.dataset.mode;
    saveSettings();
  });
});
