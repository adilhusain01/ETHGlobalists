// Behaviour of the pure helpers, taken from how ethglobal.com/showcase and its
// GraphQL API actually behave (checked live on 2026-11-09).
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/core.js");

test("only the showcase list page counts, not project pages", () => {
  assert.equal(core.isShowcaseList("/showcase"), true);
  assert.equal(core.isShowcaseList("/showcase/"), true);
  assert.equal(core.isShowcaseList("/showcase/noirwire-p6oq0"), false);
  assert.equal(core.isShowcaseList("/events"), false);
  assert.equal(core.isShowcaseList("/"), false);
});

test("filters are read from the same URL params the showcase writes", () => {
  const search = "?events=tokyo2026&partners=1inch,uniswap&categories=Artificial+Intelligence,DeFi&q=agent&page=3";
  assert.deepEqual(core.readFilters(search), {
    events: ["tokyo2026"],
    partners: ["1inch", "uniswap"],
    categories: ["Artificial Intelligence", "DeFi"],
    q: "agent",
  });
});

test("empty, blank and duplicate filter values are dropped", () => {
  assert.deepEqual(core.readFilters(""), {});
  assert.deepEqual(core.readFilters("?page=2"), {});
  assert.deepEqual(core.readFilters("?q=%20%20&partners=,1inch,,1inch"), { partners: ["1inch"] });
});

test("the page number does not change the filter key, the filters do", () => {
  const a = core.filterKey(core.readFilters("?events=mumbai&page=1"));
  const b = core.filterKey(core.readFilters("?page=4&events=mumbai"));
  const c = core.filterKey(core.readFilters("?events=tokyo2026"));
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(
    core.filterKey(core.readFilters("?partners=a,b")),
    core.filterKey(core.readFilters("?partners=b,a")),
  );
});

test("labels lose emoji and extra spaces", () => {
  assert.equal(core.cleanLabel("🏆 ETHGlobal Tokyo 2026 Finalist"), "ETHGlobal Tokyo 2026 Finalist");
  assert.equal(core.cleanLabel("  1st   place "), "1st place");
  assert.equal(core.cleanLabel(null), "");
});

const org = (uuid, name) => ({ sponsor: { organization: { uuid, name } } });
const finalist = { name: "🏆 ETHGlobal Tokyo 2026 Finalist", poolPrize: false, prize: { name: "ETHGlobal", type: "finalist", ...org("xdat5", "ETHGlobal") } };
const tier = { name: "1st place", poolPrize: false, prize: { name: "Build with Uniswap", type: "tier", ...org("026zc", "Uniswap") } };
const track = { name: "Agents That Pay for Themselves", poolPrize: false, prize: { name: "Agents That Pay for Themselves", type: "track" } };
const pool = { name: "Pool prize", poolPrize: true, prize: { name: "Best use of ENS", type: "tier" } };

test("prizes are normalised into place, track, type and pool", () => {
  assert.deepEqual(core.normalizePrizes([tier]), [
    { place: "1st place", track: "Build with Uniswap", type: "tier", pool: false, org: { uuid: "026zc", name: "Uniswap" } },
  ]);
  assert.deepEqual(core.normalizePrizes(null), []);
  assert.deepEqual(core.normalizePrizes([{}]), [{ place: "", track: "", type: null, pool: false, org: null }]);
});

test("finalists are spotted by type or by name", () => {
  const [f, t] = core.normalizePrizes([finalist, tier]);
  assert.equal(core.isFinalist(f), true);
  assert.equal(core.isFinalist(t), false);
  assert.equal(core.isFinalist({ place: "Finalist", track: "", type: null }), true);
});

test("modes decide who stays", () => {
  const none = [];
  const onlyFinal = core.normalizePrizes([finalist]);
  const onlySponsor = core.normalizePrizes([tier]);
  const both = core.normalizePrizes([finalist, track]);
  assert.equal(core.matchesMode(none, "off"), true);
  assert.equal(core.matchesMode(none, "any"), false);
  assert.equal(core.matchesMode(onlyFinal, "any"), true);
  assert.equal(core.matchesMode(onlyFinal, "finalist"), true);
  assert.equal(core.matchesMode(onlyFinal, "sponsor"), false);
  assert.equal(core.matchesMode(onlySponsor, "finalist"), false);
  assert.equal(core.matchesMode(onlySponsor, "sponsor"), true);
  assert.equal(core.matchesMode(both, "sponsor"), true);
});

