import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { getQueueType, rankSnapshotScore, createSafeStorage, assignTierGrades, isEarlyEnd, summarizeTft } from "../public/data-utils.js";
import { authorizeAdmin, createRateLimiter, securityHeaders } from "../src/security.mjs";
import { isStatsMatch } from "../src/match-store.mjs";
import { handleApiRequest } from "../src/api-core.mjs";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const store = await readFile(new URL("../src/match-store.mjs", import.meta.url), "utf8");
const api = await readFile(new URL("../src/api-core.mjs", import.meta.url), "utf8");

// Exercise the actual frontend functions without starting a browser or Riot API.
function functionSource(source, name) {
  const match = source.match(new RegExp(`(?:export )?(?:async )?function ${name}\\(`));
  assert.ok(match, `Function exists: ${name}`);
  const start = match.index;
  const next = source.slice(start + 1).search(/\n(?:export )?(?:async )?function /);
  return source.slice(start, next < 0 ? source.length : start + 1 + next).replace(/^export /, "");
}

test("queue labels and all normal queues use the correct category", () => {
  assert.equal(getQueueType(400).category, "normal");
  assert.match(getQueueType(430).label, /비공개/);
  assert.equal(getQueueType(123456).category, "other");
});

test("apex tier promotions never invent LP", () => {
  const score = (tier, lp) => rankSnapshotScore({ tier, rank: "I", leaguePoints: lp });
  assert.equal(score("MASTER", 500), score("GRANDMASTER", 500));
  assert.equal(score("MASTER", 1000), score("CHALLENGER", 1000));
  assert.equal(score("MASTER", 0), score("DIAMOND", 100));
  assert.equal(score("GRANDMASTER", 510) - score("MASTER", 500), 10);
});

test("blocked storage retains edits and removals for the current session", () => {
  const storage = createSafeStorage(() => ({
    getItem: () => "old", setItem: () => { throw Error("quota"); }, removeItem: () => { throw Error("blocked"); }
  }));
  storage.setItem("searches", "new");
  assert.equal(storage.getItem("searches"), "new");
  storage.removeItem("searches");
  assert.equal(storage.getItem("searches"), null);
  const disabled = createSafeStorage(() => { throw Error("disabled"); });
  disabled.setItem("favorite", "one");
  assert.equal(disabled.getItem("favorite"), "one");
});

test("tier grades require enough champions and enough games", () => {
  const small = [{ lowSample: false, tierScore: 99 }];
  assignTierGrades(small);
  assert.equal(small[0].tierGrade, "N/A");
  const rows = Array.from({ length: 10 }, (_, i) => ({ lowSample: false, tierScore: 100 - i }));
  rows.push({ lowSample: true, tierScore: 999 });
  assignTierGrades(rows);
  assert.equal(rows[0].tierGrade, "S");
  assert.equal(rows[10].tierGrade, "N/A");
});

test("stats scope excludes other queues, old patches, dates and short games", () => {
  const match = { info: { queueId: 420, gameVersion: "16.19.123", gameCreation: 2000, gameDuration: 1200 } };
  const scope = { patchVersion: "16.19.1", since: 1000 };
  assert.equal(isStatsMatch(match, scope), true);
  for (const change of [{ queueId: 440 }, { gameVersion: "16.18.1" }, { gameCreation: 999 }, { gameDuration: 299 }]) {
    assert.equal(isStatsMatch({ info: { ...match.info, ...change } }, scope), false);
  }
  assert.equal(isEarlyEnd({ info: { gameDuration: 120, participants: [] } }), true);
});

test("admin auth fails closed and checks full bearer tokens", async () => {
  const token = "test-only-admin-token-32-characters-long";
  assert.equal(authorizeAdmin({ authorization: `Bearer ${token}` }, token), true);
  assert.equal(authorizeAdmin({ authorization: "Bearer wrong" }, token), false);
  assert.equal(authorizeAdmin({}, token), false);
  assert.equal(authorizeAdmin({ authorization: "Bearer short" }, "short"), false);
  for (const pathname of ["/api/seed-champion-stats", "/api/recalculate-champion-stats"]) {
    const result = await handleApiRequest({ method: "POST", pathname, searchParams: new URLSearchParams(), headers: {} });
    assert.equal(result.status, 401);
    assert.equal(result.body.debug, undefined);
  }
  const result = await handleApiRequest({ method: "POST", pathname: "/api/summoner", searchParams: new URLSearchParams() });
  assert.equal(result.status, 405);
  assert.equal(result.headers.Allow, "GET");
  assert.match(securityHeaders["Content-Security-Policy"], /script-src 'self';/);
});

test("rate limits are isolated per client and expire", () => {
  const limit = createRateLimiter({ limit: 2, windowMs: 1000 });
  assert.equal(limit("one", 0), 0);
  assert.equal(limit("one", 0), 0);
  assert.equal(limit("one", 1), 1);
  assert.equal(limit("two", 1), 0);
  assert.equal(limit("one", 1000), 0);
});

