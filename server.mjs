import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const storePath = join(root, "data", "matches.json");
await loadEnv(join(root, ".env"));
const { handleApiRequest } = await import("./src/api-core.mjs");

const PORT = Number(process.env.PORT || 4173);
const API_KEY = process.env.RIOT_API_KEY;
const PLATFORM = "kr";
const REGION = "asia";

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

let ddragonCache = { version: "16.9.1", expiresAt: 0 };
let staticDataCache = { value: null, expiresAt: 0 };
let riotRequestQueue = Promise.resolve();
let storeWriteQueue = Promise.resolve();
let storeCache = null;
const responseCache = new Map();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      const result = await handleApiRequest({
        method: request.method,
        pathname: url.pathname,
        searchParams: url.searchParams
      });
      return sendJson(response, result.status, result.body);
    }

    if (url.pathname === "/api/health") {
      return sendJson(response, 200, {
        status: "ok",
        hasRiotApiKey: Boolean(API_KEY),
        timestamp: new Date().toISOString()
      });
    }

    if (url.pathname === "/api/static") {
      const version = await getDdragonVersion();
      const staticData = await getStaticData(version);
      return sendJson(response, 200, { ddragonVersion: version, staticData });
    }

    if (url.pathname === "/api/champion-stats") {
      const position = normalizePosition(url.searchParams.get("position") || "TOP");
      if (!position) {
        return sendJson(response, 400, { error: "지원하지 않는 라인입니다." });
      }
      return sendJson(response, 200, await getChampionStats(position));
    }

    if (url.pathname === "/api/recalculate-champion-stats" && request.method === "POST") {
      const positions = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];
      const results = await Promise.all(positions.map((position) => getChampionStats(position)));
      return sendJson(response, 200, {
        ok: true,
        recalculatedAt: new Date().toISOString(),
        positions: results.map((result) => ({
          position: result.position,
          champions: result.champions.length
        }))
      });
    }

    if (url.pathname === "/api/seed-champion-stats" && request.method === "POST") {
      if (!API_KEY) {
        return sendJson(response, 503, {
          error: "RIOT_API_KEY가 설정되지 않았습니다. .env 파일을 확인해 주세요."
        });
      }

      const players = clamp(Number(url.searchParams.get("players") || 5), 1, 10);
      const matches = clamp(Number(url.searchParams.get("matches") || 10), 1, 15);
      const tier = String(url.searchParams.get("tier") || "challenger").toLowerCase();
      return sendJson(response, 200, await seedChampionStats({ players, matches, tier }));
    }

    if (url.pathname === "/api/summoner") {
      if (!API_KEY) {
        return sendJson(response, 503, {
          error: "RIOT_API_KEY가 설정되지 않았습니다. .env 파일을 확인해 주세요."
        });
      }

      const gameName = url.searchParams.get("gameName")?.trim();
      const tagLine = url.searchParams.get("tagLine")?.trim();

      if (!gameName || !tagLine) {
        return sendJson(response, 400, {
          error: "Riot ID를 게임이름#태그 형식으로 입력해 주세요."
        });
      }

      const payload = await getSummonerProfile(gameName, tagLine);
      return sendJson(response, 200, payload);
    }

    return serveStatic(url.pathname, response);
  } catch (error) {
    const status = error.status || 500;
    const message = status === 404
      ? "플레이어를 찾을 수 없습니다. Riot ID와 태그를 확인해 주세요."
      : status === 403
        ? "API 키가 만료되었거나 유효하지 않습니다. 새 개발 키로 교체해 주세요."
        : status === 429
          ? "Riot API 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요."
          : error.message || "서버에서 요청을 처리하지 못했습니다.";

    console.error(error);
    return sendJson(response, status, {
      error: message,
      endpoint: error.endpoint,
      riotMessage: error.riotMessage
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Rift Record running at http://127.0.0.1:${PORT}`);
  if (!API_KEY) {
    console.log("RIOT_API_KEY is not configured. Copy .env.example to .env.");
  }
});

async function getSummonerProfile(gameName, tagLine) {
  const cacheKey = `${gameName.toLowerCase()}#${tagLine.toLowerCase()}`;
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    await saveMatches(cached.value.matches);
    return cached.value;
  }

  const account = await riotFetch(
    REGION,
    `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
  );

  const [summoner, matchIds, version] = await Promise.all([
    riotFetch(PLATFORM, `/lol/summoner/v4/summoners/by-puuid/${account.puuid}`),
    riotFetch(
      REGION,
      `/lol/match/v5/matches/by-puuid/${account.puuid}/ids?queue=420&start=0&count=15`
    ),
    getDdragonVersion()
  ]);

  const [ranked, masteries, matches, staticData] = await Promise.all([
    riotFetch(PLATFORM, `/lol/league/v4/entries/by-puuid/${account.puuid}`),
    riotFetch(
      PLATFORM,
      `/lol/champion-mastery/v4/champion-masteries/by-puuid/${account.puuid}/top?count=5`
    ),
    getStoredOrFetchMatches(matchIds),
    getStaticData(version)
  ]);
  await saveMatches(matches);

  const compactMatches = matches.map(compactMatch);
  const payload = {
    account: {
      gameName: account.gameName || gameName,
      tagLine: account.tagLine || tagLine,
      puuid: account.puuid
    },
    summoner: {
      level: summoner.summonerLevel,
      profileIconId: summoner.profileIconId
    },
    ranked,
    masteries,
    matches: compactMatches,
    staticData: compactStaticData(staticData, compactMatches, masteries),
    ddragonVersion: version,
    updatedAt: new Date().toISOString()
  };

  responseCache.set(cacheKey, {
    value: payload,
    expiresAt: Date.now() + 2 * 60 * 1000
  });
  return payload;
}

function compactMatch(match) {
  return {
    metadata: { matchId: match.metadata.matchId },
    info: {
      queueId: match.info.queueId,
      gameCreation: match.info.gameCreation,
      gameStartTimestamp: match.info.gameStartTimestamp,
      gameDuration: match.info.gameDuration,
      participants: match.info.participants.map((participant) => ({
        puuid: participant.puuid,
        teamId: participant.teamId,
        win: participant.win,
        championId: participant.championId,
        championName: participant.championName,
        champLevel: participant.champLevel,
        riotIdGameName: participant.riotIdGameName,
        summonerName: participant.summonerName,
        teamPosition: participant.teamPosition,
        individualPosition: participant.individualPosition,
        kills: participant.kills,
        deaths: participant.deaths,
        assists: participant.assists,
        totalMinionsKilled: participant.totalMinionsKilled,
        neutralMinionsKilled: participant.neutralMinionsKilled,
        totalDamageDealtToChampions: participant.totalDamageDealtToChampions,
        visionScore: participant.visionScore,
        goldEarned: participant.goldEarned,
        item0: participant.item0,
        item1: participant.item1,
        item2: participant.item2,
        item3: participant.item3,
        item4: participant.item4,
        item5: participant.item5,
        item6: participant.item6,
        perks: participant.perks
      }))
    }
  };
}

function compactStaticData(staticData, matches, masteries) {
  const championIds = new Set(masteries.map((mastery) => String(mastery.championId)));
  const runeIds = new Set();
  const styleIds = new Set();
  for (const match of matches) {
    for (const participant of match.info.participants) {
      for (const style of participant.perks?.styles || []) {
        styleIds.add(String(style.style));
        for (const selection of style.selections || []) {
          runeIds.add(String(selection.perk));
        }
      }
    }
  }
  return {
    champions: Object.fromEntries(
      [...championIds].filter((id) => staticData.champions[id]).map((id) => [id, staticData.champions[id]])
    ),
    runes: Object.fromEntries(
      [...runeIds].filter((id) => staticData.runes[id]).map((id) => [id, staticData.runes[id]])
    ),
    runeStyles: Object.fromEntries(
      [...styleIds].filter((id) => staticData.runeStyles[id]).map((id) => [id, staticData.runeStyles[id]])
    )
  };
}

async function getStoredOrFetchMatches(matchIds) {
  const store = await readStore();
  const storedMatches = new Map(store.matches.map((match) => [match.metadata.matchId, match]));
  return mapLimit(matchIds, 2, (matchId) =>
    storedMatches.has(matchId)
      ? Promise.resolve(storedMatches.get(matchId))
      : riotFetch(REGION, `/lol/match/v5/matches/${matchId}`)
  );
}

async function seedChampionStats({ players, matches, tier }) {
  const storeBefore = await readStore();
  const beforeCount = storeBefore.matches.length;
  const entries = await getLeagueSeedEntries(tier);
  const seedEntries = entries
    .sort((a, b) => (b.leaguePoints || 0) - (a.leaguePoints || 0))
    .slice(0, players);

  const playerResults = [];
  for (const entry of seedEntries) {
    try {
      const puuid = await getEntryPuuid(entry);
      if (!puuid) {
        playerResults.push({
          leaguePoints: entry.leaguePoints || 0,
          status: "skipped",
          reason: "PUUID를 확인할 수 없습니다."
        });
        continue;
      }

      const matchIds = await riotFetch(
        REGION,
        `/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&start=0&count=${matches}`
      );
      const matchDetails = await getStoredOrFetchMatches(matchIds);
      await saveMatches(matchDetails);
      playerResults.push({
        puuid,
        leaguePoints: entry.leaguePoints || 0,
        status: "ok",
        matchIds: matchIds.length
      });
    } catch (error) {
      playerResults.push({
        leaguePoints: entry.leaguePoints || 0,
        status: "failed",
        error: error.riotMessage || error.message
      });
    }
  }

  await storeWriteQueue;
  const storeAfter = await readStore();
  return {
    ok: true,
    tier,
    playersRequested: players,
    playersProcessed: playerResults.length,
    matchesPerPlayer: matches,
    storedMatchesBefore: beforeCount,
    storedMatchesAfter: storeAfter.matches.length,
    newMatches: storeAfter.matches.length - beforeCount,
    updatedAt: storeAfter.updatedAt,
    players: playerResults
  };
}

async function getLeagueSeedEntries(tier) {
  const endpoints = {
    challenger: "/lol/league/v4/challengerleagues/by-queue/RANKED_SOLO_5x5",
    grandmaster: "/lol/league/v4/grandmasterleagues/by-queue/RANKED_SOLO_5x5",
    master: "/lol/league/v4/masterleagues/by-queue/RANKED_SOLO_5x5"
  };
  const payload = await riotFetch(PLATFORM, endpoints[tier] || endpoints.challenger);
  return payload.entries || [];
}

async function getEntryPuuid(entry) {
  if (entry.puuid) return entry.puuid;
  if (!entry.summonerId) return null;
  const summoner = await riotFetch(
    PLATFORM,
    `/lol/summoner/v4/summoners/${encodeURIComponent(entry.summonerId)}`
  );
  return summoner.puuid;
}

async function readStore() {
  if (storeCache) return storeCache;
  try {
    storeCache = JSON.parse(await readFile(storePath, "utf8"));
  } catch {
    storeCache = { matches: [], updatedAt: null };
  }
  return storeCache;
}

async function saveMatches(matches) {
  if (!matches?.length) return;
  storeWriteQueue = storeWriteQueue.then(async () => {
    const store = await readStore();
    const existing = new Set(store.matches.map((match) => match.metadata.matchId));
    const additions = matches.filter((match) => !existing.has(match.metadata.matchId));
    if (!additions.length) return;

    store.matches.push(...additions);
    store.updatedAt = new Date().toISOString();
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(storePath, JSON.stringify(store), "utf8");
  });
  return storeWriteQueue;
}

async function getChampionStats(position) {
  const store = await readStore();
  const version = await getDdragonVersion();
  const staticData = await getStaticData(version);
  const aggregates = new Map();
  let positionGames = 0;

  for (const match of store.matches) {
    if (match.info.queueId !== 420) continue;
    for (const participant of match.info.participants) {
      const participantPosition = normalizePosition(
        participant.teamPosition || participant.individualPosition
      );
      if (participantPosition !== position) continue;

      positionGames += 1;
      const key = String(participant.championId);
      const champion = staticData.champions[key] || {
        id: participant.championName,
        name: participant.championName
      };
      const current = aggregates.get(key) || {
        championId: participant.championId,
        championName: champion.name,
        championAssetId: champion.id,
        position,
        totalGames: 0,
        wins: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
        cs: 0,
        kdaTotal: 0
      };

      current.totalGames += 1;
      current.wins += participant.win ? 1 : 0;
      current.kills += participant.kills || 0;
      current.deaths += participant.deaths || 0;
      current.assists += participant.assists || 0;
      current.cs += (participant.totalMinionsKilled || 0) + (participant.neutralMinionsKilled || 0);
      current.kdaTotal +=
        ((participant.kills || 0) + (participant.assists || 0)) /
        Math.max(participant.deaths || 0, 1);
      aggregates.set(key, current);
    }
  }

  const rows = [...aggregates.values()].map((row) => ({
    championId: row.championId,
    championName: row.championName,
    championAssetId: row.championAssetId,
    position,
    totalGames: row.totalGames,
    wins: row.wins,
    losses: row.totalGames - row.wins,
    winRate: round((row.wins / row.totalGames) * 100, 2),
    pickRate: round((row.totalGames / Math.max(positionGames, 1)) * 100, 2),
    averageKDA: round(row.kdaTotal / row.totalGames, 2),
    averageKills: round(row.kills / row.totalGames, 2),
    averageDeaths: round(row.deaths / row.totalGames, 2),
    averageAssists: round(row.assists / row.totalGames, 2),
    averageCS: round(row.cs / row.totalGames, 1),
    lowSample: row.totalGames < 10
  }));

  const maxPickRate = Math.max(...rows.map((row) => row.pickRate), 1);
  for (const row of rows) {
    const normalizedWinRate = clamp(((row.winRate - 45) / 10) * 100, 0, 100);
    const normalizedPickRate = clamp((row.pickRate / maxPickRate) * 100, 0, 100);
    const normalizedKDA = clamp((row.averageKDA / 5) * 100, 0, 100);
    const sampleConfidence = clamp((row.totalGames / 100) * 100, 0, 100);
    row.tierScore = round(
      normalizedWinRate * 0.55 +
      normalizedPickRate * 0.25 +
      normalizedKDA * 0.10 +
      sampleConfidence * 0.10,
      1
    );
    row.tierGrade = "N/A";
  }

  const eligible = rows
    .filter((row) => !row.lowSample)
    .sort((a, b) => b.tierScore - a.tierScore);
  eligible.forEach((row, index) => {
    const percentile = (index + 1) / eligible.length;
    row.tierGrade = percentile <= 0.10
      ? "S"
      : percentile <= 0.30
        ? "A"
        : percentile <= 0.60
          ? "B"
          : percentile <= 0.85
            ? "C"
            : "D";
  });

  rows.sort((a, b) => {
    if (a.lowSample !== b.lowSample) return a.lowSample ? 1 : -1;
    return b.tierScore - a.tierScore;
  });

  return {
    position,
    patchVersion: version,
    updatedAt: store.updatedAt,
    collectedMatches: store.matches.length,
    positionSamples: positionGames,
    minimumSample: 10,
    champions: rows
  };
}

function normalizePosition(position) {
  const positions = {
    TOP: "TOP",
    JUNGLE: "JUNGLE",
    MIDDLE: "MID",
    MID: "MID",
    BOTTOM: "ADC",
    BOT: "ADC",
    ADC: "ADC",
    UTILITY: "SUPPORT",
    SUPPORT: "SUPPORT"
  };
  return positions[String(position || "").toUpperCase()] || null;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value, precision) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

async function riotFetch(route, path, attempt = 0) {
  const response = await scheduleRiotRequest(() =>
    fetch(`https://${route}.api.riotgames.com${path}`, {
      headers: { "X-Riot-Token": API_KEY }
    })
  );

  if (response.status === 429 && attempt < 3) {
    const retryAfter = Number(response.headers.get("retry-after") || 1);
    await delay(Math.max(1000, retryAfter * 1000));
    return riotFetch(route, path, attempt + 1);
  }

  if (!response.ok) {
    let riotMessage;
    try {
      const body = await response.json();
      riotMessage = body?.status?.message;
    } catch {
      riotMessage = undefined;
    }
    const error = new Error(`Riot API request failed (${response.status})`);
    error.status = response.status;
    error.endpoint = `${route}:${path.split("?")[0]}`;
    error.riotMessage = riotMessage;
    throw error;
  }

  return response.json();
}

