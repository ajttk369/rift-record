import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getSupabaseClient, hasSupabaseConfig } from "./supabase-server.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const localStorePath = join(root, "data", "matches.json");
const persistenceWarning =
  "Supabase 환경변수가 설정되지 않아 배포 환경에서 데이터를 수집해 저장할 수 없습니다. Vercel Environment Variables에 SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY를 추가해 주세요.";

let localStoreCache;
let localWriteQueue = Promise.resolve();

export function getPersistenceWarning() {
  return !hasSupabaseConfig() && process.env.VERCEL ? persistenceWarning : null;
}

export async function getMatchesByIds(matchIds) {
  if (!matchIds?.length) return new Map();
  if (!hasSupabaseConfig()) {
    const store = await readLocalStore();
    const wanted = new Set(matchIds);
    return new Map(
      store.matches
        .filter((match) => wanted.has(match.metadata?.matchId))
        .map((match) => [match.metadata.matchId, match])
    );
  }

  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from("matches")
    .select("match_id, raw_json")
    .in("match_id", matchIds);
  if (error) throw databaseError(error);
  return new Map((data || []).filter((row) => row.raw_json).map((row) => [row.match_id, row.raw_json]));
}

export async function saveMatches(matches) {
  if (!matches?.length) return { persisted: true, inserted: 0 };
  if (!hasSupabaseConfig()) {
    if (process.env.VERCEL) return { persisted: false, inserted: 0, warning: persistenceWarning };
    return saveLocalMatches(matches);
  }

  const supabase = await getSupabaseClient();
  const matchIds = matches.map((match) => match.metadata.matchId);
  const existing = await getMatchesByIds(matchIds);
  const additions = matches.filter((match) => !existing.has(match.metadata.matchId));
  if (!additions.length) return { persisted: true, inserted: 0 };

  const matchRows = additions.map((match) => ({
    match_id: match.metadata.matchId,
    game_creation: match.info.gameCreation || match.info.gameStartTimestamp || null,
    game_duration: match.info.gameDuration || null,
    game_version: match.info.gameVersion || null,
    queue_id: match.info.queueId || null,
    platform_id: match.info.platformId || null,
    raw_json: match
  }));
  const { error: matchError } = await supabase
    .from("matches")
    .upsert(matchRows, { onConflict: "match_id", ignoreDuplicates: true });
  if (matchError) throw databaseError(matchError);

  const participantRows = additions.flatMap((match) =>
    (match.info.participants || []).map((participant) => ({
      match_id: match.metadata.matchId,
      puuid: participant.puuid || null,
      summoner_name: participant.summonerName || null,
      riot_id_game_name: participant.riotIdGameName || null,
      riot_id_tagline: participant.riotIdTagline || null,
      champion_id: participant.championId || null,
      champion_name: participant.championName || null,
      team_position: participant.teamPosition || null,
      individual_position: participant.individualPosition || null,
      lane: participant.lane || null,
      role: participant.role || null,
      win: Boolean(participant.win),
      kills: participant.kills || 0,
      deaths: participant.deaths || 0,
      assists: participant.assists || 0,
      total_minions_killed: participant.totalMinionsKilled || 0,
      neutral_minions_killed: participant.neutralMinionsKilled || 0,
      gold_earned: participant.goldEarned || 0,
      total_damage_dealt_to_champions: participant.totalDamageDealtToChampions || 0,
      vision_score: participant.visionScore || 0,
      item0: participant.item0 || 0,
      item1: participant.item1 || 0,
      item2: participant.item2 || 0,
      item3: participant.item3 || 0,
      item4: participant.item4 || 0,
      item5: participant.item5 || 0,
      item6: participant.item6 || 0,
      game_duration: match.info.gameDuration || 0
    }))
  );
  const { error: participantError } = await supabase
    .from("participants")
    .upsert(participantRows, { onConflict: "match_id,puuid", ignoreDuplicates: true });
  if (participantError) throw databaseError(participantError);

  return { persisted: true, inserted: additions.length };
}

export async function getParticipantsForStats() {
  if (!hasSupabaseConfig()) {
    const store = await readLocalStore();
    return store.matches.flatMap((match) =>
      match.info.queueId === 420
        ? (match.info.participants || []).map((participant) => ({
            ...participant,
            match_id: match.metadata.matchId,
            game_duration: match.info.gameDuration
          }))
        : []
    );
  }

  const supabase = await getSupabaseClient();
  const rows = [];
  const pageSize = 1000;
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await supabase
      .from("participants")
      .select("*")
      .range(start, start + pageSize - 1);
    if (error) throw databaseError(error);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

export async function getChampionStatsFromCache(position, patchVersion) {
  if (!hasSupabaseConfig()) return [];
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from("champion_stats_cache")
    .select("*")
    .eq("position", position)
    .eq("patch_version", patchVersion)
    .order("tier_score", { ascending: false });
  if (error) throw databaseError(error);
  return data || [];
}

export async function upsertChampionStatsCache(rows) {
  if (!hasSupabaseConfig() || !rows.length) return;
  const supabase = await getSupabaseClient();
  const { error } = await supabase
    .from("champion_stats_cache")
    .upsert(rows, { onConflict: "position,champion_id,patch_version" });
  if (error) throw databaseError(error);
}

export async function getStoredMatchCount() {
  if (!hasSupabaseConfig()) return (await readLocalStore()).matches.length;
  const supabase = await getSupabaseClient();
  const { count, error } = await supabase.from("matches").select("*", { count: "exact", head: true });
  if (error) throw databaseError(error);
  return count || 0;
}

export async function getLastUpdatedAt() {
  if (!hasSupabaseConfig()) return (await readLocalStore()).updatedAt;
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from("matches")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw databaseError(error);
  return data?.created_at || null;
}

async function readLocalStore() {
  if (localStoreCache) return localStoreCache;
  try {
    localStoreCache = JSON.parse(await readFile(localStorePath, "utf8"));
  } catch {
    localStoreCache = { matches: [], updatedAt: null };
  }
  return localStoreCache;
}

async function saveLocalMatches(matches) {
  let result = { persisted: true, inserted: 0 };
  localWriteQueue = localWriteQueue.then(async () => {
    const store = await readLocalStore();
    const existing = new Set(store.matches.map((match) => match.metadata.matchId));
    const additions = matches.filter((match) => !existing.has(match.metadata.matchId));
    if (!additions.length) return;
    store.matches.push(...additions);
    store.updatedAt = new Date().toISOString();
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(localStorePath, JSON.stringify(store), "utf8");
    result = { persisted: true, inserted: additions.length };
  });
  await localWriteQueue;
  return result;
}

function databaseError(error) {
  const wrapped = new Error("매치 데이터 저장 중 문제가 발생했습니다.");
  wrapped.code = "SUPABASE_ERROR";
  wrapped.cause = error;
  return wrapped;
}
