import {
  getChampionStatsFromCache,
  getLastUpdatedAt,
  getMatchesByIds,
  getParticipantsForStats,
  getPersistenceWarning,
  getStoredMatchCount,
  saveMatches,
  upsertChampionStatsCache
} from "./match-store.mjs";
import { getSupabaseStatus, hasSupabaseConfig } from "./supabase-server.mjs";

const API_KEY = process.env.RIOT_API_KEY;
const TFT_API_KEY = process.env.TFT_API_KEY;
const PLATFORM = "kr";
const REGION = "asia";

let ddragonCache = { version: "16.9.1", expiresAt: 0 };
let staticDataCache = { value: null, expiresAt: 0 };
const tftStaticDataCache = new Map();
let riotRequestQueue = Promise.resolve();
const responseCache = new Map();
const tftResponseCache = new Map();

export async function handleApiRequest({ method, pathname, searchParams }) {
  try {
    if (pathname === "/api/health") {
      return ok({
        status: "ok",
        hasRiotApiKey: Boolean(API_KEY),
        hasTftApiKey: Boolean(TFT_API_KEY),
        ...getSupabaseStatus(),
        timestamp: new Date().toISOString()
      });
    }

    if (pathname === "/api/db-health") {
      return await handleDbHealth();
    }

    if (pathname === "/api/static") {
      const version = await getDdragonVersion();
      return ok({
        ddragonVersion: version,
        staticData: await getStaticData(version)
      });
    }

    if (pathname === "/api/champion-stats") {
      const position = normalizePosition(searchParams.get("position") || "TOP");
      if (!position) return fail(400, "지원하지 않는 라인입니다.");
      return ok(await getChampionStats(position));
    }

    if (pathname === "/api/recalculate-champion-stats" && method === "POST") {
      const positions = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];
      const results = [];

      for (const position of positions) {
        results.push(await getChampionStats(position, { force: true }));
      }

      return ok({
        ok: true,
        recalculatedAt: new Date().toISOString(),
        positions: results.map((result) => ({
          position: result.position,
          champions: result.champions.length
        }))
      });
    }

    if (pathname === "/api/seed-champion-stats" && method === "POST") {
      if (process.env.VERCEL && !hasSupabaseConfig()) {
        return fail(503, getPersistenceWarning());
      }

      if (!API_KEY) return fail(503, "RIOT_API_KEY가 설정되지 않았습니다.");

      const players = clamp(Number(searchParams.get("players") || 5), 1, 10);
      const matches = clamp(Number(searchParams.get("matches") || 10), 1, 15);
      const tier = String(searchParams.get("tier") || "challenger").toLowerCase();

      return ok(await seedChampionStats({ players, matches, tier }));
    }

    if (pathname === "/api/summoner") {
      if (!API_KEY) return fail(503, "RIOT_API_KEY가 설정되지 않았습니다.");

      const gameName = searchParams.get("gameName")?.trim();
      const tagLine = searchParams.get("tagLine")?.trim();

      if (!gameName || !tagLine) {
        return fail(400, "Riot ID를 게임이름#태그 형식으로 입력해 주세요.");
      }

      return ok(await getSummonerProfile(gameName, tagLine));
    }

    if (pathname === "/api/tft") {
      return await handleTftRequest(searchParams);
    }

    return fail(404, "API 경로를 찾을 수 없습니다.");
  } catch (error) {
    const status = error.status || 500;
    const safeDebug = createSafeDebug(error);

    const message = error.code === "SUPABASE_CONFIG_MISSING"
      ? "Supabase 환경변수가 설정되지 않아 배포 환경에서 데이터를 수집해 저장할 수 없습니다. Vercel Environment Variables에 SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY를 추가해 주세요."
      : error.code === "SUPABASE_ERROR"
        ? "매치 데이터 저장 중 문제가 발생했습니다."
        : status === 404
          ? "플레이어를 찾을 수 없습니다. Riot ID와 태그를 확인해 주세요."
          : status === 403 && String(error.endpoint || "").includes(":/tft/")
            ? "Riot API 키에 TFT API 접근 권한이 없거나 키가 만료되었습니다."
          : status === 401 || status === 403
            ? "API 키가 만료되었거나 유효하지 않습니다. 새 개발 키로 교체해 주세요."
            : status === 429
              ? "Riot API 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요."
              : error.message || "서버에서 요청을 처리하지 못했습니다.";

    console.error("[handleApiRequest] failed", safeDebug);

    return {
      status,
      body: {
        error: message,
        endpoint: error.endpoint,
        riotMessage: error.riotMessage,
        debug: safeDebug
      }
    };
  }
}

