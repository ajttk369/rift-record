const form = document.querySelector("#search-form");
const input = document.querySelector("#riot-id");
const welcome = document.querySelector("#welcome");
const loading = document.querySelector("#loading");
const errorPanel = document.querySelector("#error-panel");
const errorMessage = document.querySelector("#error-message");
const results = document.querySelector("#results");
const matchList = document.querySelector("#match-list");
const emptyMatches = document.querySelector("#empty-matches");
const refreshButton = document.querySelector("#refresh-button");
const recentSearches = document.querySelector("#recent-searches");
const recentList = document.querySelector("#recent-list");
const searchBand = document.querySelector("#search");
const championTiers = document.querySelector("#champion-tiers");
const championTierBoard = document.querySelector("#champion-tier-board");
const seedButton = document.querySelector("#seed-button");
const seedStatus = document.querySelector("#seed-status");

let currentData = null;
let currentRiotId = "";
let activeFilter = "all";
let tierData = null;
let activeLane = "TOP";
let activeGrade = "ALL";
let activeTierSort = "tierScore";

renderRecentSearches();
handlePageRoute();

window.addEventListener("popstate", handlePageRoute);

form.addEventListener("submit", (event) => {
  event.preventDefault();
  search(input.value);
});

refreshButton.addEventListener("click", () => {
  if (currentRiotId) search(currentRiotId);
});

document.querySelectorAll(".filter-tabs button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector(".filter-tabs button.active")?.classList.remove("active");
    button.classList.add("active");
    activeFilter = button.dataset.filter;
    renderMatches(currentData);
  });
});

document.querySelectorAll(".lane-tabs button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector(".lane-tabs button.active")?.classList.remove("active");
    button.classList.add("active");
    activeLane = button.dataset.lane;
    loadChampionTiers();
  });
});

document.querySelectorAll(".grade-tabs button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector(".grade-tabs button.active")?.classList.remove("active");
    button.classList.add("active");
    activeGrade = button.dataset.grade;
    renderChampionTiers();
  });
});

document.querySelector("#tier-sort").addEventListener("change", (event) => {
  activeTierSort = event.target.value;
  renderChampionTiers();
});

seedButton.addEventListener("click", seedChampionStats);

