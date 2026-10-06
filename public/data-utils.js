export function getQueueType(queueId) {
  return {
    420: { label: "솔로 랭크", category: "solo", queueType: "RANKED_SOLO_5x5" },
    440: { label: "자유 랭크 5대5", category: "flex", queueType: "RANKED_FLEX_SR" },
    400: { label: "일반 교차 선택", category: "normal" },
    430: { label: "일반 비공개 선택", category: "normal" },
    490: { label: "빠른 대전", category: "normal" },
    450: { label: "무작위 총력전", category: "aram" },
    900: { label: "URF", category: "other" },
    1700: { label: "아레나", category: "other" }
  }[queueId] || { label: "기타 모드", category: "other" };
}

export function isEarlyEnd(match) {
  return Number(match.info?.gameDuration || 0) < 300 ||
    (match.info?.participants || []).some((player) => player.gameEndedInEarlySurrender);
}

export function rankSnapshotScore(snapshot) {
  const tiers = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"];
  const tier = tiers.indexOf(String(snapshot?.tier || "").toUpperCase());
  const lp = Number(snapshot?.leaguePoints || 0);
  if (tier < 0) return lp;
  if (tier >= 7) return 2800 + lp;
  const division = { IV: 0, III: 1, II: 2, I: 3 }[snapshot?.rank] || 0;
  return tier * 400 + division * 100 + lp;
}

export function createSafeStorage(getStorage) {
  const memory = new Map();
  return {
    getItem(key) {
      if (memory.has(key)) return memory.get(key);
      try { return getStorage().getItem(key) ?? null; }
      catch { return memory.get(key) ?? null; }
    },
    setItem(key, value) {
      memory.set(key, String(value));
      try { getStorage().setItem(key, String(value)); } catch { /* Session fallback. */ }
    },
    removeItem(key) {
      memory.set(key, null);
      try { getStorage().removeItem(key); } catch { /* Storage can be disabled. */ }
    }
  };
}

export function assignTierGrades(rows) {
  const eligible = rows.filter((row) => !row.lowSample).sort((a, b) => b.tierScore - a.tierScore);
  for (const row of rows) row.tierGrade = "N/A";
  if (eligible.length < 10) return;
  eligible.forEach((row, index) => {
    const percentile = (index + 1) / eligible.length;
    row.tierGrade = percentile <= .1 ? "S" : percentile <= .3 ? "A" : percentile <= .6 ? "B" : percentile <= .85 ? "C" : "D";
  });
}

export function summarizeTft(matches) {
  const valid = matches.filter((match) => match.placement >= 1 && match.placement <= 8);
  const most = (field) => {
    const counts = new Map();
    for (const match of valid) for (const item of match[field] || []) counts.set(item.name, (counts.get(item.name) || 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || "-";
  };
  return {
    games: valid.length,
    averagePlacement: valid.length ? valid.reduce((n, match) => n + match.placement, 0) / valid.length : 0,
    topFourRate: valid.length ? Math.round(valid.filter((match) => match.placement <= 4).length / valid.length * 100) : 0,
    firstPlaces: valid.filter((match) => match.placement === 1).length,
    averageLevel: valid.length ? valid.reduce((n, match) => n + match.level, 0) / valid.length : 0,
    mostTrait: most("traits"), mostUnit: most("units")
  };
}