function ok(body) {
  return { status: 200, body };
}

function fail(status, error) {
  return { status, body: { error } };
}

async function handleDbHealth() {
  try {
    const supabaseStatus = getSupabaseStatus();

    if (!hasSupabaseConfig()) {
      return {
        status: 503,
        body: {
          ok: false,
          ...supabaseStatus,
          error: "Supabase 환경변수가 설정되지 않았습니다."
        }
      };
    }

    const storedMatchCount = await getStoredMatchCount();
    const participants = await getParticipantsForStats();

    return ok({
      ok: true,
      ...supabaseStatus,
      checks: {
        storedMatchCount,
        participantsReadable: Array.isArray(participants),
        participantSampleCount: Array.isArray(participants) ? participants.length : 0
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return {
      status: error.status || 500,
      body: {
        ok: false,
        ...getSupabaseStatus(),
        error: "Supabase DB 상태 확인 중 문제가 발생했습니다.",
        debug: createSafeDebug(error)
      }
    };
  }
}

async function getSummonerProfile(gameName, tagLine) {
  const cacheKey = `${gameName.toLowerCase()}#${tagLine.toLowerCase()}`;
  const cached = responseCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const account = await riotFetch(
    REGION,
    `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
  );

  const [summoner, matchIds, version] = await Promise.all([
    riotFetch(PLATFORM, `/lol/summoner/v4/summoners/by-puuid/${account.puuid}`),
    riotFetch(REGION, `/lol/match/v5/matches/by-puuid/${account.puuid}/ids?start=0&count=15`),
    getDdragonVersion()
  ]);

  const [ranked, masteries, matches, staticData] = await Promise.all([
    riotFetch(PLATFORM, `/lol/league/v4/entries/by-puuid/${account.puuid}`),
    riotFetch(PLATFORM, `/lol/champion-mastery/v4/champion-masteries/by-puuid/${account.puuid}/top?count=5`),
    getStoredOrFetchMatches(matchIds),
    getStaticData(version)
  ]);

  const persistence = await saveMatches(matches);

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
    updatedAt: new Date().toISOString(),
    persistenceWarning: persistence.warning || getPersistenceWarning()
  };

  responseCache.set(cacheKey, {
    value: payload,
    expiresAt: Date.now() + 2 * 60 * 1000
  });

  return payload;
}

async function handleTftRequest(searchParams) {
  if (!TFT_API_KEY) {
    return {
      status: 503,
      body: {
        error: "TFT API Key가 설정되어 있지 않습니다.",
        debug: {
          hasTftApiKey: false
        }
      }
    };
  }

  const gameName = searchParams.get("gameName")?.trim();
  const tagLine = searchParams.get("tagLine")?.trim();
  const receivedPuuid = searchParams.get("puuid")?.trim() || null;

  if (!gameName || !tagLine) {
    return fail(400, "계정 정보를 찾을 수 없습니다.");
  }

  try {
    const account = await tftRiotFetch(
      "tft-account",
      "asia.api.riotgames.com",
      `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
    );
    return ok(await getTftProfile({
      gameName,
      tagLine,
      receivedPuuid,
      resolvedAccountPuuid: account.puuid
    }));
  } catch (error) {
    const debug = {
      step: error.tftStep || "unknown",
      receivedPuuid,
      resolvedAccountPuuid: error.resolvedAccountPuuid || null,
      gameName,
      tagLine,
      status: error.status || 500,
      url: error.tftUrl || null,
      riotMessage: error.riotMessage || error.message || "Unknown TFT API error"
    };
    console.error("[handleTftRequest] failed", debug);
    const decryptFailure = error.tftStep === "tft-match-ids" &&
      error.status === 400 &&
      /decrypt/i.test(String(error.riotMessage || ""));
    return {
      status: error.status || 500,
      body: {
        error: decryptFailure
          ? "이 Riot ID의 TFT 전적을 조회할 수 없습니다. Riot ID 또는 태그를 다시 확인해주세요."
          : "롤토체스 최근 전적을 불러오는 중 문제가 발생했습니다.",
        debug
      }
    };
  }
}

async function getTftProfile({
  gameName,
  tagLine,
  receivedPuuid,
  resolvedAccountPuuid
}) {
  const cacheKey = `${gameName.toLowerCase()}#${tagLine.toLowerCase()}`;
  const cached = tftResponseCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  let matchIds;
  try {
    matchIds = await tftRiotFetch(
      "tft-match-ids",
      "asia.api.riotgames.com",
      `/tft/match/v1/matches/by-puuid/${encodeURIComponent(resolvedAccountPuuid)}/ids?count=10`
    );
  } catch (error) {
    error.resolvedAccountPuuid = resolvedAccountPuuid;
    throw error;
  }
  const rawMatches = await mapLimit(matchIds, 2, (matchId) =>
    tftRiotFetch(
      "tft-match-detail",
      "asia.api.riotgames.com",
      `/tft/match/v1/matches/${encodeURIComponent(matchId)}`
    )
  );
  const tftStaticData = await getTftStaticData(rawMatches);

  const summonerResult = await tftOptionalFetch(
    "tft-summoner",
    "kr.api.riotgames.com",
    `/tft/summoner/v1/summoners/by-puuid/${encodeURIComponent(resolvedAccountPuuid)}`
  );
  const tftSummoner = summonerResult.data;
  const summonerId = tftSummoner?.id;
  const leagueResult = summonerResult.data
    ? await tftOptionalFetch(
      "tft-league",
      "kr.api.riotgames.com",
      summonerId
        ? `/tft/league/v1/entries/by-summoner/${encodeURIComponent(summonerId)}`
        : `/tft/league/v1/by-puuid/${encodeURIComponent(resolvedAccountPuuid)}`
    )
    : { data: null, status: null, debug: summonerResult.debug };
  const rankEntries = Array.isArray(leagueResult.data)
    ? leagueResult.data
    : leagueResult.data ? [leagueResult.data] : [];
  const tftMatches = rawMatches
    .map((match) => compactTftMatch(match, resolvedAccountPuuid, tftStaticData))
    .filter(Boolean);
  const tftRank = selectTftRank(rankEntries);
  const rankRequestFailed = Boolean(summonerResult.debug || leagueResult.debug);
  const rankDebug = {
    tftSummonerStatus: summonerResult.status,
    tftSummonerIdExists: Boolean(summonerId),
    tftLeagueStatus: leagueResult.status,
    tftLeagueLookup: summonerId ? "by-summoner-id" : "by-puuid",
    tftLeagueEntriesCount: rankEntries.length,
    tftLeagueQueueTypes: rankEntries.map((entry) => entry.queueType).filter(Boolean),
    selectedTftRank: tftRank,
    ...(summonerResult.debug || leagueResult.debug
      ? {
        rankError: {
          ...(summonerResult.debug || leagueResult.debug),
          tftSummonerIdExists: Boolean(summonerId)
        }
      }
      : {})
  };
  const payload = {
    tftSummoner: tftSummoner
      ? {
        id: summonerId,
        level: tftSummoner.summonerLevel,
        profileIconId: tftSummoner.profileIconId
      }
      : null,
    tftRank,
    tftRankError: tftRank
      ? null
      : rankRequestFailed
        ? "롤토체스 랭크를 불러오지 못했습니다."
        : "롤토체스 랭크 정보 없음",
    tftMatches,
    tftSummary: summarizeTftMatches(tftMatches),
    tftStaticData: compactTftStaticData(tftStaticData, tftMatches),
    account: {
      gameName,
      tagLine,
      puuid: resolvedAccountPuuid
    },
    debug: {
      step: "complete",
      receivedPuuid,
      resolvedAccountPuuid,
      gameName,
      tagLine,
      ...rankDebug
    },
    updatedAt: new Date().toISOString()
  };

  tftResponseCache.set(cacheKey, {
    value: payload,
    expiresAt: Date.now() + 2 * 60 * 1000
  });
  return payload;
}

async function tftRiotFetch(step, host, path, attempt = 0) {
  const url = `https://${host}${path}`;
  let response;

  try {
    response = await scheduleRiotRequest(() =>
      fetch(url, {
        headers: {
          "X-Riot-Token": TFT_API_KEY
        }
      })
    );
  } catch (cause) {
    const error = new Error("TFT API network request failed");
    error.status = 502;
    error.tftStep = step;
    error.tftUrl = url;
    error.riotMessage = cause?.message;
    throw error;
  }

  if (response.status === 429 && attempt < 3) {
    const retryAfter = Number(response.headers.get("retry-after") || 1);
    await delay(Math.max(1000, retryAfter * 1000));
    return tftRiotFetch(step, host, path, attempt + 1);
  }

  if (!response.ok) {
    let riotBody;
    try {
      riotBody = await response.json();
    } catch {
      riotBody = await response.text().catch(() => "");
    }

    const error = new Error(`TFT API request failed (${response.status})`);
    error.status = response.status;
    error.tftStep = step;
    error.tftUrl = url;
    error.riotMessage = riotBody?.status?.message || riotBody || response.statusText;
    throw error;
  }

  return response.json();
}

async function tftOptionalFetch(step, host, path) {
  try {
    return {
      data: await tftRiotFetch(step, host, path),
      status: 200,
      debug: null
    };
  } catch (error) {
    const debug = {
      step: error.tftStep || step,
      status: error.status || 500,
      url: error.tftUrl || `https://${host}${path}`,
      riotMessage: error.riotMessage || error.message || "Unknown TFT API error"
    };
    console.warn(`[${step}] optional TFT request failed`, debug);
    return { data: null, status: debug.status, debug };
  }
}

function selectTftRank(entries) {
  const ranks = Array.isArray(entries) ? entries : entries ? [entries] : [];
  const ranked = ranks.find((entry) => entry.queueType === "RANKED_TFT");

  if (!ranked) return null;

  const wins = Number(ranked.wins || 0);
  const losses = Number(ranked.losses || 0);
  const total = wins + losses;
  return {
    queueType: ranked.queueType,
    tier: ranked.tier,
    rank: ranked.rank,
    leaguePoints: Number(ranked.leaguePoints || 0),
    wins,
    losses,
    winRate: total ? Math.round((wins / total) * 100) : 0
  };
}

function compactTftMatch(match, puuid, staticData) {
  const participant = match?.info?.participants?.find((entry) => entry.puuid === puuid);
  if (!participant) return null;
  const participants = (match?.info?.participants || [])
    .map((entry) => compactTftParticipant(entry, staticData, entry.puuid === puuid))
    .sort((a, b) => a.placement - b.placement);

  return {
    matchId: match.metadata?.match_id || match.metadata?.matchId,
    gameDatetime: Number(match.info?.game_datetime || 0),
    gameLength: Number(match.info?.game_length || 0),
    queueId: Number(match.info?.queue_id || 0),
    gameType: match.info?.tft_game_type || "",
    gameVersion: match.info?.game_version || "",
    setNumber: match.info?.tft_set_number,
    placement: Number(participant.placement || 0),
    level: Number(participant.level || 0),
    lastRound: Number(participant.last_round || 0),
    timeEliminated: Number(participant.time_eliminated || 0),
    companion: compactTftCompanion(participant.companion, staticData),
    participants,
    traits: compactTftTraits(participant.traits, staticData).slice(0, 6),
    units: compactTftUnits(participant.units, staticData),
    augments: (participant.augments || []).map((augmentId) => ({
      id: augmentId,
      name: getTftStaticName(staticData.augments, augmentId)
    }))
  };
}

function compactTftParticipant(participant, staticData, isCurrentPlayer = false) {
  return {
    puuid: participant.puuid,
    name: tftParticipantName(participant),
    placement: Number(participant.placement || 0),
    level: Number(participant.level || 0),
    lastRound: Number(participant.last_round || 0),
    timeEliminated: Number(participant.time_eliminated || 0),
    goldLeft: Number(participant.gold_left || 0),
    playersEliminated: Number(participant.players_eliminated || 0),
    totalDamageToPlayers: Number(participant.total_damage_to_players || 0),
    companion: compactTftCompanion(participant.companion, staticData),
    traits: compactTftTraits(participant.traits, staticData).slice(0, 8),
    units: compactTftUnits(participant.units, staticData),
    isCurrentPlayer
  };
}

function compactTftTraits(traits, staticData) {
  return (traits || [])
    .filter((trait) => Number(trait.num_units || 0) > 0)
    .sort((a, b) =>
      Number(b.style || 0) - Number(a.style || 0) ||
      Number(b.num_units || 0) - Number(a.num_units || 0)
    )
    .map((trait) => ({
      id: trait.name,
      name: getTftStaticName(staticData.traits, trait.name),
      units: Number(trait.num_units || 0),
      style: Number(trait.style || 0),
      tier: Number(trait.tier_current || 0)
    }));
}

function compactTftUnits(units, staticData) {
  return (units || [])
    .sort((a, b) => Number(b.tier || 0) - Number(a.tier || 0))
    .map((unit) => {
      const summon = getTftSummonInfo(unit.character_id);
      return {
        id: unit.character_id,
        name: summon?.name || getTftStaticName(staticData.units, unit.character_id),
        tier: Number(unit.tier || 1),
        rarity: Number(unit.rarity || 0),
        isSummon: Boolean(summon),
        summonTrait: summon?.trait || "",
        items: (unit.itemNames || []).map((itemId) => ({
          id: itemId,
          name: getTftStaticName(staticData.items, itemId)
        }))
      };
    });
}

function compactTftCompanion(companion, staticData) {
  if (!companion) return null;
  const ids = [
    companion.content_ID,
    companion.contentId,
    companion.item_ID,
    companion.itemId,
    companion.skin_ID,
    companion.skinId,
    companion.species
  ].filter((value) => value !== undefined && value !== null && value !== "");
  const asset = ids
    .map((id) => getTftStaticEntry(staticData.companions, id))
    .find((entry) => entry.imageUrl) ||
    ids
      .map((id) => getTftStaticEntry(staticData.companions, id))
      .find((entry) => entry.name);

  return {
    id: ids[0] || "",
    itemId: companion.item_ID ?? companion.itemId ?? null,
    skinId: companion.skin_ID ?? companion.skinId ?? null,
    species: companion.species || "",
    name: asset?.name || cleanTftName(ids[0] || companion.species || "TFT"),
    imageUrl: asset?.imageUrl || tftCompanionFallbackImage(companion)
  };
}

function tftCompanionFallbackImage(companion) {
  const itemId = companion?.item_ID ?? companion?.itemId;
  const skinId = companion?.skin_ID ?? companion?.skinId;
  if (itemId === undefined || itemId === null || skinId === undefined || skinId === null) return null;
  return `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/companions/${itemId}/${skinId}.png`;
}

function tftParticipantName(participant) {
  const gameName = participant.riotIdGameName || participant.gameName;
  const tagLine = participant.riotIdTagline || participant.riotIdTagLine || participant.tagLine;
  if (gameName && tagLine) return `${gameName}#${tagLine}`;
  return gameName || participant.summonerName || "Unknown";
}

function getTftSummonInfo(id) {
  const value = String(id || "");
  if (!/summon/i.test(value)) return null;
  const normalized = value.toLowerCase();
  if (/vayne|vaynechampion|vaien|vien|byen|바이엔/i.test(normalized)) {
    return { name: "바이엔", trait: "길잡이 소환수" };
  }
  if (/vi|via|bia|비아/i.test(normalized)) {
    return { name: "비아", trait: "길잡이 소환수" };
  }
  const fallbackName = value
    .replace(/^TFT\d+_/, "")
    .replace(/^TFT_/, "")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^Summon\s*/i, "")
    .trim();
  return { name: fallbackName || "소환수", trait: "소환 유닛" };
}

function summarizeTftMatches(matches) {
  const count = matches.length;
  const traitCounts = new Map();
  const unitCounts = new Map();

  for (const match of matches) {
    for (const trait of match.traits) {
      traitCounts.set(trait.name, (traitCounts.get(trait.name) || 0) + 1);
    }
    for (const unit of match.units) {
      unitCounts.set(unit.name, (unitCounts.get(unit.name) || 0) + 1);
    }
  }

  const topFourRate = count
    ? Math.round((matches.filter((match) => match.placement <= 4).length / count) * 100)
    : 0;
  const firstPlaces = matches.filter((match) => match.placement === 1).length;

  return {
    games: count,
    averagePlacement: count
      ? round(matches.reduce((total, match) => total + match.placement, 0) / count, 1)
      : 0,
    topFourRate,
    top4Rate: topFourRate,
    firstPlaces,
    firstPlaceCount: firstPlaces,
    averageLevel: count
      ? round(matches.reduce((total, match) => total + match.level, 0) / count, 1)
      : 0,
    mostTrait: mostFrequentTftName(traitCounts),
    mostUnit: mostFrequentTftName(unitCounts)
  };
}

function mostFrequentTftName(counts) {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "-";
}

function cleanTftName(value) {
  const summon = getTftSummonInfo(value);
  if (summon) return summon.name;
  return String(value || "")
    .replace(/^TFT\d+_Augment_/, "")
    .replace(/^TFT\d+_/, "")
    .replace(/^TFT_/, "")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim() || "-";
}

async function getTftStaticData(matches) {
  const latestVersion = await getDdragonVersion();
  const versions = new Set([latestVersion]);

  for (const match of matches) {
    const version = tftDdragonVersion(match?.info?.game_version);
    if (version) versions.add(version);
  }

  const payloads = await Promise.all(
    [...versions].map((version) => getTftStaticDataVersion(version))
  );
  return payloads.reduce(mergeTftStaticData, emptyTftStaticData());
}

async function getTftStaticDataVersion(version) {
  const cached = tftStaticDataCache.get(version);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const base = `https://ddragon.leagueoflegends.com/cdn/${version}/data/ko_KR`;
  const files = {
    units: "tft-champion.json",
    traits: "tft-trait.json",
    augments: "tft-augments.json",
    items: "tft-item.json",
    companions: "tft-tactician.json"
  };
  const entries = await Promise.all(
    Object.entries(files).map(async ([type, filename]) => {
      try {
        const response = await fetch(`${base}/${filename}`);
        if (!response.ok) return [type, {}];
        const payload = await response.json();
        return [type, createTftAssetMap(payload.data, version)];
      } catch {
        return [type, {}];
      }
    })
  );
  const value = Object.fromEntries(entries);

  tftStaticDataCache.set(version, {
    value,
    expiresAt: Date.now() + 6 * 60 * 60 * 1000
  });
  return value;
}

function createTftAssetMap(data, version) {
  const assets = {};
  for (const [key, entry] of Object.entries(data || {})) {
    const id = entry?.id || key;
    const name = entry?.name;
    if (!name) continue;
    const image = entry?.image;
    const asset = {
      name,
      imageUrl: image?.group && image?.full
        ? `https://ddragon.leagueoflegends.com/cdn/${version}/img/${image.group}/${image.full}`
        : null
    };
    assets[key] = asset;
    assets[id] = asset;
    if (entry?.contentId) assets[entry.contentId] = asset;
    if (entry?.content_ID) assets[entry.content_ID] = asset;
    if (entry?.itemId) assets[String(entry.itemId)] = asset;
    if (entry?.item_id) assets[String(entry.item_id)] = asset;
  }
  return assets;
}

function tftDdragonVersion(gameVersion) {
  const match = String(gameVersion || "").match(/(\d+)\.(\d+)/);
  return match ? `${match[1]}.${match[2]}.1` : null;
}

function emptyTftStaticData() {
  return { units: {}, traits: {}, augments: {}, items: {}, companions: {} };
}

function mergeTftStaticData(target, source) {
  for (const type of Object.keys(target)) {
    Object.assign(target[type], source[type] || {});
  }
  return target;
}

function getTftStaticEntry(assets, id) {
  return assets?.[id] || {
    name: cleanTftName(id),
    imageUrl: null
  };
}

function getTftStaticName(assets, id) {
  return getTftStaticEntry(assets, id).name;
}

function compactTftStaticData(staticData, matches) {
  const ids = {
    units: new Set(),
    traits: new Set(),
    augments: new Set(),
    items: new Set(),
    companions: new Set()
  };

  for (const match of matches) {
    for (const trait of match.traits) ids.traits.add(trait.id);
    for (const unit of match.units) {
      ids.units.add(unit.id);
      for (const item of unit.items) ids.items.add(item.id);
    }
    for (const augment of match.augments) ids.augments.add(augment.id);
    if (match.companion?.id) ids.companions.add(match.companion.id);
    if (match.companion?.itemId !== null && match.companion?.itemId !== undefined) ids.companions.add(match.companion.itemId);
    for (const participant of match.participants || []) {
      if (participant.companion?.id) ids.companions.add(participant.companion.id);
      if (participant.companion?.itemId !== null && participant.companion?.itemId !== undefined) ids.companions.add(participant.companion.itemId);
      for (const trait of participant.traits || []) ids.traits.add(trait.id);
      for (const unit of participant.units || []) {
        ids.units.add(unit.id);
        for (const item of unit.items || []) ids.items.add(item.id);
      }
    }
  }

  return Object.fromEntries(
    Object.entries(ids).map(([type, values]) => [
      type,
      Object.fromEntries(
        [...values].map((id) => [
          String(id).toLowerCase(),
          getTftStaticEntry(staticData[type], id)
        ])
      )
    ])
  );
}

function compactMatch(match) {
  return {
    metadata: {
      matchId: match.metadata.matchId
    },
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
        riotIdTagline: participant.riotIdTagline || participant.riotIdTagLine,
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
      if (participant.championId) {
        championIds.add(String(participant.championId));
      }

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
      [...championIds]
        .filter((id) => staticData.champions[id])
        .map((id) => [id, staticData.champions[id]])
    ),
    runes: Object.fromEntries(
      [...runeIds]
        .filter((id) => staticData.runes[id])
        .map((id) => [id, staticData.runes[id]])
    ),
    runeStyles: Object.fromEntries(
      [...styleIds]
        .filter((id) => staticData.runeStyles[id])
        .map((id) => [id, staticData.runeStyles[id]])
    )
  };
}