function scheduleRiotRequest(task) {
  const run = riotRequestQueue.then(async () => {
    const result = await task();
    await delay(75);
    return result;
  });
  riotRequestQueue = run.catch(() => {});
  return run;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function getDdragonVersion() {
  if (Date.now() < ddragonCache.expiresAt) return ddragonCache.version;

  try {
    const response = await fetch("https://ddragon.leagueoflegends.com/api/versions.json");
    if (response.ok) {
      const versions = await response.json();
      ddragonCache = {
        version: versions[0],
        expiresAt: Date.now() + 6 * 60 * 60 * 1000
      };
    }
  } catch {
    // Keep the last known version when Data Dragon is temporarily unavailable.
  }

  return ddragonCache.version;
}

async function getStaticData(version) {
  if (staticDataCache.value && Date.now() < staticDataCache.expiresAt) {
    return staticDataCache.value;
  }

  const base = `https://ddragon.leagueoflegends.com/cdn/${version}/data/ko_KR`;
  const [championResponse, runeResponse] = await Promise.all([
    fetch(`${base}/champion.json`),
    fetch(`${base}/runesReforged.json`)
  ]);

  if (!championResponse.ok || !runeResponse.ok) {
    throw new Error("Data Dragon static data request failed");
  }

  const [championPayload, runePayload] = await Promise.all([
    championResponse.json(),
    runeResponse.json()
  ]);
  const champions = {};
  for (const champion of Object.values(championPayload.data)) {
    champions[champion.key] = {
      id: champion.id,
      name: champion.name
    };
  }

  const runes = {};
  const runeStyles = {};
  for (const style of runePayload) {
    runeStyles[style.id] = {
      name: style.name,
      icon: style.icon
    };
    for (const slot of style.slots) {
      for (const rune of slot.runes) {
        runes[rune.id] = {
          name: rune.name,
          icon: rune.icon
        };
      }
    }
  }

  staticDataCache = {
    value: { champions, runes, runeStyles },
    expiresAt: Date.now() + 6 * 60 * 60 * 1000
  };
  return staticDataCache.value;
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return results;
}

async function serveStatic(pathname, response) {
  const requestedPath = pathname === "/" ? "index.html" : pathname.slice(1);
  const safePath = normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(root, "public", safePath);

  if (!filePath.startsWith(join(root, "public"))) {
    return sendJson(response, 403, { error: "Forbidden" });
  }

  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    response.end(content);
  } catch {
    const index = await readFile(join(root, "public", "index.html"));
    response.writeHead(200, { "Content-Type": mimeTypes[".html"] });
    response.end(index);
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
}

async function loadEnv(path) {
  try {
    const content = await readFile(path, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator === -1) continue;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // .env is optional; health endpoint reports whether a key is configured.
  }
}
