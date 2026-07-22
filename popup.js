/**
 * Cheatly — Popup Script
 *
 * Manages auth state and extension settings.
 */

const BACKEND_URL = "https://cheatly-backend.fly.dev";
const GOOGLE_CLIENT_ID = "448753116978-99n57kprcukk651g1k47rmi7l4tto9jp.apps.googleusercontent.com";

const authView = document.getElementById("auth-view");
const mainView = document.getElementById("main-view");
const toggleWrap = document.getElementById("toggle-wrap");
const enabledToggle = document.getElementById("enabled-toggle");
const modeBtns = document.querySelectorAll(".mode-btn");
const statusEl = document.getElementById("status");
const shortcutHint = document.getElementById("shortcut-hint");

const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");
const authTabs = document.querySelectorAll(".auth-tab");
const authError = document.getElementById("auth-error");

const userEmailEl = document.getElementById("user-email");
const subBadge = document.getElementById("sub-badge");
const subDetail = document.getElementById("sub-detail");
const subscribeCta = document.getElementById("subscribe-cta");
const subscribeLink = document.getElementById("subscribe-link");
const settingsSection = document.getElementById("settings-section");
const workingBanner = document.getElementById("working-banner");
const workingText = document.getElementById("working-text");
const restartBtn = document.getElementById("restart-btn");

let currentMode = "homework";
let currentSubInfo = null;

// ── Auth Tab Switching ────────────────────────────────────────────────────

authTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    authTabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const target = tab.dataset.tab;
    loginForm.classList.toggle("hidden", target !== "login");
    registerForm.classList.toggle("hidden", target !== "register");
    hideAuthError();
  });
});

// ── Auth Actions ──────────────────────────────────────────────────────────

document.getElementById("login-btn").addEventListener("click", async () => {
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  if (!email || !password) return showAuthError("Enter email and password");
  await doAuth("/auth/login", email, password, "login-btn");
});

document.getElementById("register-btn").addEventListener("click", async () => {
  const email = document.getElementById("register-email").value.trim();
  const password = document.getElementById("register-password").value;
  if (!email || !password) return showAuthError("Enter email and password");
  if (password.length < 6) return showAuthError("Password must be at least 6 characters");
  await doAuth("/auth/register", email, password, "register-btn");
});

document.getElementById("login-password").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("login-btn").click();
});

document.getElementById("register-password").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("register-btn").click();
});

async function doAuth(endpoint, email, password, btnId) {
  const btn = document.getElementById(btnId);
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Loading...";
  hideAuthError();

  try {
    const resp = await fetch(`${BACKEND_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      showAuthError(data.detail || "Auth failed");
      return;
    }

    await chrome.storage.local.set({ authToken: data.token, authEmail: data.email });
    chrome.runtime.sendMessage({ type: "AUTH_CHANGED" });
    await loadAuthState();
  } catch (_err) {
    showAuthError("Network error — try again");
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

document.getElementById("google-btn").addEventListener("click", async () => {
  const btn = document.getElementById("google-btn");
  btn.disabled = true;
  hideAuthError();

  try {
    const idToken = await getGoogleIdToken();
    const resp = await fetch(`${BACKEND_URL}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: idToken }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      showAuthError(data.detail || "Google sign-in failed");
      return;
    }

    await chrome.storage.local.set({ authToken: data.token, authEmail: data.email });
    chrome.runtime.sendMessage({ type: "AUTH_CHANGED" });
    await loadAuthState();
  } catch (err) {
    if (err && err.message === "canceled") return;
    showAuthError("Google sign-in failed — try again");
  } finally {
    btn.disabled = false;
  }
});

function getGoogleIdToken() {
  const redirectUri = chrome.identity.getRedirectURL();
  const nonce = crypto.randomUUID();
  const authUrl =
    "https://accounts.google.com/o/oauth2/v2/auth" +
    `?client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}` +
    "&response_type=id_token" +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    "&scope=openid%20email%20profile" +
    `&nonce=${nonce}` +
    "&prompt=select_account";

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (responseUrl) => {
      if (chrome.runtime.lastError || !responseUrl) {
        return reject(new Error("canceled"));
      }
      const fragment = responseUrl.split("#")[1] || "";
      const idToken = new URLSearchParams(fragment).get("id_token");
      if (!idToken) return reject(new Error("no id_token in response"));
      resolve(idToken);
    });
  });
}

document.getElementById("logout-btn").addEventListener("click", async () => {
  await chrome.storage.local.remove(["authToken", "authEmail"]);
  chrome.runtime.sendMessage({ type: "AUTH_CHANGED" });
  showAuthView();
});

// ── Subscription Check ────────────────────────────────────────────────────

