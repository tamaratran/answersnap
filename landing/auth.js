(function () {
  var KEY = "cheatly_token";

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
})();