async function seedChampionStats() {
  seedButton.disabled = true;
  seedStatus.hidden = false;
  seedStatus.textContent = "Challenger 솔로랭크 유저 5명의 최근 랭크 매치를 수집하는 중입니다. 개발 키 제한 때문에 1분 이상 걸릴 수 있습니다.";

  try {
    const response = await fetch("/api/seed-champion-stats?players=5&matches=10&tier=challenger", {
      method: "POST"
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "샘플 데이터 수집에 실패했습니다.");

    seedStatus.textContent =
      `수집 완료: 새 매치 ${number(data.newMatches)}개 저장, 전체 ${number(data.storedMatchesAfter)}개.`;
    await loadChampionTiers();
  } catch (error) {
    seedStatus.textContent = error.message;
  } finally {
    seedButton.disabled = false;
  }
}

async function handlePageRoute() {
  const showTiers = location.pathname === "/champions";
  championTiers.hidden = !showTiers;
  searchBand.hidden = showTiers;
  welcome.hidden = showTiers || Boolean(currentData);
  loading.hidden = true;
  errorPanel.hidden = true;
  results.hidden = showTiers || !currentData;

  document.querySelectorAll(".topbar nav a[data-page]").forEach((link) => {
    link.classList.toggle("active", link.dataset.page === (showTiers ? "tiers" : "search"));
  });

  if (showTiers) await loadChampionTiers();
}

async function loadChampionTiers() {
  championTierBoard.innerHTML = '<div class="tier-board-loading">수집된 매치 데이터를 집계하는 중입니다.</div>';
  try {
    const response = await fetch(`/api/champion-stats?position=${activeLane}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "티어 통계를 불러오지 못했습니다.");
    tierData = data;
    renderChampionTiers();
  } catch (error) {
    championTierBoard.innerHTML = `<div class="tier-board-loading">${escapeHtml(error.message)}</div>`;
  }
}

function renderChampionTiers() {
  if (!tierData) return;
  document.querySelector("#tier-patch").textContent = `Patch ${tierData.patchVersion}`;
  document.querySelector("#tier-updated").textContent = tierData.updatedAt
    ? `${new Date(tierData.updatedAt).toLocaleString("ko-KR")} 업데이트`
    : "아직 수집된 매치가 없습니다";
  document.querySelector("#tier-sample-summary").innerHTML = `
    <strong>${number(tierData.collectedMatches)}</strong>개 매치 수집
    <span>${activeLane} 표본 ${number(tierData.positionSamples)}개 · 최소 산정 표본 ${tierData.minimumSample}게임</span>
  `;

  const rows = tierData.champions
    .filter((row) => activeGrade === "ALL" || row.tierGrade === activeGrade)
    .sort((a, b) => b[activeTierSort] - a[activeTierSort]);

  if (!rows.length) {
    championTierBoard.innerHTML = `
      <div class="tier-empty">
        <strong>표시할 챔피언 통계가 없습니다.</strong>
        <span>전적검색을 실행하면 랭크 솔로 매치가 누적되어 티어표가 업데이트됩니다.</span>
      </div>
    `;
    return;
  }

  championTierBoard.innerHTML = `
    <div class="tier-table-wrap">
      <table class="tier-table">
        <thead>
          <tr>
            <th>순위</th>
            <th>티어</th>
            <th>챔피언</th>
            <th>게임</th>
            <th>승률</th>
            <th>픽률</th>
            <th>Avg KDA</th>
            <th>평균 CS</th>
            <th>티어 점수</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row, index) => `
            <tr>
              <td class="rank-cell">${index + 1}</td>
              <td>
                <span class="grade-badge grade-${row.tierGrade === "N/A" ? "na" : row.tierGrade.toLowerCase()}">${row.tierGrade}</span>
              </td>
              <td>
                <div class="table-champion">
                  <img src="${championImage(tierData.patchVersion, row.championAssetId)}" width="40" height="40" alt="${escapeHtml(row.championName)}">
                  <div>
                    <strong>${escapeHtml(row.championName)}</strong>
                    <span>${row.position}</span>
                  </div>
                  ${row.lowSample ? '<small>표본 부족</small>' : ""}
                </div>
              </td>
              <td>${number(row.totalGames)}</td>
              <td><strong>${row.winRate.toFixed(2)}%</strong></td>
              <td>${row.pickRate.toFixed(2)}%</td>
              <td>${row.averageKDA.toFixed(2)}</td>
              <td>${row.averageCS.toFixed(1)}</td>
              <td><strong>${row.tierScore.toFixed(1)}</strong></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
    <p class="tier-disclaimer">이 지표는 이 포트폴리오에서 수집한 매치만 사용하며 Riot Games의 공식 랭킹이 아닙니다. 표본이 적으면 정확도가 낮을 수 있습니다.</p>
  `;
}

async function search(rawRiotId) {
  const parsed = parseRiotId(rawRiotId);
  if (!parsed) {
    showError("Riot ID를 게임이름#태그 형식으로 입력해 주세요.");
    return;
  }

  currentRiotId = `${parsed.gameName} #${parsed.tagLine}`;
  input.value = currentRiotId;
  setView("loading");

  try {
    const params = new URLSearchParams(parsed);
    const response = await fetch(`/api/summoner?${params}`);
    const data = await response.json();

    if (!response.ok) throw new Error(data.error || "검색 요청에 실패했습니다.");

    currentData = data;
    activeFilter = "all";
    document.querySelectorAll(".filter-tabs button").forEach((button) => {
      button.classList.toggle("active", button.dataset.filter === "all");
    });
    saveRecentSearch(currentRiotId);
    renderProfile(data);
    setView("results");
    results.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    showError(error.message);
  }
}

function parseRiotId(value) {
  const normalized = value.trim();
  const separator = normalized.lastIndexOf("#");
  if (separator < 1 || separator === normalized.length - 1) return null;

  const gameName = normalized.slice(0, separator).trim();
  const tagLine = normalized.slice(separator + 1).trim();
  return gameName && tagLine ? { gameName, tagLine } : null;
}

function setView(view) {
  championTiers.hidden = true;
  searchBand.hidden = false;
  welcome.hidden = view !== "welcome";
  loading.hidden = view !== "loading";
  errorPanel.hidden = view !== "error";
  results.hidden = view !== "results";
}

function showError(message) {
  errorMessage.textContent = message;
  setView("error");
}

function renderProfile(data) {
  const { account, summoner, ranked, ddragonVersion, updatedAt } = data;
  const profileIcon = document.querySelector("#profile-icon");
  profileIcon.src = ddragonUrl(ddragonVersion, `img/profileicon/${summoner.profileIconId}.png`);
  profileIcon.alt = `${account.gameName} 프로필 아이콘`;
  document.querySelector("#summoner-level").textContent = summoner.level;
  document.querySelector("#game-name").textContent = account.gameName;
  document.querySelector("#tag-line").textContent = `#${account.tagLine}`;
  document.querySelector("#updated-at").textContent =
    `${formatRelativeTime(new Date(updatedAt).getTime())} 업데이트`;

  renderRank(ranked);
  renderSummary(data);
  renderMasteries(data);
  renderMatches(data);
}

function renderRank(entries) {
  const container = document.querySelector("#rank-content");
  const solo = entries.find((entry) => entry.queueType === "RANKED_SOLO_5x5");

  if (!solo) {
    container.innerHTML = '<p class="unranked">이번 시즌 솔로 랭크 기록이 없습니다.</p>';
    return;
  }

  const total = solo.wins + solo.losses;
  const winRate = total ? Math.round((solo.wins / total) * 100) : 0;
  const tierLabel = `${capitalize(solo.tier)} ${solo.rank}`;
  const tierImage = `/assets/ranked/${solo.tier.toLowerCase()}.png`;

  container.innerHTML = `
    <div class="rank-main">
      <span
        class="tier-emblem-image"
        role="img"
        aria-label="${escapeHtml(tierLabel)} 엠블럼"
        style="background-image:url('${tierImage}')"
      ></span>
      <div>
        <strong class="rank-name">${escapeHtml(tierLabel)}</strong>
        <span class="rank-lp">${number(solo.leaguePoints)} LP</span>
      </div>
    </div>
    <div class="rank-record">
      <span><strong>${number(solo.wins)}승</strong> ${number(solo.losses)}패</span>
      <span>승률 <strong>${winRate}%</strong></span>
    </div>
  `;
}

function renderMasteries(data) {
  const container = document.querySelector("#mastery-content");
  const masteries = data.masteries || [];

  if (!masteries.length) {
    container.innerHTML = '<p class="unranked">챔피언 숙련도 기록이 없습니다.</p>';
    return;
  }

  container.innerHTML = masteries.map((mastery, index) => {
    const champion = data.staticData?.champions?.[mastery.championId];
    if (!champion) return "";

    return `
      <div class="mastery-row">
        <span class="mastery-rank">${index + 1}</span>
        <img src="${championImage(data.ddragonVersion, champion.id)}" width="42" height="42" alt="${escapeHtml(champion.name)}">
        <div class="mastery-info">
          <strong>${escapeHtml(champion.name)}</strong>
          <span>${number(mastery.championPoints)}점</span>
        </div>
        <strong class="mastery-level">M${mastery.championLevel}</strong>
      </div>
    `;
  }).join("");
}

function renderSummary(data) {
  const participants = data.matches
    .map((match) => getCurrentParticipant(match, data.account.puuid))
    .filter(Boolean);
  const games = participants.length;
  const wins = participants.filter((participant) => participant.win).length;
  const kills = sum(participants, "kills");
  const deaths = sum(participants, "deaths");
  const assists = sum(participants, "assists");
  const winRate = games ? Math.round((wins / games) * 100) : 0;
  const kda = deaths ? ((kills + assists) / deaths).toFixed(2) : (kills + assists).toFixed(2);

  document.querySelector("#summary-content").innerHTML = `
    <div class="summary-chart">
      <div class="win-ring" style="--rate:${winRate}">
        <strong>${winRate}%</strong>
      </div>
      <div class="summary-kda">
        <strong>${kda} KDA</strong>
        <span>${average(kills, games)} / ${average(deaths, games)} / ${average(assists, games)}</span>
      </div>
    </div>
    <div class="summary-stats">
      <div><strong>${games}</strong><span>게임</span></div>
      <div><strong>${wins}</strong><span>승리</span></div>
      <div><strong>${games - wins}</strong><span>패배</span></div>
    </div>
  `;
}

function renderMatches(data) {
  if (!data) return;

  const filtered = data.matches.filter((match) => {
    const type = getQueueType(match.info.queueId);
    return activeFilter === "all" || type.category === activeFilter;
  });

  emptyMatches.hidden = filtered.length > 0;
  matchList.innerHTML = filtered.map((match) => matchCard(match, data)).join("");

  matchList.querySelectorAll(".details-button").forEach((button) => {
    button.addEventListener("click", () => {
      const card = button.closest(".match-card");
      const isOpen = card.classList.toggle("open");
      button.setAttribute("aria-expanded", String(isOpen));
    });
  });
}

function matchCard(match, data) {
  const player = getCurrentParticipant(match, data.account.puuid);
  if (!player) return "";

  const queue = getQueueType(match.info.queueId);
  const duration = formatDuration(match.info.gameDuration);
  const cs = player.totalMinionsKilled + player.neutralMinionsKilled;
  const minutes = Math.max(match.info.gameDuration / 60, 1);
  const csPerMinute = (cs / minutes).toFixed(1);
  const totalTeamKills = match.info.participants
    .filter((participant) => participant.teamId === player.teamId)
    .reduce((total, participant) => total + participant.kills, 0);
  const killParticipation = totalTeamKills
    ? Math.round(((player.kills + player.assists) / totalTeamKills) * 100)
    : 0;
  const kda = player.deaths
    ? ((player.kills + player.assists) / player.deaths).toFixed(2)
    : "Perfect";
  const result = player.win ? "승리" : "패배";
  const resultClass = player.win ? "win" : "loss";
  const gameCreated = match.info.gameCreation || match.info.gameStartTimestamp;

  return `
    <article class="match-card ${resultClass}" data-category="${queue.category}">
      <div class="result-bar"></div>
      <div class="match-content">
        <div class="match-meta">
          <strong>${result}</strong>
          <span>${escapeHtml(queue.label)}</span>
          <span>${formatRelativeTime(gameCreated)}</span>
          <span>${duration}</span>
        </div>
        <div class="champion-block">
          <div class="champion-image">
            <img src="${championImage(data.ddragonVersion, player.championName)}" alt="${escapeHtml(player.championName)}">
            <span>${player.champLevel}</span>
          </div>
          <div class="kda">
            <strong>${player.kills} / ${player.deaths} / ${player.assists}</strong>
            <span>${kda} KDA</span>
            <div class="build-row">
              <div class="rune-row">${renderRunes(player, data)}</div>
              <div class="item-row">${renderItems(player, data.ddragonVersion)}</div>
            </div>
          </div>
        </div>
        <div class="performance">
          <div><strong>${number(cs)} (${csPerMinute})</strong><span>CS</span></div>
          <div><strong>${number(player.totalDamageDealtToChampions)}</strong><span>챔피언 피해량</span></div>
          <div><strong>${killParticipation}%</strong><span>킬 관여</span></div>
        </div>
        <button class="details-button" type="button" aria-label="참가자 상세 보기" aria-expanded="false">⌄</button>
      </div>
      <div class="match-details">
        ${renderTeams(match, data)}
      </div>
    </article>
  `;
}

function renderRunes(player, data) {
  const styles = player.perks?.styles || [];
  const primary = styles[0];
  const secondary = styles[1];
  const keystoneId = primary?.selections?.[0]?.perk;
  const keystone = data.staticData?.runes?.[keystoneId];
  const secondaryStyle = data.staticData?.runeStyles?.[secondary?.style];
  const images = [];

  if (keystone) {
    images.push(
      `<span class="rune-icon rune-keystone" role="img" aria-label="${escapeHtml(keystone.name)}" title="${escapeHtml(keystone.name)}" style="background-image:url('https://ddragon.leagueoflegends.com/cdn/img/${keystone.icon}')"></span>`
    );
  }
  if (secondaryStyle) {
    images.push(
      `<span class="rune-icon" role="img" aria-label="${escapeHtml(secondaryStyle.name)}" title="${escapeHtml(secondaryStyle.name)}" style="background-image:url('https://ddragon.leagueoflegends.com/cdn/img/${secondaryStyle.icon}')"></span>`
    );
  }
  return images.join("");
}

function renderItems(player, version) {
  return [0, 1, 2, 3, 4, 5, 6].map((index) => {
    const itemId = player[`item${index}`];
    return itemId
      ? `<img src="${ddragonUrl(version, `img/item/${itemId}.png`)}" alt="아이템">`
      : '<span class="item-empty"></span>';
  }).join("");
}

function renderTeams(match, data) {
  const blue = match.info.participants.filter((participant) => participant.teamId === 100);
  const red = match.info.participants.filter((participant) => participant.teamId === 200);
  return `
    <div class="teams">
      ${teamColumn("블루 팀", blue, data)}
      ${teamColumn("레드 팀", red, data)}
    </div>
  `;
}

function teamColumn(label, participants, data) {
  return `
    <div class="team">
      <h3>${label}</h3>
      ${participants.map((participant) => `
        <div class="participant ${participant.puuid === data.account.puuid ? "current" : ""}">
          <img src="${championImage(data.ddragonVersion, participant.championName)}" alt="">
          <span class="participant-name">${escapeHtml(participant.riotIdGameName || participant.summonerName || "Unknown")}</span>
          <span class="participant-kda">${participant.kills}/${participant.deaths}/${participant.assists}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function getCurrentParticipant(match, puuid) {
  return match.info.participants.find((participant) => participant.puuid === puuid);
}

function getQueueType(queueId) {
  const queues = {
    400: { label: "일반 선택", category: "normal" },
    420: { label: "솔로 랭크", category: "ranked" },
    430: { label: "일반 교차", category: "normal" },
    440: { label: "자유 랭크", category: "ranked" },
    450: { label: "무작위 총력전", category: "normal" },
    490: { label: "빠른 대전", category: "normal" },
    900: { label: "URF", category: "normal" },
    1700: { label: "아레나", category: "normal" }
  };
  return queues[queueId] || { label: "기타 모드", category: "normal" };
}

function saveRecentSearch(riotId) {
  const existing = getRecentSearches().filter((item) => item !== riotId);
  localStorage.setItem("rift-record-recent", JSON.stringify([riotId, ...existing].slice(0, 4)));
  renderRecentSearches();
}

function getRecentSearches() {
  try {
    return JSON.parse(localStorage.getItem("rift-record-recent") || "[]");
  } catch {
    return [];
  }
}

function renderRecentSearches() {
  const searches = getRecentSearches();
  recentSearches.hidden = searches.length === 0;
  recentList.innerHTML = searches.map((riotId) =>
    `<button type="button" data-riot-id="${escapeHtml(riotId)}">${escapeHtml(riotId)}</button>`
  ).join("");

  recentList.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => search(button.dataset.riotId));
  });
}

function ddragonUrl(version, path) {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/${path}`;
}

function championImage(version, championName) {
  return ddragonUrl(version, `img/champion/${encodeURIComponent(championName)}.png`);
}

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${minutes}분 ${String(remaining).padStart(2, "0")}초`;
}

function formatRelativeTime(timestamp) {
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}일 전`;
  return new Date(timestamp).toLocaleDateString("ko-KR");
}

function sum(items, key) {
  return items.reduce((total, item) => total + (item[key] || 0), 0);
}

function average(total, count) {
  return count ? (total / count).toFixed(1) : "0.0";
}

function number(value) {
  return new Intl.NumberFormat("ko-KR").format(value || 0);
}

function capitalize(value) {
  const lower = String(value || "").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
