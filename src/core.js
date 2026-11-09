/*
 * Pure helpers shared by the content script and the tests.
 * No DOM, no chrome.* calls, so `node --test` can load this file as is.
 */
(function (root) {
  "use strict";

  var MODES = ["off", "any", "finalist", "sponsor"];
  var LIST_PARAMS = ["events", "partners", "categories"];
  var EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu;

  function isShowcaseList(pathname) {
    return pathname === "/showcase" || pathname === "/showcase/";
  }

  function splitList(value) {
    var seen = [];
    String(value || "").split(",").forEach(function (part) {
      var item = part.trim();
      if (item && seen.indexOf(item) === -1) seen.push(item);
    });
    return seen;
  }

  // Reads the filters the showcase itself keeps in the URL. `page` is ignored on purpose.
  function readFilters(search) {
    var params = new URLSearchParams(search || "");
    var out = {};
    LIST_PARAMS.forEach(function (key) {
      var values = [];
      params.getAll(key).forEach(function (raw) {
        splitList(raw).forEach(function (item) {
          if (values.indexOf(item) === -1) values.push(item);
        });
      });
      if (values.length) out[key] = values;
    });
    var q = (params.get("q") || "").trim();
    if (q) out.q = q;
    return out;
  }

  function filterKey(filters) {
    var f = filters || {};
    return JSON.stringify([
      (f.events || []).slice().sort(),
      (f.partners || []).slice().sort(),
      (f.categories || []).slice().sort(),
      f.q || "",
    ]);
  }

  function apiFilters(filters) {
    var f = filters || {};
    var out = {};
    LIST_PARAMS.forEach(function (key) {
      if (f[key] && f[key].length) out[key] = f[key].slice();
    });
    if (f.q) out.q = f.q;
    return out;
  }

  function cleanLabel(value) {
    if (value == null) return "";
    return String(value).replace(EMOJI, "").replace(/\s+/g, " ").trim();
  }

  function normalizePrizes(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(function (item) {
      var inner = (item && item.prize) || {};
      var org = inner.sponsor && inner.sponsor.organization;
      return {
        place: cleanLabel(item && item.name),
        track: cleanLabel(inner.name),
        type: inner.type || null,
        pool: !!(item && item.poolPrize),
        org: org && org.uuid ? { uuid: String(org.uuid), name: cleanLabel(org.name) } : null,
      };
    });
  }

  function isFinalist(prize) {
    if (!prize) return false;
    if (prize.type === "finalist") return true;
    return /finalist/i.test(prize.place || "") || /finalist/i.test(prize.track || "");
  }

  function matchesMode(prizes, mode) {
    if (mode === "off") return true;
    var list = prizes || [];
    if (!list.length) return false;
    if (mode === "finalist") return list.some(isFinalist);
    if (mode === "sponsor") return list.some(function (p) { return !isFinalist(p); });
    return true;
  }

  function normalizeMode(value) {
    if (value === "bounty") return "sponsor";
    return MODES.indexOf(value) === -1 ? "off" : value;
  }

  function prizeLine(prize) {
    if (isFinalist(prize)) return "Finalist";
    var place = prize.place;
    var track = prize.track;
    if (!place) return track || "Prize";
    if (!track || track.toLowerCase() === place.toLowerCase()) return place;
    return place + " · " + track;
  }

  function rank(prize) {
    if (isFinalist(prize)) return 0;
    var m = /^(\d+)(st|nd|rd|th)\b/i.exec(prize.place || "");
    if (m) return Number(m[1]);
    return 50;
  }

  function sortPrizes(prizes) {
    return (prizes || [])
      .map(function (p, i) { return { p: p, i: i }; })
      .sort(function (a, b) { return rank(a.p) - rank(b.p) || a.i - b.i; })
      .map(function (x) { return x.p; });
  }

  // Unique sponsors in prize order, for the logo badges on a card.
  function prizeOrgs(prizes) {
    var seen = [];
    var out = [];
    (prizes || []).forEach(function (p) {
      if (!p.org || seen.indexOf(p.org.uuid) !== -1) return;
      seen.push(p.org.uuid);
      out.push({ uuid: p.org.uuid, name: p.org.name });
    });
    return out;
  }

  function orgLogoUrl(uuid) {
    return "https://cdn.ethglobal.com/organizations/" + encodeURIComponent(uuid) + "/square-logo/default.png";
  }

  function nounFor(mode, n) {
    if (mode === "finalist") return n === 1 ? "finalist" : "finalists";
    if (mode === "sponsor") return n === 1 ? "sponsor prize winner" : "sponsor prize winners";
    return n === 1 ? "winner" : "winners";
  }

  function count(n, one, many) {
    return Number(n || 0).toLocaleString("en-US") + " " + (n === 1 ? one : many);
  }

  // One line under the mode switch: how many we found and how far we looked.
  function statusText(s) {
    if (!s || s.mode === "off") return "Showing every project, as ETHGlobal lists them.";
    var scanned = s.scanned || 0;
    var found = s.count || 0;
    if (!scanned && s.loading) return "Checking projects for prizes…";
    if (!scanned && s.done) return "No projects match these filters";
    var head = count(found, nounFor(s.mode, 1), nounFor(s.mode, 2));
    if (s.done) return head + " out of " + count(scanned, "project", "projects");
    return head + " in the first " + count(scanned, "project", "projects");
  }

  function projectUrl(item) {
    return "https://ethglobal.com/showcase/" + item.slug + "-" + item.uuid;
  }

  function bannerUrl(uuid) {
    return "https://cdn.ethglobal.com/projects/" + uuid + "/banner/default.jpg";
  }

  var api = {
    MODES: MODES,
    isShowcaseList: isShowcaseList,
    readFilters: readFilters,
    filterKey: filterKey,
    apiFilters: apiFilters,
    cleanLabel: cleanLabel,
    normalizePrizes: normalizePrizes,
    isFinalist: isFinalist,
    matchesMode: matchesMode,
    normalizeMode: normalizeMode,
    prizeLine: prizeLine,
    sortPrizes: sortPrizes,
    prizeOrgs: prizeOrgs,
    nounFor: nounFor,
    statusText: statusText,
    orgLogoUrl: orgLogoUrl,
    projectUrl: projectUrl,
    bannerUrl: bannerUrl,
  };

  root.ETHGL = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
