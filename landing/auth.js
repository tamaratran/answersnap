(function () {
  var KEY = "cheatly_token";
  var API_BASE = "https://cheatly-backend.fly.dev";
  var GOOGLE_CLIENT_ID = "448753116978-99n57kprcukk651g1k47rmi7l4tto9jp.apps.googleusercontent.com";

  function expOf(t) {
    try {
      var payload = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      var claims = JSON.parse(atob(payload));
      return typeof claims.exp === "number" ? claims.exp : null;
    } catch (_) {
      return null;
    }
  }

  window.CheatlyAuth = {
    get: function () {
      var t = localStorage.getItem(KEY);
      if (!t) return null;
      var exp = expOf(t);
      if (exp && exp * 1000 < Date.now()) {
        localStorage.removeItem(KEY);
        return null;
      }
      return t;
    },
    set: function (t) {
      if (t) localStorage.setItem(KEY, t);
    },
    clear: function () {
      localStorage.removeItem(KEY);
    },
  };

  window.api = async function (path, options) {
    options = options || {};
    var headers = { "Content-Type": "application/json" };
    var token = window.CheatlyAuth ? window.CheatlyAuth.get() : null;
    if (token) headers.Authorization = "Bearer " + token;

    var resp = await fetch(API_BASE + path, {
      method: options.method || "GET",
      credentials: "same-origin",
      headers: headers,
      body: options.body,
    });

    var data = {};
    try {
      data = await resp.json();
    } catch (_) {}

    if (!resp.ok) {
      throw new Error(data.detail || "Something went wrong. Please try again.");
    }
    return data;
  };

  window.initGoogleSignIn = function (containerId, errorSelector) {
    var container = document.getElementById(containerId);
    if (!container || !window.google || !google.accounts) return;
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: async function (response) {
        var errorEl = errorSelector ? document.querySelector(errorSelector) : null;
        if (errorEl) errorEl.textContent = "";
        try {
          var data = await window.api("/api/auth/google", {
            method: "POST",
            body: JSON.stringify({ credential: response.credential }),
          });
          if (data.token && window.CheatlyAuth) window.CheatlyAuth.set(data.token);
          window.location.href = "dashboard.html";
        } catch (err) {
          if (errorEl) errorEl.textContent = err.message;
        }
      },
    });
    google.accounts.id.renderButton(container, {
      theme: "outline",
      size: "large",
      width: container.offsetWidth || 320,
      text: "continue_with",
    });
  };

  window.bindAuthForm = function (formId, endpoint) {
    var form = document.getElementById(formId);
    if (!form) return;
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var errorEl = form.querySelector(".form-error");
      var button = form.querySelector("button[type=submit]");
      if (errorEl) errorEl.textContent = "";
      if (button) button.disabled = true;
      try {
        var data = await window.api(endpoint, {
          method: "POST",
          body: JSON.stringify({
            email: form.email.value,
            password: form.password.value,
          }),
        });
        if (data.token && window.CheatlyAuth) window.CheatlyAuth.set(data.token);
        window.location.href = "dashboard.html";
      } catch (err) {
        if (errorEl) errorEl.textContent = err.message;
        if (button) button.disabled = false;
      }
    });
  };
})();