async function getStoredOrFetchMatches(matchIds) {
  const storedMatches = await getMatchesByIds(matchIds);

  return mapLimit(matchIds, 2, (matchId) =>
    storedMatches.has(matchId)
      ? Promise.resolve(storedMatches.get(matchId))
      : riotFetch(REGION, `/lol/match/v5/matches/${matchId}`)
  );
}

async function seedChampionStats({ players, matches, tier }) {
  const beforeCount = await getStoredMatchCount();
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
          status: "skipped"
        });
        continue;
      }

      const matchIds = await riotFetch(
        REGION,
        `/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&start=0&count=${matches}`
      );

      await saveMatches(await getStoredOrFetchMatches(matchIds));

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

  const afterCount = await getStoredMatchCount();

  return {
    ok: true,
    tier,
    playersRequested: players,
    playersProcessed: playerResults.length,
    matchesPerPlayer: matches,
    storedMatchesBefore: beforeCount,
    storedMatchesAfter: afterCount,
    newMatches: afterCount - beforeCount,
    updatedAt: await getLastUpdatedAt(),
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

async function getChampionStats(position, { force = false } = {}) {
  const version = await getDdragonVersion();
  const cachedRows = force ? [] : await getChampionStatsFromCache(position, version);
  const lastMatchUpdatedAt = await getLastUpdatedAt();

  const cacheIsCurrent = cachedRows.length
    && (!lastMatchUpdatedAt || new Date(cachedRows[0].calculated_at).getTime() >= new Date(lastMatchUpdatedAt).getTime());

  if (cacheIsCurrent) {
    const staticData = await getStaticDataForStats(version);

    return buildChampionStatsResponse({
      position,
      version,
      rows: cachedRows.map((row) => cacheRowToApiRow(row, staticData)),
      positionGames: cachedRows.reduce((sum, row) => sum + Number(row.total_games || 0), 0),
      collectedMatches: await getStoredMatchCount(),
      updatedAt: cachedRows[0].calculated_at
    });
  }

  const participants = await getParticipantsForStats();

  if (!participants.length) {
    return buildChampionStatsResponse({
      position,
      version,
      rows: [],
      positionGames: 0,
      collectedMatches: await getStoredMatchCount(),
      updatedAt: lastMatchUpdatedAt
    });
  }

  const staticData = await getStaticDataForStats(version);
  const aggregates = new Map();
  let positionGames = 0;

  for (const participant of participants) {
    const participantPosition = normalizePosition(
      field(participant, "teamPosition", "team_position")
      || field(participant, "individualPosition", "individual_position")
    );

    if (participantPosition !== position) continue;

    positionGames += 1;

    const championId = Number(field(participant, "championId", "champion_id"));
    const key = String(championId);
    const participantChampionName = field(participant, "championName", "champion_name");
    const champion = staticData.champions[key] || {
      id: participantChampionName,
      name: participantChampionName
    };

    const current = aggregates.get(key) || {
      championId,
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

    const kills = Number(field(participant, "kills", "kills") || 0);
    const deaths = Number(field(participant, "deaths", "deaths") || 0);
    const assists = Number(field(participant, "assists", "assists") || 0);

    current.totalGames += 1;
    current.wins += participant.win ? 1 : 0;
    current.kills += kills;
    current.deaths += deaths;
    current.assists += assists;
    current.cs += Number(field(participant, "totalMinionsKilled", "total_minions_killed") || 0)
      + Number(field(participant, "neutralMinionsKilled", "neutral_minions_killed") || 0);
    current.kdaTotal += (kills + assists) / Math.max(deaths, 1);

    aggregates.set(key, current);
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
      normalizedWinRate * 0.55
        + normalizedPickRate * 0.25
        + normalizedKDA * 0.10
        + sampleConfidence * 0.10,
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

  rows.sort((a, b) => (
    a.lowSample !== b.lowSample
      ? (a.lowSample ? 1 : -1)
      : b.tierScore - a.tierScore
  ));

  const calculatedAt = new Date().toISOString();

  await upsertChampionStatsCache(rows.map((row) => ({
    position,
    champion_id: row.championId,
    champion_name: row.championName,
    total_games: row.totalGames,
    wins: row.wins,
    losses: row.losses,
    win_rate: row.winRate,
    pick_rate: row.pickRate,
    avg_kda: row.averageKDA,
    avg_cs: row.averageCS,
    tier_score: row.tierScore,
    tier_grade: row.tierGrade,
    low_sample: row.lowSample,
    patch_version: version,
    calculated_at: calculatedAt
  })));

  return buildChampionStatsResponse({
    position,
    version,
    rows,
    positionGames,
    collectedMatches: await getStoredMatchCount(),
    updatedAt: calculatedAt
  });
}

function buildChampionStatsResponse({ position, version, rows, positionGames, collectedMatches, updatedAt }) {
  return {
    position,
    patchVersion: version,
    updatedAt,
    collectedMatches,
    positionSamples: positionGames,
    minimumSample: 10,
    champions: rows
  };
}

function cacheRowToApiRow(row, staticData) {
  const champion = staticData.champions[String(row.champion_id)] || {
    id: row.champion_name,
    name: row.champion_name
  };

  return {
    championId: row.champion_id,
    championName: row.champion_name,
    championAssetId: champion.id,
    position: row.position,
    totalGames: Number(row.total_games),
    wins: Number(row.wins),
    losses: Number(row.losses),
    winRate: Number(row.win_rate),
    pickRate: Number(row.pick_rate),
    averageKDA: Number(row.avg_kda),
    averageKills: 0,
    averageDeaths: 0,
    averageAssists: 0,
    averageCS: Number(row.avg_cs),
    tierScore: Number(row.tier_score),
    tierGrade: row.tier_grade,
    lowSample: Boolean(row.low_sample)
  };
}

function field(object, camelName, snakeName) {
  return object?.[camelName] ?? object?.[snakeName];
}

async function getStaticDataForStats(version) {
  try {
    return await getStaticData(version);
  } catch {
    return { champions: {} };
  }
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
      riotMessage = (await response.json())?.status?.message;
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

async function riotFetchOptional(route, path, ignoredStatuses = [404]) {
  try {
    return await riotFetch(route, path);
  } catch (error) {
    if (ignoredStatuses.includes(error.status)) return null;
    throw error;
  }
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

function createSafeDebug(error) {
  const debug = {
    name: error?.name,
    code: error?.code,
    status: error?.status,
    message: error?.message,
    endpoint: error?.endpoint,
    riotMessage: error?.riotMessage,
    details: error?.details,
    hint: error?.hint
  };

  if (error?.supabase) {
    debug.supabase = sanitizeObject(error.supabase);
  }

  if (error?.cause) {
    debug.cause = sanitizeObject(error.cause);
  }

  for (const key of Object.keys(error || {})) {
    if ([
      "name",
      "code",
      "status",
      "message",
      "endpoint",
      "riotMessage",
      "details",
      "hint",
      "supabase",
      "cause"
    ].includes(key)) {
      continue;
    }

    debug[key] = sanitizeObject(error[key]);
  }

  return removeEmpty(debug);
}

function sanitizeObject(value) {
  if (value == null) return value;

  if (typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeObject);
  }

  const blockedKeys = new Set([
    "apikey",
    "apiKey",
    "token",
    "access_token",
    "refresh_token",
    "authorization",
    "Authorization",
    "x-riot-token",
    "X-Riot-Token",
    "SUPABASE_SERVICE_ROLE_KEY",
    "RIOT_API_KEY",
    "TFT_API_KEY"
  ]);

  const result = {};

  for (const [key, item] of Object.entries(value)) {
    if (blockedKeys.has(key)) {
      result[key] = "[redacted]";
      continue;
    }

    result[key] = sanitizeObject(item);
  }

  return removeEmpty(result);
}

function removeEmpty(object) {
  if (!object || typeof object !== "object" || Array.isArray(object)) {
    return object;
  }

  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined)
  );
}
