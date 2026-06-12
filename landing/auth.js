/**
 * Cheatly — shared auth helpers (talks to the Cheatly API with cookie sessions)
 */
const API_BASE = "https://cheatly-backend.fly.dev";

async function api(path, options = {}) {
  const resp = await fetch(API_BASE + path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data.detail || "Something went wrong. Please try again.");
  }
  return data;
}

function bindAuthForm(formId, endpoint) {
  const form = document.getElementById(formId);
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = form.querySelector(".form-error");
    const button = form.querySelector("button[type=submit]");
    errorEl.textContent = "";
    button.disabled = true;
    try {
      await api(endpoint, {
        method: "POST",
        body: JSON.stringify({
          email: form.email.value,
          password: form.password.value,
        }),
      });
      window.location.href = "dashboard.html";
    } catch (err) {
      errorEl.textContent = err.message;
      button.disabled = false;
    }
  });
}