async function checkSubscription(token) {
  try {
    const resp = await fetch(`${BACKEND_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.status === 401 || resp.status === 403) {
      return { invalidToken: true };
    }
    if (!resp.ok) return { unavailable: true };
    return { data: await resp.json() };
  } catch {
    // Network error / backend cold start — token may still be valid
    return { unavailable: true };
  }
}

// ── UI State ──────────────────────────────────────────────

function showAuthView() {
  authView.classList.remove("hidden");
  mainView.classList.add("hidden");
  toggleWrap.style.display = "none";
  shortcutHint.style.display = "none";
  statusEl.textContent = "";
}

function showMainView(email, subInfo) {
  authView.classList.add("hidden");
  mainView.classList.remove("hidden");
  toggleWrap.style.display = "";
  shortcutHint.style.display = "";

  userEmailEl.textContent = email;

  if (subInfo && subInfo._connectionError) {
    subBadge.textContent = "Connection Error";
    subBadge.className = "sub-badge error";
    subDetail.textContent = "Could not reach Cheatly. Your login is saved — try again.";
    subscribeCta.classList.add("hidden");
    settingsSection.classList.remove("hidden");
    return;
  }

  if (subInfo && subInfo.subscribed) {
    const label = subInfo.trial ? "Free Trial" : "Active";
    const cls = subInfo.trial ? "trial" : "active";
    subBadge.textContent = label;
    subBadge.className = `sub-badge ${cls}`;
    if (subInfo.rate_limited) {
      subDetail.textContent = "Session expired — toggle off and on to reset";
    } else if (subInfo.session_minutes_remaining >= 0 && subInfo.session_minutes_remaining < 60) {
      subDetail.textContent = `${subInfo.session_minutes_remaining} min remaining`;
    } else {
      subDetail.textContent = subInfo.plan || "";
    }
    subscribeCta.classList.add("hidden");
    settingsSection.classList.remove("hidden");
  } else {
    subBadge.textContent = "No Subscription";
    subBadge.className = "sub-badge inactive";
    subDetail.textContent = "";
    subscribeCta.classList.remove("hidden");
    subscribeLink.href = `${BACKEND_URL}/checkout?email=${encodeURIComponent(email)}`;
    settingsSection.classList.add("hidden");
  }
}

function showAuthError(msg) {
  authError.textContent = msg;
  authError.classList.remove("hidden");
}

function hideAuthError() {
  authError.classList.add("hidden");
  authError.textContent = "";
}

// ── Init ──────────────────────────────────────────────────────────────────

async function loadAuthState() {
  const { authToken, authEmail } = await chrome.storage.local.get(["authToken", "authEmail"]);

  if (!authToken) {
    showAuthView();
    return;
  }

  const result = await checkSubscription(authToken);
  if (result.invalidToken) {
    // Token expired or invalid
    await chrome.storage.local.remove(["authToken", "authEmail"]);
    showAuthView();
    return;
  }

  // On network/server errors keep the session and show a clear connection warning
  const subInfo = result.unavailable
    ? { _connectionError: true }
    : result.data;
  currentSubInfo = subInfo;
  showMainView(authEmail || subInfo?.email || "", subInfo);

  // Load settings
  chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (settings) => {
    if (!settings) return;
    enabledToggle.checked = settings.enabled;
    currentMode = settings.displayMode || "homework";
    modeBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === currentMode);
    });
    updateStatus(settings);
    updateWorkingBanner(settings, subInfo);
  });
}

loadAuthState();

// ── Settings ──────────────────────────────────────────────────────────────

function saveSettings() {
  const settings = {
    enabled: enabledToggle.checked,
    displayMode: currentMode,
  };
  chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings }, () => {
    updateStatus(settings);
    updateWorkingBanner(settings, currentSubInfo);
  });
}

function updateWorkingBanner(settings, subInfo) {
  if (!subInfo || subInfo._connectionError || !subInfo.subscribed) {
    workingBanner.classList.add("hidden");
    return;
  }

  workingBanner.classList.remove("hidden");

  const working = settings.enabled && !subInfo.rate_limited;
  if (working) {
    workingBanner.className = "working-banner ok";
    workingText.textContent = "Cheatly is ON and working";
    restartBtn.classList.add("hidden");
  } else {
    workingBanner.className = "working-banner bad";
    workingText.textContent = settings.enabled
      ? "Cheatly is not working — session expired"
      : "Cheatly is OFF";
    restartBtn.classList.remove("hidden");
  }
}

restartBtn.addEventListener("click", () => {
  restartBtn.disabled = true;
  restartBtn.textContent = "Restarting...";
  chrome.runtime.sendMessage({ type: "RESTART_EXTENSION" }, async () => {
    await loadAuthState();
    restartBtn.disabled = false;
    restartBtn.textContent = "Restart Cheatly";
  });
});

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
