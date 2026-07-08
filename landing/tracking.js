/*
 * Cheatly ad tracking — Meta Pixel + TikTok Pixel.
 *
 * Fill in the pixel IDs below. Each pixel only initializes when its ID is set
 * (i.e. not left as the empty placeholder), so this file is safe to ship before
 * the accounts exist.
 *
 * Events:
 *   - PageView         fired automatically on every page that includes this file
 *   - InitiateCheckout window.cheatlyTrack.initiateCheckout()  (on CTA clicks)
 *   - Purchase         window.cheatlyTrack.purchase()          (on /download.html)
 *
 * Server-side de-duplication: each event is sent with a stable event_id so the
 * backend Conversions API / Events API calls can be de-duped against these
 * browser events (same event_id => counted once).
 */
(function () {
  var META_PIXEL_ID = "1410585197572438";
  var TIKTOK_PIXEL_ID = "D96SKIBC77U9GV0AL040";

  var PURCHASE_VALUE = 25.0;  // subscription price used for ROAS reporting
  var CURRENCY = "USD";

  function newEventId(name) {
    return name + "." + Date.now() + "." + Math.random().toString(36).slice(2, 10);
  }

  // ── Meta Pixel ──────────────────────────────────────────────────────────────
  if (META_PIXEL_ID) {
    !(function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n;
      n.loaded = !0;
      n.version = "2.0";
      n.queue = [];
      t = b.createElement(e);
      t.async = !0;
      t.src = v;
      s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
    window.fbq("init", META_PIXEL_ID);
    window.fbq("track", "PageView");
  }

  // ── TikTok Pixel ────────────────────────────────────────────────────────────
  if (TIKTOK_PIXEL_ID) {
    !(function (w, d, t) {
      w.TiktokAnalyticsObject = t;
      var ttq = (w[t] = w[t] || []);
      ttq.methods = ["page", "track", "identify", "instances", "debug", "on", "off", "once", "ready", "alias", "group", "enableCookie", "disableCookie", "holdConsent", "revokeConsent", "grantConsent"];
      ttq.setAndDefer = function (t, e) {
        t[e] = function () {
          t.push([e].concat(Array.prototype.slice.call(arguments, 0)));
        };
      };
      for (var i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
      ttq.instance = function (t) {
        for (var e = ttq._i[t] || [], n = 0; n < ttq.methods.length; n++) ttq.setAndDefer(e, ttq.methods[n]);
        return e;
      };
      ttq.load = function (e, n) {
        var r = "https://analytics.tiktok.com/i18n/pixel/events.js",
          o = n && n.partner;
        ttq._i = ttq._i || {};
        ttq._i[e] = [];
        ttq._i[e]._u = r;
        ttq._t = ttq._t || {};
        ttq._t[e] = +new Date();
        ttq._o = ttq._o || {};
        ttq._o[e] = n || {};
        n = document.createElement("script");
        n.type = "text/javascript";
        n.async = !0;
        n.src = r + "?sdkid=" + e + "&lib=" + t;
        e = document.getElementsByTagName("script")[0];
        e.parentNode.insertBefore(n, e);
      };
      ttq.load(TIKTOK_PIXEL_ID);
      ttq.page();
    })(window, document, "ttq");
  }

  // ── Public event helpers ──────────────────────────────────────────────────────
  window.cheatlyTrack = {
    initiateCheckout: function () {
      var eventId = newEventId("InitiateCheckout");
      if (window.fbq) window.fbq("track", "InitiateCheckout", {}, { eventID: eventId });
      if (window.ttq) window.ttq.track("InitiateCheckout", { event_id: eventId });
      return eventId;
    },
    purchase: function (value, currency, eventId) {
      value = typeof value === "number" ? value : PURCHASE_VALUE;
      currency = currency || CURRENCY;
      eventId = eventId || newEventId("Purchase");
      if (window.fbq) window.fbq("track", "Purchase", { value: value, currency: currency }, { eventID: eventId });
      if (window.ttq) window.ttq.track("CompletePayment", { value: value, currency: currency }, { event_id: eventId });
      return eventId;
    },
  };
})();