test("TFT summaries handle empty and filtered input", () => {
  assert.equal(summarizeTft([]).games, 0);
  const summary = summarizeTft([{ placement: 1, level: 9, traits: [], units: [] }, { placement: 8, level: 7, traits: [], units: [] }]);
  assert.equal(summary.averagePlacement, 4.5);
  assert.equal(summary.topFourRate, 50);
});

test("the latest search wins even when an aborted request still resolves", async () => {
  const requests = [], rendered = [], recents = [], errors = [];
  const ctx = vm.createContext({
    URLSearchParams, AbortController, AbortSignal, clearInterval,
    window: { matchMedia: () => ({ matches: true }) },
    input: { value: "" }, requestStatus: {}, refreshButton: {},
    searchRequestVersion: 0, refreshTimer: undefined, searchController: null, tftController: null, selectedSearchGame: "lol",
    currentRiotId: "", currentData: null, currentTftData: null, tftLoadingPromise: null, tftRequestVersion: 0,
    championPerformanceExpanded: false, matchesExpanded: false, personalTierStats: new Map(), activeFilter: "all",
    projectInfo: {}, results: { scrollIntoView() {} }, document: { querySelectorAll: () => [], querySelector: () => ({ setAttribute() {} }) },
    history: { replaceState() {} },
    setSearchGame() {}, setView() {}, selectGameTab() {}, resetDetailedAnalysis() {}, setRefreshCooldown() {}, updateFavoriteButton() {},
    updateRankSnapshots: () => ({}), renderProfile: (data) => rendered.push(data.account.gameName),
    saveRecentSearch: (id) => recents.push(id), showError: (message) => errors.push(message),
    fetch: (url) => new Promise((resolve) => requests.push({ url, resolve }))
  });
  vm.runInContext(["search", "parseRiotId", "parseJsonResponse"].map((name) => functionSource(app, name)).join("\n"), ctx);
  const a = vm.runInContext("search('PlayerA#KR1')", ctx);
  const b = vm.runInContext("search('PlayerB#KR1')", ctx);
  const payload = (name) => ({ account: { gameName: name, tagLine: "KR1" }, matches: [], ranked: [] });
  requests[1].resolve({ ok: true, json: async () => payload("PlayerB") }); await b;
  requests[0].resolve({ ok: true, json: async () => payload("PlayerA") }); await a;
  assert.equal(ctx.currentData.account.gameName, "PlayerB");
  assert.deepEqual(rendered, ["PlayerB"]);
  assert.deepEqual(recents, ["PlayerB #KR1"]);
  assert.deepEqual(errors, []);
  assert.equal(vm.runInContext("parseRiotId('bad#tag\\u0000')", ctx), null);
});

test("empty and ARAM-only history never generates ward or farming advice", () => {
  const ctx = vm.createContext({ activeFilter: "all", console, getQueueType, isEarlyEnd });
  const names = ["analyzePlayerMatches", "aggregatePersonalStats", "classifyPlaystyle", "createImprovementTips", "selectHighlight", "avg", "normalizePlayerPosition", "getCurrentParticipant", "isCurrentParticipant", "normalizeName", "number"];
  vm.runInContext(names.map((name) => functionSource(app, name)).join("\n"), ctx);
  const empty = ctx.analyzePlayerMatches({ matches: [], account: {} });
  assert.equal(empty.playstyle.type, "분석 표본 부족");
  assert.equal(empty.count, 0);
  const participant = { puuid: "test", teamId: 100, kills: 5, deaths: 2, assists: 5, win: true };
  const match = { info: { queueId: 450, gameDuration: 1200, participants: [participant] } };
  const aram = ctx.analyzePlayerMatches({ account: { puuid: "test" }, matches: Array(6).fill(match) });
  assert.equal(aram.comparisonCount, 0);
  assert.equal(aram.tips.some((tip) => /와드|CS/.test(tip)), false);
  vm.runInContext("activeFilter = 'solo'", ctx);
  assert.equal(ctx.analyzePlayerMatches({ account: { puuid: "test" }, matches: [match] }).count, 0);
});

test("participant persistence retries a failed write on an existing match", async () => {
  const existing = new Map();
  let participantWrites = 0;
  const supabase = { from: (table) => ({ upsert: async (rows) => {
    if (table === "matches") existing.set("one", {});
    else if (++participantWrites === 1) return { error: { message: "temporary" } };
    return { error: null };
  } }) };
  const ctx = vm.createContext({ hasSupabaseConfig: () => true, getSupabaseClient: async () => supabase, getMatchesByIds: async () => existing, databaseError: (error) => Error(error.message) });
  vm.runInContext(functionSource(store, "saveMatches"), ctx);
  const matches = [{ metadata: { matchId: "one" }, info: { participants: [{ puuid: "player" }] } }];
  await assert.rejects(ctx.saveMatches(matches));
  await ctx.saveMatches(matches);
  assert.equal(participantWrites, 2);
});

