/*
 * ETHGlobalists content script.
 *
 * The showcase keeps its filters in the URL (events, partners, categories, q).
 * In a winners mode we read those filters, ask ETHGlobal's public API for the
 * matching projects, keep the ones with prizes, and show them in place of the
 * paginated grid. ETHGlobal's own filters stay in charge; we only follow them.
 */
(function () {
  "use strict";

  var core = globalThis.ETHGL;
  var API = "https://api.ethglobal.com/graphql";
  var FIRST_TAKE = 120;
  var NEXT_TAKE = 250;
  var ROUND_LIMIT = 1600; // projects checked per click, so one click never hammers the API
  var WANT_FIRST = 12;
  var WANT_MORE = 24;
  var MAX_BADGES = 4;
  var CACHE_MS = 15 * 60 * 1000; // a feed survives a trip to a project page and back
  var CACHE_PREFIX = "ethgl:feed:";
  var SCROLL_KEY = "ethgl:scroll";

  var QUERY =
    "query ETHGlobalists($filters: ProjectFilters!, $pagination: Pagination!) {" +
    " getPaginatedSubmittedProjects(filters: $filters, pagination: $pagination) {" +
    " items { uuid slug name tagline event { name slug } prizes { name poolPrize prize { name type sponsor { organization { uuid name } } } } } } }";

  // Same drawing as assets/logo-small.svg (static markup, no user data).
  var MARK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="0.5" y="0.5" width="31" height="31" rx="7" fill="#1C1A14"/><path d="M9.2 25.2 A11 11 0 0 1 9.6 6.4" fill="none" stroke="#C9A15A" stroke-width="2.6" stroke-linecap="round"/><path d="M22.8 25.2 A11 11 0 0 0 22.4 6.4" fill="none" stroke="#C9A15A" stroke-width="2.6" stroke-linecap="round"/><path d="M16 6.5 L10.11 15.81 L16 18.66 Z" fill="#ECE5D3"/><path d="M16 6.5 L21.89 15.81 L16 18.66 Z" fill="#CFC4A8"/><path d="M10.11 17.14 L16 25.5 L16 19.99 Z" fill="#ECE5D3"/><path d="M21.89 17.14 L16 25.5 L16 19.99 Z" fill="#CFC4A8"/></svg>';

  var LABELS = {
    off: "Everyone",
    any: "Winners",
    finalist: "Finalists",
    sponsor: "Sponsor prizes",
  };

  var state = {
    mode: "off",
    href: "",
    key: "",
    filters: {},
    feeds: new Map(), // filter key -> { winners, scanned, skip, done, loading, error, controller, shown }
    ready: false,
  };

  var bar = null;
  var feed = null;
  var restored = false;

  /* ---------- extension plumbing ---------- */

  function alive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (err) {
      return false;
    }
  }

  function saveMode(mode) {
    if (!alive()) return;
    try {
      chrome.storage.local.set({ mode: mode });
    } catch (err) {
      /* extension was reloaded; the page keeps working without us */
    }
  }

  /* ---------- data ---------- */

  function readSession(name) {
    try {
      return JSON.parse(sessionStorage.getItem(name) || "null");
    } catch (err) {
      return null;
    }
  }

  function writeSession(name, value) {
    try {
      if (value == null) sessionStorage.removeItem(name);
      else sessionStorage.setItem(name, JSON.stringify(value));
    } catch (err) {
      /* storage full or blocked; the feed still works, it just won't survive navigation */
    }
  }

  function feedFor(key) {
    var current = state.feeds.get(key);
    if (current) return current;
    current = { winners: [], scanned: 0, skip: 0, done: false, loading: false, error: null, controller: null };
    var saved = readSession(CACHE_PREFIX + key);
    if (saved && Date.now() - saved.at < CACHE_MS && Array.isArray(saved.winners)) {
      current.winners = saved.winners;
      current.scanned = saved.scanned || 0;
      current.skip = saved.skip || 0;
      current.done = !!saved.done;
    }
    state.feeds.set(key, current);
    return current;
  }

  function persist(key, entry) {
    writeSession(CACHE_PREFIX + key, {
      at: Date.now(),
      winners: entry.winners,
      scanned: entry.scanned,
      skip: entry.skip,
      done: entry.done,
    });
  }

  function visible(entry) {
    return entry.winners.filter(function (item) {
      return core.matchesMode(item.prizes, state.mode);
    });
  }

  async function fetchPage(filters, skip, take, signal) {
    var res = await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        operationName: "ETHGlobalists",
        query: QUERY,
        variables: { filters: core.apiFilters(filters), pagination: { skip: skip, take: take } },
      }),
      signal: signal,
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    var json = await res.json();
    var page = json && json.data && json.data.getPaginatedSubmittedProjects;
    if (!page || !Array.isArray(page.items)) throw new Error("Unexpected response");
    return page.items;
  }

  async function loadMore(key) {
    var entry = feedFor(key);
    if (entry.loading || entry.done) return;
    var filters = state.filters;
    var want = (visible(entry).length ? WANT_MORE : WANT_FIRST) + visible(entry).length;
    var checkedThisRound = 0;
    var controller = new AbortController();
    entry.loading = true;
    entry.error = null;
    entry.controller = controller;
    render();
    try {
      while (!entry.done && checkedThisRound < ROUND_LIMIT && visible(entry).length < want) {
        var take = entry.skip === 0 ? FIRST_TAKE : NEXT_TAKE;
        var items = await fetchPage(filters, entry.skip, take, controller.signal);
        entry.skip += items.length;
        entry.scanned += items.length;
        checkedThisRound += items.length;
        if (items.length < take) entry.done = true;
        items.forEach(function (item) {
          var prizes = core.sortPrizes(core.normalizePrizes(item.prizes));
          if (!prizes.length || !item.uuid || !item.slug) return;
          entry.winners.push({
            uuid: item.uuid,
            slug: item.slug,
            name: core.cleanLabel(item.name) || "Untitled",
            tagline: core.cleanLabel(item.tagline),
            event: item.event ? core.cleanLabel(item.event.name) : "",
            prizes: prizes,
          });
        });
        persist(key, entry);
        if (key === state.key) render();
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      entry.error = "Couldn't reach ETHGlobal's API.";
    } finally {
      // A newer run may own this entry by now; only clean up after our own.
      if (entry.controller === controller) {
        entry.loading = false;
        entry.controller = null;
        if (key === state.key) render();
      }
    }
  }

  function abortOthers(key) {
    state.feeds.forEach(function (entry, otherKey) {
      if (otherKey !== key && entry.controller) {
        entry.controller.abort();
        entry.controller = null;
        entry.loading = false;
      }
    });
  }

  /* ---------- DOM ---------- */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function hasProject(node) {
    var links = node.querySelectorAll('a[href^="/showcase/"]');
    for (var i = 0; i < links.length; i++) {
      if (/^\/showcase\/[a-z0-9-]+-[a-z0-9]{5}\/?$/i.test(links[i].getAttribute("href"))) return true;
    }
    return false;
  }

  // The block holding ETHGlobal's title, search box and filter selects. We go right after it,
  // so the selects stay above us and only the grid, pager and "no projects" note come after.
  function findHeader() {
    var input = document.querySelector('input[placeholder^="Search"]');
    if (!input) return null;
    var node = input;
    while (node.parentElement && node.parentElement !== document.body) {
      var parent = node.parentElement;
      if (parent.classList.contains("max-w-7xl")) return node;
      var siblings = Array.prototype.filter.call(parent.children, function (child) {
        return child !== node && child.id !== "ethgl-bar" && child.id !== "ethgl-feed";
      });
      if (siblings.some(hasProject)) return node;
      node = parent;
    }
    return null;
  }

  function buildBar() {
    var root = el("div");
    root.id = "ethgl-bar";
    root.setAttribute("data-ethgl", "");

    var brand = el("span", "ethgl-brand");
    var mark = el("span", "ethgl-mark");
    mark.setAttribute("aria-hidden", "true");
    mark.innerHTML = MARK_SVG;
    brand.appendChild(mark);
    brand.appendChild(el("span", "ethgl-brand-name", "ETHGlobalists"));

    var group = el("div", "ethgl-seg");
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", "Which projects to show");
    core.MODES.forEach(function (mode) {
      var button = el("button", "ethgl-seg-btn", LABELS[mode]);
      button.type = "button";
      button.setAttribute("role", "radio");
      button.dataset.mode = mode;
      button.addEventListener("click", function () {
        setMode(mode);
      });
      group.appendChild(button);
    });
    group.addEventListener("keydown", function (event) {
      var keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      if (!keys[event.key]) return;
      event.preventDefault();
      var index = core.MODES.indexOf(state.mode);
      var next = core.MODES[(index + keys[event.key] + core.MODES.length) % core.MODES.length];
      setMode(next);
      var target = group.querySelector('[data-mode="' + next + '"]');
      if (target) target.focus();
    });

    var status = el("p", "ethgl-status");
    status.setAttribute("aria-live", "polite");

    root.appendChild(brand);
    root.appendChild(group);
    root.appendChild(status);
    return root;
  }

  function buildFeed() {
    var root = el("section");
    root.id = "ethgl-feed";
    root.setAttribute("data-ethgl", "");
    root.setAttribute("aria-label", "Winning projects");
    root.appendChild(el("div", "ethgl-grid"));
    var foot = el("div", "ethgl-foot");
    root.appendChild(foot);
    // Load the next batch as the reader nears the end, like any feed. Only after something was found,
    // so an empty search never keeps calling the API on its own.
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        if (!entries.some(function (e) { return e.isIntersecting; })) return;
        if (state.mode === "off") return;
        var entry = feedFor(state.key);
        if (entry.loading || entry.done || entry.error || !visible(entry).length) return;
        loadMore(state.key);
      }, { rootMargin: "0px 0px 900px 0px" }).observe(foot);
    }
    return root;
  }

  function place() {
    var header = findHeader();
    if (!header || !header.parentElement) return false;
    if (!bar) bar = buildBar();
    if (!feed) feed = buildFeed();
    var parent = header.parentElement;
    if (bar.parentElement !== parent || bar.previousElementSibling !== header) {
      parent.insertBefore(bar, header.nextSibling);
    }
    if (feed.parentElement !== parent || feed.previousElementSibling !== bar) {
      parent.insertBefore(feed, bar.nextSibling);
    }
    return true;
  }

  function teardown() {
    document.documentElement.removeAttribute("data-ethgl-feed");
    if (bar) bar.remove();
    if (feed) feed.remove();
    state.feeds.forEach(function (entry) {
      if (entry.controller) entry.controller.abort();
    });
  }

  function card(item) {
    var link = el("a", "ethgl-card ethgl-enter");
    // Only a card's first appearance fades in; re-ordering the grid later must not replay it.
    link.addEventListener("animationend", function () {
      link.classList.remove("ethgl-enter");
    }, { once: true });
    link.href = core.projectUrl(item);
    link.dataset.uuid = item.uuid;

    var banner = el("span", "ethgl-banner");
    var img = el("img");
    img.alt = item.name + " banner";
    img.loading = "lazy";
    img.decoding = "async";
    img.src = core.bannerUrl(item.uuid);
    img.addEventListener("error", function () {
      banner.classList.add("ethgl-banner-empty");
      banner.replaceChildren(el("span", "ethgl-initial", item.name.charAt(0).toUpperCase()));
    });
    banner.appendChild(img);

    // Sponsor logos sit on the banner's edge, like ETHGlobal's own cards.
    var orgs = core.prizeOrgs(item.prizes);
    var badges = null;
    if (orgs.length) {
      badges = el("span", "ethgl-badges");
      orgs.slice(0, MAX_BADGES).forEach(function (org) {
        var badge = el("span", "ethgl-badge");
        badge.title = org.name;
        var logo = el("img");
        logo.alt = org.name;
        logo.loading = "lazy";
        logo.decoding = "async";
        logo.src = core.orgLogoUrl(org.uuid);
        logo.addEventListener("error", function () {
          badge.classList.add("ethgl-badge-text");
          badge.replaceChildren(document.createTextNode((org.name || "?").charAt(0).toUpperCase()));
        });
        badge.appendChild(logo);
        badges.appendChild(badge);
      });
      if (orgs.length > MAX_BADGES) {
        var more = el("span", "ethgl-badge ethgl-badge-text", "+" + (orgs.length - MAX_BADGES));
        more.title = orgs.slice(MAX_BADGES).map(function (o) { return o.name; }).join(", ");
        badges.appendChild(more);
      }
    }

    var body = el("span", "ethgl-body");
    body.appendChild(el("h2", "ethgl-name", item.name));
    if (item.tagline) body.appendChild(el("p", "ethgl-tagline", item.tagline));

    var list = el("ul", "ethgl-prizes");
    var shown = item.prizes.slice(0, 3);
    shown.forEach(function (prize) {
      var li = el("li", core.isFinalist(prize) ? "ethgl-prize ethgl-prize-final" : "ethgl-prize");
      li.appendChild(el("span", "ethgl-dot"));
      li.appendChild(el("span", "ethgl-prize-text", core.prizeLine(prize)));
      list.appendChild(li);
    });
    if (item.prizes.length > shown.length) {
      list.appendChild(el("li", "ethgl-prize ethgl-prize-more", "+" + (item.prizes.length - shown.length) + " more"));
    }
    body.appendChild(list);
    if (item.event) body.appendChild(el("span", "ethgl-event", item.event));

    link.addEventListener("click", function () {
      writeSession(SCROLL_KEY, { key: state.key, mode: state.mode, y: window.scrollY, at: Date.now() });
    });

    link.appendChild(banner);
    if (badges) link.appendChild(badges);
    link.appendChild(body);
    return link;
  }

  function actionButton(label, onClick, primary) {
    var button = el("button", primary ? "ethgl-btn ethgl-btn-primary" : "ethgl-btn", label);
    button.type = "button";
    button.addEventListener("click", onClick);
    return button;
  }

  function spinner() {
    var s = el("span", "ethgl-spin");
    s.setAttribute("aria-hidden", "true");
    return s;
  }

  function number(n) {
    return n.toLocaleString("en-US");
  }

  function plural(n, one, many) {
    return number(n) + " " + (n === 1 ? one : many);
  }

  function nounFor(mode, n) {
    return core.nounFor(mode, n);
  }

  function renderBar() {
    bar.querySelectorAll(".ethgl-seg-btn").forEach(function (button) {
      var on = button.dataset.mode === state.mode;
      button.setAttribute("aria-checked", on ? "true" : "false");
      button.tabIndex = on ? 0 : -1;
    });
    var entry = feedFor(state.key);
    bar.querySelector(".ethgl-status").textContent = core.statusText({
      mode: state.mode,
      count: visible(entry).length,
      scanned: entry.scanned,
      done: entry.done,
      loading: entry.loading,
    });
  }

  function renderFeed() {
    var grid = feed.querySelector(".ethgl-grid");
    var foot = feed.querySelector(".ethgl-foot");
    var entry = feedFor(state.key);
    var items = visible(entry);

    // Keep cards that are already on screen so images don't flash on every update.
    var wanted = items.map(function (item) { return item.uuid; }).join(",");
    if (grid.dataset.keys !== wanted) {
      var existing = new Map();
      grid.querySelectorAll(".ethgl-card").forEach(function (node) {
        existing.set(node.dataset.uuid, node);
      });
      var nodes = items.map(function (item) {
        return existing.get(item.uuid) || card(item);
      });
      grid.replaceChildren.apply(grid, nodes);
      grid.dataset.keys = wanted;
    }

    foot.replaceChildren();
    foot.className = "ethgl-foot";

    if (entry.error) {
      foot.classList.add(items.length ? "ethgl-foot-row" : "ethgl-empty");
      if (!items.length) foot.appendChild(el("h3", "ethgl-empty-title", "Couldn't load winners"));
      foot.appendChild(el("p", "ethgl-note", entry.error + " Your ETHGlobal filters are untouched."));
      var row = el("div", "ethgl-actions");
      row.appendChild(actionButton("Try again", function () { loadMore(state.key); }, true));
      row.appendChild(actionButton("Show everyone", function () { setMode("off"); }));
      foot.appendChild(row);
      return;
    }

    if (entry.loading) {
      foot.classList.add(items.length ? "ethgl-foot-row" : "ethgl-empty");
      var line = el("p", "ethgl-note ethgl-loading");
      line.appendChild(spinner());
      line.appendChild(document.createTextNode(
        entry.scanned ? "Checked " + number(entry.scanned) + " projects, still looking…" : "Looking for winners…",
      ));
      foot.appendChild(line);
      return;
    }

    if (!items.length) {
      foot.classList.add("ethgl-empty");
      var noun = nounFor(state.mode, 2);
      if (entry.done) {
        foot.appendChild(el("h3", "ethgl-empty-title", entry.scanned ? "No " + noun + " here yet" : "No projects match these filters"));
        foot.appendChild(el("p", "ethgl-note", entry.scanned
          ? "Checked all " + plural(entry.scanned, "project", "projects") + " for these filters. If the event just ended, judging may still be running."
          : "Try a different event, partner, category or search."));
        if (entry.scanned) foot.appendChild(actionButton("Show everyone", function () { setMode("off"); }, true));
      } else {
        foot.appendChild(el("h3", "ethgl-empty-title", "No " + noun + " in the first " + number(entry.scanned) + " projects"));
        foot.appendChild(el("p", "ethgl-note", "Older events further down usually have more. Keep looking, or narrow it with an event filter."));
        var actions = el("div", "ethgl-actions");
        actions.appendChild(actionButton("Keep looking", function () { loadMore(state.key); }, true));
        actions.appendChild(actionButton("Show everyone", function () { setMode("off"); }));
        foot.appendChild(actions);
      }
      return;
    }

    foot.classList.add("ethgl-foot-row");
    if (entry.done) {
      foot.appendChild(el("p", "ethgl-note", "That's every " + nounFor(state.mode, 1) + " for these filters."));
    } else {
      foot.appendChild(actionButton("Show more " + nounFor(state.mode, 2), function () { loadMore(state.key); }, true));
    }
  }

  function restoreScroll() {
    var saved = readSession(SCROLL_KEY);
    if (!saved) return;
    writeSession(SCROLL_KEY, null);
    if (saved.key !== state.key || saved.mode !== state.mode || Date.now() - saved.at > CACHE_MS) return;
    requestAnimationFrame(function () {
      window.scrollTo(0, saved.y);
    });
  }

  function render() {
    if (!bar || !feed) return;
    renderBar();
    var on = state.mode !== "off";
    if (on) document.documentElement.setAttribute("data-ethgl-feed", state.mode);
    else document.documentElement.removeAttribute("data-ethgl-feed");
    if (on) renderFeed();
    if (on && !restored && feed.querySelector(".ethgl-card")) {
      restored = true;
      restoreScroll();
    }
  }

  /* ---------- flow ---------- */

  function setMode(mode) {
    var next = core.normalizeMode(mode);
    if (next === state.mode) return;
    state.mode = next;
    saveMode(next);
    sync(true);
  }

  function sync(force) {
    if (!alive()) {
      stop();
      teardown();
      return;
    }
    if (!core.isShowcaseList(location.pathname)) {
      if (bar && bar.isConnected) teardown();
      state.href = location.href;
      return;
    }
    if (!place()) return;
    var filters = core.readFilters(location.search);
    var key = core.filterKey(filters);
    var changed = key !== state.key;
    state.href = location.href;
    state.filters = filters;
    state.key = key;
    if (changed) {
      abortOthers(key);
      if (feed) {
        var grid = feed.querySelector(".ethgl-grid");
        grid.replaceChildren();
        grid.dataset.keys = "";
      }
    }
    if (changed || force) {
      var entry = feedFor(key);
      if (state.mode !== "off" && !entry.loading && !entry.done && !entry.error && visible(entry).length < WANT_FIRST) {
        loadMore(key);
      }
    }
    render();
  }

  var timer = 0;
  var observer = null;

  function stop() {
    clearInterval(timer);
    if (observer) observer.disconnect();
  }

  function start() {
    try {
      chrome.storage.local.get({ mode: "off" }, function (stored) {
        state.mode = core.normalizeMode(stored && stored.mode);
        state.ready = true;
        sync(true);
      });
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== "local" || !changes.mode) return;
        var next = core.normalizeMode(changes.mode.newValue);
        if (next === state.mode) return;
        state.mode = next;
        sync(true);
      });
    } catch (err) {
      return;
    }

    // Next.js changes pages without a reload, so watch the URL and the DOM.
    timer = setInterval(function () {
      if (!state.ready) return;
      if (location.href !== state.href) sync(false);
    }, 250);

    var pending = 0;
    observer = new MutationObserver(function () {
      if (!state.ready || pending) return;
      pending = requestAnimationFrame(function () {
        pending = 0;
        if (!core.isShowcaseList(location.pathname)) return;
        if (!bar || !bar.isConnected || !feed || !feed.isConnected || bar.nextElementSibling !== feed) sync(false);
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  start();
})();
