/*
 * Cheatly product analytics — PostHog.
 *
 * Replaces Vercel Web Analytics. PostHog gives autocapture (pageviews +
 * clicks with no manual instrumentation), funnels, and session replay on a
 * single free tier.
 *
 * The project API key below is a PUBLIC client-side key (safe to ship in the
 * page). PostHog only initializes once a real key is set, so this file is safe
 * to deploy before the project exists — until then it is a no-op.
 *
 * Custom events (fired from tracking.js alongside the ad pixels):
 *   - initiate_checkout   on CTA clicks
 *   - purchase            on /download.html after a completed checkout
 * Pageviews and outbound-link/click autocapture are handled automatically.
 */
(function () {
  // PostHog project "Cheatly" (US region). Public client-side key — safe to ship.
  var POSTHOG_KEY = "phc_vRLRJ5CYcmF7sfZQfGTuieVEXkxv3LSS6wCPACBj2Cv7";
  // US cloud: https://us.i.posthog.com  ·  EU cloud: https://eu.i.posthog.com
  var POSTHOG_HOST = "https://us.i.posthog.com";

  window.cheatlyAnalyticsReady = false;
  if (!POSTHOG_KEY || POSTHOG_KEY === "PHC_PLACEHOLDER") return;

  !(function (t, e) {
    var o, n, p, r;
    e.__SV ||
      ((window.posthog = e),
      (e._i = []),
      (e.init = function (i, s, a) {
        function g(t, e) {
          var o = e.split(".");
          2 == o.length && ((t = t[o[0]]), (e = o[1]));
          t[e] = function () {
            t.push([e].concat(Array.prototype.slice.call(arguments, 0)));
          };
        }
        ((p = t.createElement("script")).type = "text/javascript"),
          (p.crossOrigin = "anonymous"),
          (p.async = !0),
          (p.src = s.api_host.replace(".i.posthog.com", "-assets.i.posthog.com") + "/static/array.js"),
          (r = t.getElementsByTagName("script")[0]).parentNode.insertBefore(p, r);
        var u = e;
        for (
          void 0 !== a ? (u = e[a] = []) : (a = "posthog"),
            u.people = u.people || [],
            u.toString = function (t) {
              var e = "posthog";
              return "posthog" !== a && (e += "." + a), t || (e += " (stub)"), e;
            },
            u.people.toString = function () {
              return u.toString(1) + ".people (stub)";
            },
            o =
              "init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug getPageViewId".split(
                " "
              ),
            n = 0;
          n < o.length;
          n++
        )
          g(u, o[n]);
        e._i.push([i, s, a]);
      }),
      (e.__SV = 1));
  })(document, window.posthog || []);

  window.posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    person_profiles: "identified_only",
    capture_pageview: true,
    capture_pageleave: true,
  });

  window.cheatlyAnalyticsReady = true;

  // Convenience wrapper so callers don't have to null-check window.posthog.
  window.cheatlyAnalytics = {
    capture: function (event, props) {
      if (window.posthog) window.posthog.capture(event, props || {});
    },
  };
})();