test("database stats query scopes and paginates before loading participants", async () => {
  const calls = [];
  const query = {};
  for (const method of ["select", "eq", "like", "gte", "order"]) {
    query[method] = (...args) => { calls.push([method, ...args]); return query; };
  }
  query.range = async (...args) => {
    calls.push(["range", ...args]);
    return { data: [{ match_id: "test", matches: { game_creation: 2000 } }], error: null };
  };
  const ctx = vm.createContext({ hasSupabaseConfig: () => true, getSupabaseClient: async () => ({ from: () => query }) });
  vm.runInContext(functionSource(store, "getParticipantsForStats"), ctx);
  const rows = await ctx.getParticipantsForStats({ patchVersion: "16.19.1", since: 1000 });
  assert.ok(calls.some(([method, key, value]) => method === "eq" && key === "matches.queue_id" && value === 420));
  assert.ok(calls.some(([method, key, value]) => method === "like" && key === "matches.game_version" && value === "16.19.%"));
  assert.ok(calls.some(([method, key, value]) => method === "gte" && key === "matches.game_creation" && value === 1000));
  assert.ok(calls.some(([method, key, value]) => method === "gte" && key === "matches.game_duration" && value === 300));
  assert.deepEqual(calls.find(([method]) => method === "range"), ["range", 0, 999]);
  assert.equal(rows[0].game_creation, 2000);
  assert.equal(rows[0].matches, undefined);
});

test("optional rank, static data and persistence failures preserve LoL matches", async () => {
  let cached;
  const ctx = vm.createContext({
    REGION: "asia", PLATFORM: "kr", responseCache: new Map(), championStatsCache: new Map(),
    cachedProfile: () => null,
    riotFetch: async (_region, path) => path.includes("by-riot-id") ? { puuid: "test", gameName: "Player", tagLine: "KR1" }
      : path.includes("/ids?") ? ["match"] : { summonerLevel: 1, profileIconId: 1 },
    riotFetchOptional: async () => null, getDdragonVersion: async () => "16.19.1",
    getStoredOrFetchMatches: async () => [{ metadata: { matchId: "match" } }],
    getStaticData: async () => { throw Error("static unavailable"); },
    saveMatches: async () => { throw Error("database unavailable"); },
    compactMatch: (match) => match, compactStaticData: (staticData) => staticData,
    getPersistenceWarning: () => null, cacheProfile: (_cache, _key, value) => { cached = value; }
  });
  vm.runInContext(functionSource(api, "getSummonerProfile"), ctx);
  const result = await ctx.getSummonerProfile("Player", "KR1");
  assert.equal(result.matches.length, 1);
  assert.equal(result.ranked.length, 0);
  assert.ok(result.rankWarning);
  assert.ok(result.persistenceWarning);
  assert.equal(cached, result);
});

test("a failed local write does not poison retries or mutate cached matches", async () => {
  let writes = 0, renames = 0;
  const original = { matches: [], updatedAt: null };
  const ctx = vm.createContext({
    localWriteQueue: Promise.resolve(), localStoreCache: original, root: "workspace", localStorePath: "matches.json",
    readLocalStore: async () => ctx.localStoreCache, join: (...parts) => parts.join("/"),
    mkdir: async () => {}, rename: async () => { renames += 1; },
    writeFile: async () => { if (++writes === 1) throw Error("disk unavailable"); }
  });
  vm.runInContext(functionSource(store, "saveLocalMatches"), ctx);
  const matches = [{ metadata: { matchId: "one" } }];
  await assert.rejects(ctx.saveLocalMatches(matches));
  assert.equal(original.matches.length, 0);
  const result = await ctx.saveLocalMatches(matches);
  assert.equal(result.inserted, 1);
  assert.equal(ctx.localStoreCache.matches.length, 1);
  assert.equal(renames, 1);
});

test("cached rank snapshots keep their baseline and failed rank lookups never overwrite it", () => {
  const storage = createSafeStorage(() => { throw Error("session only"); });
  const ctx = vm.createContext({ storage, rankSnapshotScore, getQueueType });
  vm.runInContext(functionSource(app, "updateRankSnapshots"), ctx);
  const makeData = (lp, updatedAt) => ({ account: { puuid: "player" }, matches: [], updatedAt,
    ranked: [{ queueType: "RANKED_SOLO_5x5", tier: "MASTER", leaguePoints: lp, wins: 10, losses: 5 }] });
  ctx.updateRankSnapshots(makeData(100, "2026-10-01T00:00:00Z"));
  const latest = makeData(120, "2026-10-02T00:00:00Z");
  assert.equal(ctx.updateRankSnapshots(latest).RANKED_SOLO_5x5.delta, 20);
  assert.equal(ctx.updateRankSnapshots(latest).RANKED_SOLO_5x5.delta, 20);
  const saved = storage.getItem("rift-record-rank-snapshots:player");
  ctx.updateRankSnapshots({ ...latest, ranked: [], rankWarning: "unavailable" });
  assert.equal(storage.getItem("rift-record-rank-snapshots:player"), saved);
});