test("unknown or old stored modes fall back safely", () => {
  assert.equal(core.normalizeMode("bounty"), "sponsor");
  assert.equal(core.normalizeMode("finalist"), "finalist");
  assert.equal(core.normalizeMode("whatever"), "off");
  assert.equal(core.normalizeMode(undefined), "off");
});

test("prize lines read like a person wrote them", () => {
  const [f, t, tr, p] = core.normalizePrizes([finalist, tier, track, pool]);
  assert.equal(core.prizeLine(f), "Finalist");
  assert.equal(core.prizeLine(t), "1st place · Build with Uniswap");
  assert.equal(core.prizeLine(tr), "Agents That Pay for Themselves");
  assert.equal(core.prizeLine(p), "Pool prize · Best use of ENS");
});

test("finalists sort first, then by place", () => {
  const second = { name: "2nd place", prize: { name: "Build with 0G", type: "tier" } };
  const sorted = core.sortPrizes(core.normalizePrizes([track, second, tier, finalist]));
  assert.deepEqual(sorted.map(core.prizeLine), [
    "Finalist",
    "1st place · Build with Uniswap",
    "2nd place · Build with 0G",
    "Agents That Pay for Themselves",
  ]);
});

test("project and banner links match ethglobal.com", () => {
  assert.equal(core.projectUrl({ slug: "noirwire", uuid: "p6oq0" }), "https://ethglobal.com/showcase/noirwire-p6oq0");
  assert.equal(core.bannerUrl("p6oq0"), "https://cdn.ethglobal.com/projects/p6oq0/banner/default.jpg");
});

test("API filters only carry the fields the API accepts", () => {
  assert.deepEqual(core.apiFilters({ events: ["mumbai"], q: "zk", partners: ["1inch"], categories: ["DeFi"] }), {
    events: ["mumbai"],
    q: "zk",
    partners: ["1inch"],
    categories: ["DeFi"],
  });
  assert.deepEqual(core.apiFilters({}), {});
});

test("each sponsor's logo shows once per card, in prize order", () => {
  const second = { name: "3rd place", prize: { name: "Build with Uniswap v4", type: "tier", ...org("026zc", "Uniswap") } };
  const ens = { name: "Best use", prize: { name: "ENS", type: "tier", ...org("bw7y9", "ENS") } };
  const orphan = { name: "Prize", prize: { name: "No sponsor", type: "track" } };
  const prizes = core.sortPrizes(core.normalizePrizes([tier, ens, second, orphan, finalist]));
  assert.deepEqual(core.prizeOrgs(prizes), [
    { uuid: "xdat5", name: "ETHGlobal" },
    { uuid: "026zc", name: "Uniswap" },
    { uuid: "bw7y9", name: "ENS" },
  ]);
  assert.deepEqual(core.prizeOrgs([]), []);
});

test("sponsor logos come from the same CDN path ETHGlobal's cards use", () => {
  assert.equal(core.orgLogoUrl("if0ri"), "https://cdn.ethglobal.com/organizations/if0ri/square-logo/default.png");
});

test("the status line says what was checked, without nonsense counts", () => {
  assert.equal(core.statusText({ mode: "off" }), "Showing every project, as ETHGlobal lists them.");
  assert.equal(core.statusText({ mode: "any", count: 0, scanned: 0, loading: true }), "Checking projects for prizes…");
  assert.equal(core.statusText({ mode: "any", count: 0, scanned: 0, done: true }), "No projects match these filters");
  assert.equal(core.statusText({ mode: "any", count: 29, scanned: 254, done: true }), "29 winners out of 254 projects");
  assert.equal(core.statusText({ mode: "any", count: 1, scanned: 1, done: true }), "1 winner out of 1 project");
  assert.equal(core.statusText({ mode: "finalist", count: 18, scanned: 1720 }), "18 finalists in the first 1,720 projects");
  assert.equal(core.statusText({ mode: "sponsor", count: 0, scanned: 400, loading: true }), "0 sponsor prize winners in the first 400 projects");
});

test("nouns follow the mode and the count", () => {
  assert.equal(core.nounFor("any", 1), "winner");
  assert.equal(core.nounFor("any", 2), "winners");
  assert.equal(core.nounFor("finalist", 1), "finalist");
  assert.equal(core.nounFor("sponsor", 3), "sponsor prize winners");
});
