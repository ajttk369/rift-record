import { getQueueType, rankSnapshotScore, createSafeStorage, isEarlyEnd, summarizeTft } from "./data-utils.js";

const storage = createSafeStorage(() => window.localStorage);
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
const favoriteSearches = document.querySelector("#favorite-searches");
const favoriteList = document.querySelector("#favorite-list");
const favoriteButton = document.querySelector("#favorite-button");
const clearFavoriteButton = document.querySelector("#clear-favorite-button");
const persistenceWarning = document.querySelector("#persistence-warning");
const searchBand = document.querySelector("#search");
const championTiers = document.querySelector("#champion-tiers");
const championTierBoard = document.querySelector("#champion-tier-board");
const demoButton = document.querySelector("#demo-button");
const demoBadge = document.querySelector("#demo-badge");
const queueLabel = document.querySelector("#queue-label");
const projectInfo = document.querySelector("#project-info");
const detailedAnalysis = document.querySelector("#detailed-analysis");
const detailedAnalysisToggle = document.querySelector("#detailed-analysis-toggle");
const clearRecentButton = document.querySelector("#clear-recent-button");
const championPerformanceToggle = document.querySelector("#champion-performance-toggle");
const matchListToggle = document.querySelector("#match-list-toggle");
const lolResults = document.querySelector("#lol-results");
const tftResults = document.querySelector("#tft-results");
const tftLoading = document.querySelector("#tft-loading");
const tftError = document.querySelector("#tft-error");
const tftErrorMessage = document.querySelector("#tft-error-message");
const tftContent = document.querySelector("#tft-content");
const tftRetryButton = document.querySelector("#tft-retry-button");
const themeToggle = document.querySelector("#theme-toggle");

let currentData = null;
let currentTftData = null;
let tftLoadingPromise = null;
let tftRequestVersion = 0;
let currentRiotId = "";
let activeFilter = "all";
let currentAnalysis = null;
let championPerformanceExpanded = false;
let matchesExpanded = false;
let personalTierStats = new Map();
let tierData = null;
let activeLane = "TOP";
let activeGrade = "ALL";
let activeTierSort = "tierScore";
let selectedSearchGame = "lol";
let searchRequestVersion = 0;
let searchController;
let tierRequestVersion = 0;
let tierController;
let tftController;
let refreshTimer;
const requestStatus = document.querySelector("#request-status");

renderRecentSearches();
renderFavoriteSearches();
syncThemeToggle();
setView("welcome");
handlePageRoute();

window.addEventListener("popstate", handlePageRoute);

form.addEventListener("submit", (event) => {
  event.preventDefault();
  search(input.value);
});

refreshButton.addEventListener("click", () => {
  if (currentData?.isDemo) showDemoData();
  else if (currentRiotId) search(currentRiotId, { refresh: true, game: tftResults.hidden ? "lol" : "tft" });
});

document.querySelectorAll("[data-search-game]").forEach((button) => {
  button.addEventListener("click", () => setSearchGame(button.dataset.searchGame));
});
document.querySelector("#share-button").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    requestStatus.textContent = "검색 결과 링크를 복사했습니다.";
  } catch {
    const field = document.querySelector("#share-link");
    field.hidden = false;
    field.value = location.href;
    field.focus();
    field.select();
    requestStatus.textContent = "공유 주소를 선택했습니다.";
  }
});
document.querySelectorAll("#tft-mode, #tft-set").forEach((select) => select.addEventListener("change", renderFilteredTft));

clearRecentButton.addEventListener("click", () => {
  storage.removeItem("rift-record-recent");
  renderRecentSearches();
});

clearFavoriteButton.addEventListener("click", () => {
  storage.removeItem("rift-record-favorites");
  renderFavoriteSearches();
  updateFavoriteButton();
});

favoriteButton.addEventListener("click", toggleCurrentFavorite);

championPerformanceToggle.addEventListener("click", () => {
  championPerformanceExpanded = !championPerformanceExpanded;
  renderChampionPerformance(currentAnalysis, currentData);
});

matchListToggle.addEventListener("click", () => {
  matchesExpanded = !matchesExpanded;
  renderMatches(currentData);
});

detailedAnalysisToggle.addEventListener("click", () => {
  const expanded = detailedAnalysis.hidden;
  detailedAnalysis.hidden = !expanded;
  detailedAnalysisToggle.classList.toggle("active", expanded);
  detailedAnalysisToggle.setAttribute("aria-expanded", String(expanded));
  detailedAnalysisToggle.querySelector("strong").textContent =
    expanded ? "상세 분석 접기" : "상세 분석 보기";
  detailedAnalysisToggle.querySelector(".analysis-toggle-action em").textContent =
    expanded ? "닫기" : "열기";
});

document.querySelectorAll("[data-game-tab]").forEach((button) => {
  button.addEventListener("click", () => selectGameTab(button.dataset.gameTab));
});

tftRetryButton.addEventListener("click", () => loadTftData(true));
themeToggle.addEventListener("click", toggleTheme);

document.querySelectorAll(".filter-tabs button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector(".filter-tabs button.active")?.classList.remove("active");
    button.classList.add("active");
    activeFilter = button.dataset.filter;
    matchesExpanded = false;
    renderPersonalAnalysis(currentData);
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

demoButton.addEventListener("click", showDemoData);
handleInitialQuery();

document.querySelectorAll(".filter-tabs, .lane-tabs, .grade-tabs").forEach((group) => {
  group.setAttribute("role", "group");
  const sync = () => group.querySelectorAll("button").forEach((button) => button.setAttribute("aria-pressed", String(button.classList.contains("active"))));
  sync();
  group.addEventListener("click", sync);
});
document.querySelector(".game-tabs").addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const buttons = [...event.currentTarget.querySelectorAll("[role='tab']")];
  const index = buttons.indexOf(document.activeElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
  event.preventDefault();
  buttons[next].focus();
  buttons[next].click();
});

function toggleTheme() {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = nextTheme;

  try {
    localStorage.setItem("rift-record-theme", nextTheme);
  } catch {
    // The selected theme still applies for the current page session.
  }

  syncThemeToggle();
}

function syncThemeToggle() {
  const isDark = document.documentElement.dataset.theme === "dark";
  themeToggle.querySelector(".theme-toggle-label").textContent = isDark ? "Dark" : "Light";
  themeToggle.querySelector(".theme-toggle-icon").textContent = isDark ? "☾" : "☀";
  themeToggle.setAttribute("aria-label", isDark ? "라이트 모드로 전환" : "다크 모드로 전환");
  themeToggle.setAttribute("aria-pressed", String(isDark));
}

function showDemoData() {
  searchRequestVersion += 1;
  searchController?.abort();
  tftController?.abort();
  clearInterval(refreshTimer);
  refreshButton.disabled = false;
  document.querySelector("main").setAttribute("aria-busy", "false");
  requestStatus.textContent = "샘플 데이터 · 실제 Riot 계정 기록이 아닙니다.";
  currentRiotId = "";
  championPerformanceExpanded = false;
  matchesExpanded = false;
  activeFilter = "all";
  resetDetailedAnalysis();
  projectInfo.open = false;
  document.querySelectorAll(".filter-tabs button").forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === "all");
  });
  personalTierStats = new Map([
    ["Ahri:MID", { tierGrade: "A", tierScore: 78.4, position: "MID" }],
    ["LeeSin:JUNGLE", { tierGrade: "B", tierScore: 66.1, position: "JUNGLE" }],
    ["Ezreal:ADC", { tierGrade: "A", tierScore: 74.8, position: "ADC" }]
  ]);
  currentData = createDemoData();
  currentTftData = null;
  tftLoadingPromise = null;
  tftRequestVersion += 1;
  selectGameTab(selectedSearchGame);
  history.replaceState(null, "", `/?demo=true&game=${selectedSearchGame}`);
  renderProfile(currentData);
  setView("results");
  results.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function handlePageRoute() {
  const showTiers = location.pathname === "/champions";
  championTiers.hidden = !showTiers;
  searchBand.hidden = showTiers;
  projectInfo.hidden = showTiers;
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
  const version = ++tierRequestVersion;
  const lane = activeLane;
  tierController?.abort();
  tierController = new AbortController();
  championTierBoard.innerHTML = '<div class="tier-board-loading">수집된 매치 데이터를 집계하는 중입니다.</div>';
  try {
    const response = await fetch(`/api/champion-stats?position=${lane}`, { signal: AbortSignal.any([tierController.signal, AbortSignal.timeout(45_000)]) });
    const data = await response.json();
    if (version !== tierRequestVersion) return;
    if (!response.ok) throw new Error(data.error || "티어 통계를 불러오지 못했습니다.");
    tierData = data;
    renderChampionTiers();
  } catch (error) {
    if (version !== tierRequestVersion || error.name === "AbortError") return;
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
    <span>${activeLane} 참가 기록 ${number(tierData.positionSamples)}개 · 최근 ${tierData.windowDays || 28}일 · 솔로랭크</span>
    <small>${tierData.eligibleChampions >= 10 ? "챔피언별 최소 10경기" : "비교 가능한 챔피언 10개 미만 · 등급 산정 보류"}</small>
  `;

  const rows = tierData.champions
    .filter((row) => activeGrade === "ALL" || row.tierGrade === activeGrade)
    .sort((a, b) => Number(a.lowSample) - Number(b.lowSample) || b[activeTierSort] - a[activeTierSort]);

  if (!rows.length) {
    championTierBoard.innerHTML = `
      <div class="tier-empty">
        <strong>${tierData.champions.length ? "선택한 등급에 해당하는 챔피언이 없습니다." : "현재 패치의 솔로랭크 표본이 아직 없습니다."}</strong>
        <span>${tierData.champions.length ? "다른 등급이나 전체 필터를 선택해 주세요." : "최근 28일의 5분 이상 경기를 기준으로 집계합니다."}</span>
      </div>
    `;
    return;
  }

  const columns = [
    ["순위", null], ["티어", null], ["챔피언", null],
    ["경기", "totalGames"], ["승률", "winRate"], ["픽률", "pickRate"],
    ["평균 KDA", "averageKDA"], ["평균 CS", null], ["티어 점수", "tierScore"]
  ];
  championTierBoard.innerHTML = `
    <div class="tier-table-wrap">
      <table class="tier-table" data-sort="${escapeHtml(activeTierSort)}" aria-label="${escapeHtml(activeLane)} 챔피언 성과">
        <thead>
          <tr>
            ${columns.map(([label, key]) => `<th scope="col"${key === activeTierSort ? ' class="is-sorted" aria-sort="descending"' : ""}>${label}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${rows.map((row, index) => `
            <tr>
              <td class="rank-cell">${index + 1}</td>
              <td>
                <span class="grade-badge grade-${row.tierGrade === "N/A" ? "na" : row.tierGrade.toLowerCase()}">${row.tierGrade === "N/A" ? "—" : row.tierGrade}</span>
              </td>
              <td>
                <div class="table-champion">
                  <img src="${championImage(tierData.patchVersion, row.championAssetId)}" width="40" height="40" alt="${escapeHtml(row.championName)}">
                  <div>
                    <strong>${escapeHtml(row.championName)}</strong>
                    <span>${row.position}</span>
                  </div>
                  ${row.lowSample ? '<small>표본 부족 · Low Sample</small>' : ""}
                </div>
              </td>
              <td>${number(row.totalGames)}</td>
              <td>
                <div class="win-rate-cell">
                  <strong>${row.winRate.toFixed(2)}%</strong>
                  <span class="win-rate-track" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, row.winRate))}%"></i></span>
                </div>
              </td>
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

async function search(rawRiotId, { game = selectedSearchGame, refresh = false } = {}) {
  const parsed = parseRiotId(rawRiotId);
  if (!parsed) {
    showError("Riot ID는 게임이름#태그 형식으로 입력해주세요. 예: Hide on bush#KR1");
    return;
  }

  const version = ++searchRequestVersion;
  clearInterval(refreshTimer);
  searchController?.abort();
  tftController?.abort();
  searchController = new AbortController();
  tftRequestVersion += 1;
  tftLoadingPromise = null;
  setSearchGame(game);
  input.value = `${parsed.gameName} #${parsed.tagLine}`;
  refreshButton.disabled = true;
  requestStatus.textContent = `${game === "tft" ? "TFT" : "LoL"} 전적을 조회하고 있습니다.`;
  document.querySelector("main").setAttribute("aria-busy", "true");
  if (!refresh || !currentData) setView("loading");

  try {
    const params = new URLSearchParams(parsed);
    if (refresh) params.set("refresh", "1");
    const response = await fetch(`/api/${game === "tft" ? "tft" : "summoner"}?${params}`, {
      signal: AbortSignal.any([searchController.signal, AbortSignal.timeout(45_000)])
    });
    const data = await parseJsonResponse(response);
    if (version !== searchRequestVersion) return;

    if (!response.ok) {
      throw new Error(getFriendlyError(response.status, data?.error));
    }

    if (!data?.account || (game === "lol" && !Array.isArray(data.matches)) || (game === "tft" && !Array.isArray(data.tftMatches))) {
      throw new Error("전적 응답을 확인할 수 없습니다. 다시 시도해 주세요.");
    }
    currentRiotId = `${data.account.gameName} #${data.account.tagLine}`;
    currentData = game === "tft"
      ? { account: data.account, summoner: data.tftSummoner || {}, ddragonVersion: data.ddragonVersion, isTftOnly: true }
      : data;
    if (game === "lol") currentData.rankTracking = updateRankSnapshots(data);
    currentTftData = game === "tft" ? data : null;
    tftLoadingPromise = null;
    tftRequestVersion += 1;
    championPerformanceExpanded = false;
    matchesExpanded = false;
    resetDetailedAnalysis();
    projectInfo.open = false;
    personalTierStats = new Map();
    activeFilter = "all";

    document.querySelectorAll(".filter-tabs button").forEach((button) => {
      button.classList.toggle("active", button.dataset.filter === "all");
    });

    saveRecentSearch(currentRiotId);

    history.replaceState(
      null,
      "",
      `/?riotId=${encodeURIComponent(data.account.gameName)}&tag=${encodeURIComponent(data.account.tagLine)}&game=${game}`
    );

    if (game === "lol") renderProfile(data);
    else {
      renderTftProfile(data);
      resetTftFilters(data);
      tftLoading.hidden = true;
      tftError.hidden = true;
      tftContent.hidden = false;
    }
    selectGameTab(game);
    updateFavoriteButton();
    setView("results");
    requestStatus.textContent = data.cached ? "저장된 최신 조회 결과를 표시합니다." : "";
    setRefreshCooldown(data.refreshAfterSeconds || 0);
    if (!refresh) results.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  } catch (error) {
    if (version !== searchRequestVersion || error.name === "AbortError") return;
    const message = error.name === "TimeoutError" ? "조회 시간이 길어지고 있습니다. 잠시 후 다시 시도해 주세요." : error.message;
    showError(message || "전적을 불러오는 중 문제가 발생했습니다.");
    if (refresh && currentData) {
      setView("results");
      errorPanel.hidden = false;
    }
    requestStatus.textContent = "";
    refreshButton.disabled = false;
  } finally {
    if (version === searchRequestVersion) document.querySelector("main").setAttribute("aria-busy", "false");
  }
}

function setSearchGame(game) {
  selectedSearchGame = game === "tft" ? "tft" : "lol";
  document.querySelectorAll("[data-search-game]").forEach((button) => {
    const selected = button.dataset.searchGame === selectedSearchGame;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function setRefreshCooldown(seconds) {
  clearInterval(refreshTimer);
  const until = Date.now() + seconds * 1000;
  const update = () => {
    const remaining = Math.max(0, Math.ceil((until - Date.now()) / 1000));
    refreshButton.disabled = remaining > 0;
    refreshButton.title = remaining ? `${remaining}초 후 새로고침 가능` : "전적 새로고침";
    refreshButton.setAttribute("aria-label", refreshButton.title);
    if (!remaining) clearInterval(refreshTimer);
  };
  update();
  if (seconds) refreshTimer = setInterval(update, 1000);
}

function parseRiotId(value) {
  const normalized = value.trim();
  const separator = normalized.lastIndexOf("#");
  if (separator < 1 || separator === normalized.length - 1) return null;

  const gameName = normalized.slice(0, separator).trim();
  const tagLine = normalized.slice(separator + 1).trim();
  return gameName && tagLine && gameName.length <= 64 && tagLine.length <= 16 && !/[\u0000-\u001f\u007f]/.test(normalized) ? { gameName, tagLine } : null;
}

function setView(view) {
  championTiers.hidden = true;
  searchBand.hidden = false;
  searchBand.classList.toggle("has-results", view === "results");
  document.body.classList.toggle("has-search-results", view === "results");
  projectInfo.hidden = false;
  welcome.hidden = view !== "welcome";
  loading.hidden = view !== "loading";
  errorPanel.hidden = view !== "error";
  results.hidden = view !== "results";
  document.querySelector("#result-caption").textContent = currentData?.isDemo ? "샘플 전적" : currentRiotId;
  document.querySelector("#share-link").hidden = true;
}

function resetDetailedAnalysis() {
  detailedAnalysis.hidden = true;
  detailedAnalysisToggle.classList.remove("active");
  detailedAnalysisToggle.setAttribute("aria-expanded", "false");
  detailedAnalysisToggle.querySelector("strong").textContent = "상세 분석 보기";
  detailedAnalysisToggle.querySelector(".analysis-toggle-action em").textContent = "열기";
}

function showError(message) {
  errorMessage.textContent = message;
  setView("error");
}

function renderProfile(data) {
  const { account, summoner, ranked, ddragonVersion, updatedAt } = data;

  demoBadge.hidden = !data.isDemo;
  queueLabel.hidden = Boolean(data.isDemo);

  const profileIcon = document.querySelector("#profile-icon");
  profileIcon.src = ddragonUrl(ddragonVersion, `img/profileicon/${summoner.profileIconId}.png`);
  profileIcon.alt = `${account.gameName} 프로필 아이콘`;

  document.querySelector("#summoner-level").textContent = summoner.level;
  document.querySelector("#game-name").textContent = account.gameName;
  document.querySelector("#tag-line").textContent = `#${account.tagLine}`;
  document.querySelector("#updated-at").textContent =
    `${formatRelativeTime(new Date(updatedAt).getTime())} 업데이트`;

  const warnings = [data.persistenceWarning, data.rankWarning].filter(Boolean).join(" ");
  persistenceWarning.hidden = !warnings;
  persistenceWarning.textContent = warnings;

  updateFavoriteButton();

  renderRank(ranked);
  renderMasteries(data);
  renderPersonalAnalysis(data);
  renderMatches(data);
}

function selectGameTab(tab) {
  if (tab === "lol" && currentData?.isTftOnly) {
    search(currentRiotId, { game: "lol" });
    return;
  }
  setSearchGame(tab);
  const showTft = tab === "tft";
  lolResults.hidden = showTft;
  tftResults.hidden = !showTft;

  document.querySelectorAll("[data-game-tab]").forEach((button) => {
    const active = button.dataset.gameTab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });

  if (currentData && location.pathname !== "/champions") {
    const url = new URL(location.href);
    url.searchParams.set("game", tab);
    history.replaceState(null, "", url.pathname + url.search);
  }

  if (showTft && !currentTftData) {
    loadTftData();
  }
}

async function loadTftData(force = false) {
  if (!currentData || (currentTftData && !force)) return;
  if (tftLoadingPromise && !force) return tftLoadingPromise;

  tftLoading.hidden = false;
  tftError.hidden = true;
  tftContent.hidden = true;
  const requestVersion = ++tftRequestVersion;
  const accountData = currentData;
  tftController?.abort();
  tftController = new AbortController();

  tftLoadingPromise = (async () => {
    try {
      const data = currentData.isDemo
        ? createDemoTftData(currentData)
        : await fetchTftData(accountData.account, force, tftController.signal);
      if (requestVersion !== tftRequestVersion) return;
      currentTftData = data;
      renderTftProfile(data);
      resetTftFilters(data);
      tftLoading.hidden = true;
      tftContent.hidden = false;
    } catch (error) {
      if (requestVersion !== tftRequestVersion) return;
      tftLoading.hidden = true;
      tftError.hidden = false;
      tftErrorMessage.textContent = error.message || "TFT 전적을 불러오지 못했습니다.";
    } finally {
      if (requestVersion === tftRequestVersion) {
        tftLoadingPromise = null;
      }
    }
  })();

  return tftLoadingPromise;
}

async function fetchTftData(account, refresh = false, signal) {
  const params = new URLSearchParams({
    gameName: account.gameName,
    tagLine: account.tagLine
  });
  if (refresh) params.set("refresh", "1");
  const response = await fetch(`/api/tft?${params}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)].filter(Boolean)) });
  const data = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(getFriendlyError(response.status, data?.error));
  }
  if (!data?.account || !Array.isArray(data.tftMatches)) throw new Error("TFT 응답을 확인할 수 없습니다.");
  return data;
}

function renderTftProfile(data) {
  const summoner = data.tftSummoner;
  const profileIconId = summoner?.profileIconId ?? currentData?.summoner?.profileIconId;
  const profileIcon = document.querySelector("#tft-profile-icon");
  profileIcon.src = ddragonUrl(data.ddragonVersion || currentData.ddragonVersion, `img/profileicon/${profileIconId ?? 29}.png`);
  profileIcon.alt = `${currentData.account.gameName} TFT 프로필 아이콘`;
  document.querySelector("#tft-level").textContent =
    summoner?.level || currentData?.summoner?.level || "-";
  document.querySelector("#tft-game-name").textContent = currentData.account.gameName;
  document.querySelector("#tft-tag-line").textContent = `#${currentData.account.tagLine}`;
  document.querySelector("#tft-updated-at").textContent =
    `${formatRelativeTime(new Date(data.updatedAt).getTime())} 업데이트`;

  const rank = data.tftRank;
  document.querySelector("#tft-rank").innerHTML = rank
    ? `
      <span>TFT RANK</span>
      <div class="tft-rank-main">
        <span
          class="tft-rank-emblem"
          role="img"
          aria-label="${escapeHtml(`${capitalize(rank.tier)} ${rank.rank}`)} 엠블럼"
          style="background-image:url('/assets/ranked/${escapeHtml(rank.tier.toLowerCase())}.png')"
        ></span>
        <div>
          <strong>${escapeHtml(`${capitalize(rank.tier)} ${rank.rank}`)}</strong>
          <b>${number(rank.leaguePoints)} LP</b>
          <p>${number(rank.wins)}승 ${number(rank.losses)}패 · 승률 ${number(rank.winRate)}%</p>
        </div>
      </div>
    `
    : `
      <span>TFT RANK</span>
      <strong>${escapeHtml(data.tftRankError || "롤토체스 랭크 정보 없음")}</strong>
      <p>${data.tftRankError?.includes("불러오지")
        ? "랭크 API 응답을 확인해주세요."
        : "이번 시즌 랭크 기록이 없습니다."}</p>
    `;
}

function renderTftSummary(data) {
  const summary = data.tftSummary;
  const cards = [
    ["평균 등수", summary.games ? `${Number(summary.averagePlacement).toFixed(1)}등` : "-", "avg"],
    ["Top 4", !data.doubleUp && summary.games ? `${number(summary.topFourRate)}%` : "-", "top4"],
    ["1등", summary.games ? `${number(summary.firstPlaces)}회` : "-", "first"],
    ["평균 레벨", summary.games ? Number(summary.averageLevel).toFixed(1) : "-", "level"],
    ["주요 특성", summary.mostTrait || "-", "trait"],
    ["주요 유닛", summary.mostUnit || "-", "unit"]
  ];

  document.querySelector("#tft-summary").innerHTML = `
    <div class="tft-summary-overview">
      <div class="tft-summary-metrics">
        ${cards.map(([label, value, type]) => `
          <article class="metric-${type}"><span>${label}</span><strong>${escapeHtml(value)}</strong></article>
        `).join("")}
      </div>
    </div>
    <div class="tft-summary-side">
      <article class="tft-placement-distribution">
        <div><span>등수 분포</span><strong>최근 ${number(summary.games || data.tftMatches.length)}경기</strong></div>
        ${renderTftPlacementDistribution(data.tftMatches)}
      </article>
      <article class="tft-placement-trend">
        <div>
          <span>최근 등수 추이</span>
          <strong>과거 → 최근 · 낮을수록 좋은 기록</strong>
        </div>
        ${renderTftPlacementChart(data.tftMatches)}
      </article>
    </div>
  `;
}

function renderTftMatches(matches) {
  const list = document.querySelector("#tft-match-list");
  const empty = document.querySelector("#tft-empty-matches");
  empty.hidden = matches.length > 0;
  list.innerHTML = matches.map(tftMatchCard).join("");
  list.querySelectorAll(".tft-details-button").forEach((button) => {
    button.addEventListener("click", () => {
      const card = button.closest(".tft-match-card");
      const isOpen = card.classList.toggle("is-expanded");
      if (isOpen && !card.dataset.loaded) {
        card.querySelector(".tft-match-details").innerHTML = tftMatchDetailTable(matches[Number(card.dataset.index)]);
        card.dataset.loaded = "true";
      }
      button.setAttribute("aria-expanded", String(isOpen));
      button.querySelector("span").textContent = isOpen ? "접기" : "상세";
    });
  });
}

function resetTftFilters(data) {
  const sets = [...new Set(data.tftMatches.map((match) => match.setNumber).filter(Boolean))];
  document.querySelector("#tft-mode").value = "all";
  document.querySelector("#tft-set").innerHTML = '<option value="all">전체 세트</option>' + sets.map((set) => `<option value="${Number(set)}">세트 ${Number(set)}</option>`).join("");
  renderFilteredTft();
}

function tftMode(match) {
  return match.queueId === 1100 ? "ranked" : match.queueId === 1090 ? "normal" : match.queueId === 1160 ? "double" : "other";
}

function renderFilteredTft() {
  if (!currentTftData) return;
  const mode = document.querySelector("#tft-mode").value;
  const set = document.querySelector("#tft-set").value;
  const matches = currentTftData.tftMatches.filter((match) => (mode === "all" || tftMode(match) === mode) && (set === "all" || String(match.setNumber) === set));
  const standard = matches.filter((match) => [1090, 1100].includes(match.queueId));
  const doubleUp = mode === "double";
  const analyzed = doubleUp ? matches : standard;
  const summary = summarizeTft(analyzed);
  const dates = matches.map((match) => match.gameDatetime).filter(Boolean).sort((a, b) => a - b);
  const period = dates.length ? `${new Date(dates[0]).toLocaleDateString("ko-KR")} ~ ${new Date(dates.at(-1)).toLocaleDateString("ko-KR")}` : "해당 조건의 경기 없음";
  document.querySelector("#tft-period").textContent = `${period} · ${matches.length}경기${mode === "all" ? " · 요약은 일반·랭크 경기 기준" : doubleUp ? " · 팀전 모드로 Top 4 지표 미적용" : mode === "other" ? " · 별도 규칙 모드로 요약 지표 미적용" : ""}`;
  document.querySelector(".tft-summary-section h2").textContent = `선택한 ${summary.games}경기 요약`;
  renderTftSummary({ ...currentTftData, tftMatches: analyzed, tftSummary: summary, doubleUp });
  renderTftMatches(matches);
}

function tftMatchCard(match, index) {
  const standardMode = [1090, 1100].includes(match.queueId);
  const placementClass = match.placement === 1
    ? "first"
    : match.placement <= 4 ? "top-four" : "bottom-four";
  const companion = tftCompanionPortrait(match.companion, "tft-player-companion");
  const traits = match.traits.length
    ? match.traits.map((trait) =>
      `<span class="tft-trait tier-${Math.min(trait.style, 4)}" title="${escapeHtml(getTftTraitName(trait))}">
        ${tftAssetImage("traits", trait, "tft-trait-icon")}
        <span>${escapeHtml(getTftTraitName(trait))}</span><b>${trait.units}</b>
      </span>`
    ).join("")
    : '<span class="tft-empty-chip">특성 정보 없음</span>';
  const units = match.units.length
    ? match.units.map(tftUnitPortrait).join("")
    : '<span class="tft-empty-chip">유닛 정보 없음</span>';
  const augments = match.augments.length
    ? match.augments.map((augment) => `
      <span class="tft-augment" title="${escapeHtml(getTftAugmentName(augment))}">
        ${tftAssetImage("augments", augment, "tft-augment-icon")}
        <span>${escapeHtml(getTftAugmentName(augment))}</span>
      </span>
    `).join("")
    : '<span class="tft-empty-chip">증강체 정보 없음</span>';
  return `
    <article class="tft-match-card tft-match-card-compact ${placementClass}" data-index="${index}">
      <div class="tft-compact-main">
        <div class="tft-placement">
          ${companion}
          <strong>${match.placement}</strong><span>등</span>
          <b>${standardMode ? match.placement <= 4 ? "TOP 4" : "BOTTOM 4" : "최종 순위"}</b>
        </div>
        <div class="tft-match-meta">
          <strong>${escapeHtml(tftQueueLabel(match.queueId, match.gameType))}</strong>
          <span>세트 ${number(match.setNumber)}</span>
          <span>${formatRelativeTime(match.gameDatetime)}</span>
          <span>${formatDuration(Math.round(match.gameLength))}</span>
          <div><b>Lv.${match.level}</b><b>라운드 ${escapeHtml(formatTftRound(match.lastRound))}</b></div>
        </div>
        <div class="tft-build-overview">
          <div class="tft-build-topline">
            <div class="tft-traits">${traits}</div>
            <div class="tft-augments">${augments}</div>
          </div>
          <div class="tft-units">${units}</div>
        </div>
        <div class="tft-card-actions">
          <span>${match.units.length} 유닛</span>
          <button class="tft-details-button" type="button" aria-expanded="false">
            <span>상세</span><b aria-hidden="true">⌄</b>
          </button>
        </div>
      </div>
      <div class="tft-match-details">
      </div>
    </article>
  `;
}

function tftMatchDetailTable(match) {
  const participants = match.participants?.length ? match.participants : [{
    name: "내 기록",
    placement: match.placement,
    level: match.level,
    lastRound: match.lastRound,
    goldLeft: 0,
    playersEliminated: 0,
    totalDamageToPlayers: 0,
    companion: match.companion,
    traits: match.traits,
    units: match.units,
    isCurrentPlayer: true
  }];

  return `
    <div class="tft-detail-table">
      <div class="tft-detail-table-head">
        <span>#</span>
        <span>소환사</span>
        <span>라운드</span>
        <span>시너지</span>
        <span>챔피언</span>
        <span>업적</span>
      </div>
      ${participants.map(tftParticipantRow).join("")}
    </div>
  `;
}

function tftParticipantRow(participant) {
  return `
    <article class="tft-participant-row ${participant.isCurrentPlayer ? "is-current" : ""}">
      <div class="tft-participant-placement">${number(participant.placement)}</div>
      <div class="tft-participant-player">
        ${tftCompanionPortrait(participant.companion, "tft-participant-companion")}
        <div>
          <strong>${escapeHtml(stripRiotTag(participant.name))}</strong>
          <span>Lv.${number(participant.level)}</span>
        </div>
      </div>
      <div class="tft-participant-round">
        <strong>${escapeHtml(formatTftRound(participant.lastRound))}</strong>
        <span>${escapeHtml(formatTftElimination(participant.timeEliminated))}</span>
      </div>
      <div class="tft-participant-traits">${tftMiniTraits(participant.traits)}</div>
      <div class="tft-participant-units">${tftMiniUnits(participant.units)}</div>
      <div class="tft-participant-stats">
        <span>G ${number(participant.goldLeft)}</span>
        <span>KO ${number(participant.playersEliminated)}</span>
        <span>DMG ${number(participant.totalDamageToPlayers)}</span>
      </div>
    </article>
  `;
}

function tftMiniTraits(traits = []) {
  return traits.length
    ? traits.slice(0, 8).map((trait) => `
      <span class="tft-mini-trait tier-${Math.min(trait.style, 4)}" title="${escapeHtml(getTftTraitName(trait))}">
        ${tftAssetImage("traits", trait, "tft-mini-trait-icon")}
        <em>${escapeHtml(shortTftName(getTftTraitName(trait)))}</em>
        <b>${number(trait.units)}</b>
      </span>
    `).join("")
    : '<span class="tft-empty-chip">-</span>';
}

function tftMiniUnits(units = []) {
  return units.length
    ? units.map((unit) => {
      const items = unit.items?.slice(0, 3) || [];
      const name = getTftUnitName(unit);
      return `
        <span class="tft-mini-unit rarity-${Math.min(unit.rarity || 0, 5)} ${unit.isSummon ? "is-summon" : ""}" title="${escapeHtml(`${name} · ${unit.summonTrait || `${unit.tier}성`}`)}">
          ${tftAssetImage("units", unit, "tft-mini-unit-icon")}
          <b>${unit.isSummon ? "소환" : "★".repeat(Math.min(unit.tier, 3))}</b>
          ${unit.isSummon ? `<em>${escapeHtml(name)}</em>` : ""}
          <small>${items.map((item) => tftAssetImage("items", item, "tft-mini-item-icon")).join("")}</small>
        </span>
      `;
    }).join("")
    : '<span class="tft-empty-chip">-</span>';
}

function tftCompanionPortrait(companion, className) {
  const name = getTftCompanionName(companion);
  const imageUrl = companion?.imageUrl || getTftStaticEntry("companions", companion).imageUrl;
  if (!imageUrl) {
    return `
      <span class="${className} tft-companion-fallback" title="${escapeHtml(name)}">
        <b>✦</b>
        <small>전략가</small>
      </span>
    `;
  }
  return `<img class="${className}" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(name)}" loading="lazy" title="${escapeHtml(name)}">`;
}

function getTftCompanionName(companion) {
  if (!companion) return "전략가";
  return companion.name || getTftStaticEntry("companions", companion).name || "전략가";
}

function stripRiotTag(name) {
  return String(name || "Unknown").split("#")[0];
}

function shortTftName(name) {
  const text = String(name || "-").replace(/^TFT\d+_?/i, "");
  return text.length > 5 ? `${text.slice(0, 5)}…` : text;
}

function renderTftPlacementChart(matches) {
  if (!matches.length) return '<p class="tft-chart-empty">최근 경기 기록이 없습니다.</p>';
  const width = 520;
  const height = 112;
  const paddingX = 20;
  const paddingY = 12;
  const points = matches.slice().reverse().map((match, index, entries) => {
    const x = entries.length === 1
      ? width / 2
      : paddingX + (index / (entries.length - 1)) * (width - paddingX * 2);
    const y = paddingY + ((Math.max(1, Math.min(8, match.placement)) - 1) / 7) * (height - paddingY * 2);
    return { x, y, placement: match.placement };
  });

  return `
    <svg class="tft-placement-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="최근 10경기 등수 추이">
      <line x1="${paddingX}" y1="${paddingY}" x2="${width - paddingX}" y2="${paddingY}" class="top-four-line"></line>
      <line x1="${paddingX}" y1="${height / 2}" x2="${width - paddingX}" y2="${height / 2}" class="middle-line"></line>
      <line x1="${paddingX}" y1="${height - paddingY}" x2="${width - paddingX}" y2="${height - paddingY}" class="bottom-line"></line>
      <polyline points="${points.map(({ x, y }) => `${x},${y}`).join(" ")}"></polyline>
      ${points.map(({ x, y, placement }) => `
        <g>
          <circle cx="${x}" cy="${y}" r="5"></circle>
          <text x="${x}" y="${y - 9}" text-anchor="middle">${placement}</text>
        </g>
      `).join("")}
    </svg>
  `;
}

function tftUnitPortrait(unit) {
  const name = getTftUnitName(unit);
  const items = unit.items?.slice(0, 3) || [];
  return `
    <span class="tft-unit-portrait rarity-${Math.min(unit.rarity || 0, 5)} ${unit.isSummon ? "is-summon" : ""}" title="${escapeHtml(`${name} · ${unit.summonTrait || `${unit.tier}성`}`)}">
      <span class="tft-unit-image">
        ${tftAssetImage("units", unit, "tft-unit-icon")}
        <b>${unit.isSummon ? "소환" : "★".repeat(Math.min(unit.tier, 3))}</b>
      </span>
      ${unit.isSummon ? `<em class="tft-summon-name">${escapeHtml(name)}</em>` : ""}
      <span class="tft-item-icons">
        ${items.map((item) => tftAssetImage("items", item, "tft-item-icon")).join("")}
      </span>
    </span>
  `;
}

function tftDetailedUnit(unit) {
  return `
    <article class="tft-detailed-unit">
      ${tftAssetImage("units", unit, "tft-detailed-unit-icon")}
      <div>
        <strong>${escapeHtml(getTftUnitName(unit))}</strong>
        <span>${unit.isSummon ? escapeHtml(unit.summonTrait || "소환 유닛") : "★".repeat(Math.min(unit.tier, 3))}</span>
        <small>${unit.items?.length
          ? unit.items.map(getTftItemName).map(escapeHtml).join(" · ")
          : "장착 아이템 없음"}</small>
      </div>
    </article>
  `;
}

function getTftUnitName(unit) {
  return getTftLocalizedName("units", unit);
}

function getTftTraitName(trait) {
  return getTftLocalizedName("traits", trait);
}

function getTftAugmentName(augment) {
  return getTftLocalizedName("augments", augment);
}

function getTftItemName(item) {
  return getTftLocalizedName("items", item);
}

function getTftLocalizedName(type, entry) {
  return getTftStaticEntry(type, entry).name;
}

function getTftStaticEntry(type, entry) {
  const id = typeof entry === "string" ? entry : entry?.id;
  const fallback = typeof entry === "string" ? entry : entry?.name;
  const key = String(id || "").toLowerCase();
  const staticEntry = currentTftData?.tftStaticData?.[type]?.[key];
  if (typeof staticEntry === "string") {
    return { name: staticEntry, imageUrl: null };
  }
  return {
    name: staticEntry?.name || fallback || id || "-",
    imageUrl: staticEntry?.imageUrl || null
  };
}

function tftAssetImage(type, entry, className) {
  const asset = getTftStaticEntry(type, entry);
  if (!asset.imageUrl) {
    return `<span class="${className} tft-asset-fallback">${escapeHtml(asset.name.slice(0, 1))}</span>`;
  }
  return `<img class="${className}" src="${escapeHtml(asset.imageUrl)}" alt="" loading="lazy" title="${escapeHtml(asset.name)}">`;
}

function tftQueueLabel(queueId, gameType) {
  const labels = {
    1090: "일반",
    1100: "랭크",
    1130: "초고속 모드",
    1160: "더블 업"
  };
  return labels[queueId] || gameType || "TFT";
}

function formatTftRound(round) {
  if (!round) return "-";
  return `${number(round)}회차`;
}

function formatTftElimination(seconds) {
  if (!seconds) return "-";
  return formatDuration(Math.round(seconds));
}

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function getFriendlyError(status, serverMessage) {
  if (status === 400) {
    return "Riot ID는 게임이름#태그 형식으로 입력해주세요. 예: Hide on bush#KR1";
  }
  if (status === 404) {
    return "해당 Riot ID를 찾을 수 없습니다.";
  }
  if (status === 503 && serverMessage?.includes("RIOT_API_KEY")) {
    return "서버에 Riot API Key가 설정되어 있지 않습니다. Vercel 환경변수를 확인해주세요.";
  }
  if (status === 429) {
    return "Riot API 요청 제한에 도달했습니다. 잠시 후 다시 시도해주세요.";
  }
  if (status === 401 || status === 403) {
    return serverMessage ||
      "Riot API Key가 만료되었거나 유효하지 않습니다. 서버 환경변수를 확인해주세요.";
  }
  return serverMessage || "전적을 불러오는 중 문제가 발생했습니다.";
}

function renderPersonalAnalysis(data) {
  if (!data || data.isTftOnly) return;
  const analysis = analyzePlayerMatches(data);
  currentAnalysis = analysis;

  renderAnalysisSummary(analysis, data);
  renderPlaystyle(analysis);
  renderMatchHighlights(analysis, data);
  renderChampionPerformance(analysis, data);
  renderRecommendedPicks(analysis, data);
  renderPositionPerformance(analysis);
  renderRecentTrends(analysis);
  renderImprovementTips(analysis);

  if (!data.isDemo) loadPersonalTierStats(analysis, data);
}

function analyzePlayerMatches(data) {
  const selected = data.matches.filter((match) => activeFilter === "all" || getQueueType(match.info.queueId).category === activeFilter);
  const games = selected.filter((match) => !isEarlyEnd(match)).map((match, index) => {
    const player = getCurrentParticipant(match, data.account);

    if (!player) {
      console.warn("Current participant not found", {
        matchId: match?.metadata?.matchId,
        gameName: data?.account?.gameName
      });
      return null;
    }

    const teammates = match.info.participants.filter(
      (participant) => participant.teamId === player.teamId
    );

    const teamKills = teammates.reduce((total, participant) => total + (participant.kills || 0), 0);
    const durationMinutes = Math.max(match.info.gameDuration / 60, 1);
    const cs = (player.totalMinionsKilled || 0) + (player.neutralMinionsKilled || 0);
    const kda = ((player.kills || 0) + (player.assists || 0)) / Math.max(player.deaths || 0, 1);
    const killParticipation = teamKills
      ? Math.min(100, (((player.kills || 0) + (player.assists || 0)) / teamKills) * 100)
      : 0;
    const position = normalizePlayerPosition(player.teamPosition || player.individualPosition);

    return {
      index,
      match,
      player,
      win: Boolean(player.win),
      championName: player.championName,
      position,
      kills: player.kills || 0,
      deaths: player.deaths || 0,
      assists: player.assists || 0,
      kda,
      killParticipation,
      cs,
      csPerMinute: cs / durationMinutes,
      visionScore: player.visionScore || 0,
      visionPerMinute: (player.visionScore || 0) / durationMinutes,
      damage: player.totalDamageDealtToChampions || 0,
      damagePerMinute: (player.totalDamageDealtToChampions || 0) / durationMinutes,
      gold: player.goldEarned || 0,
      duration: match.info.gameDuration
    };
  }).filter(Boolean);

  const count = games.length;

  const averages = {
    winRate: count ? (games.filter((game) => game.win).length / count) * 100 : 0,
    kda: avg(games, "kda"),
    kills: avg(games, "kills"),
    deaths: avg(games, "deaths"),
    assists: avg(games, "assists"),
    killParticipation: avg(games, "killParticipation"),
    cs: avg(games, "cs"),
    csPerMinute: avg(games, "csPerMinute"),
    visionScore: avg(games, "visionScore"),
    damage: avg(games, "damage"),
    gold: avg(games, "gold")
  };

  const championStats = aggregatePersonalStats(games, "championName");
  const positionStats = aggregatePersonalStats(games, "position");
  const mostChampion = championStats[0]?.name || "-";
  const mainPosition = positionStats[0]?.name || "-";
  const comparable = games.filter((game) => [400, 420, 430, 440, 490].includes(game.match.info.queueId) && game.position !== "UNKNOWN");
  const comparisonAverages = Object.fromEntries(Object.keys(averages).map((key) => [key, avg(comparable, key)]));
  comparisonAverages.winRate = comparable.length ? comparable.filter((game) => game.win).length / comparable.length * 100 : 0;
  comparisonAverages.visionPerMinute = avg(comparable, "visionPerMinute");
  comparisonAverages.damagePerMinute = avg(comparable, "damagePerMinute");
  const comparisonPosition = aggregatePersonalStats(comparable, "position")[0]?.name || "UNKNOWN";
  const enough = comparable.length >= 5;

  return {
    games,
    count,
    averages,
    championStats,
    positionStats,
    mostChampion,
    mainPosition,
    selectedCount: selected.length,
    excludedCount: selected.length - games.length,
    comparisonCount: comparable.length,
    recommendationStats: aggregatePersonalStats(comparable.filter((game) => game.position === comparisonPosition), "championName"),
    playstyle: enough ? classifyPlaystyle(comparisonAverages) : {
      type: "분석 표본 부족",
      description: "같은 필터의 소환사의 협곡 기록이 5경기 이상일 때 플레이 경향을 분석합니다.",
      metrics: [["비교 가능한 경기", `${comparable.length}경기`], ["최소 표본", "5경기"]]
    },
    bestMatch: selectHighlight(games, true),
    worstMatch: selectHighlight(games, false),
    tips: enough ? createImprovementTips(comparisonAverages, comparisonPosition) : ["충분한 소환사의 협곡 기록이 쌓인 후 개선 포인트를 제공합니다."]
  };
}

function aggregatePersonalStats(games, key) {
  const groups = new Map();

  for (const game of games) {
    const name = game[key] || "UNKNOWN";

    const group = groups.get(name) || {
      name,
      games: 0,
      wins: 0,
      kda: 0,
      csPerMinute: 0,
      damage: 0,
      visionScore: 0,
      deaths: 0,
      positions: {}
    };

    group.games += 1;
    group.wins += game.win ? 1 : 0;
    group.kda += game.kda;
    group.csPerMinute += game.csPerMinute;
    group.damage += game.damage;
    group.visionScore += game.visionScore;
    group.deaths += game.deaths;
    group.positions[game.position] = (group.positions[game.position] || 0) + 1;

    groups.set(name, group);
  }

  return [...groups.values()].map((group) => ({
    name: group.name,
    games: group.games,
    winRate: (group.wins / group.games) * 100,
    avgKDA: group.kda / group.games,
    avgCSPerMinute: group.csPerMinute / group.games,
    avgDamage: group.damage / group.games,
    avgVisionScore: group.visionScore / group.games,
    avgDeaths: group.deaths / group.games,
    primaryPosition: Object.entries(group.positions)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || "UNKNOWN"
  })).sort((a, b) => b.games - a.games || b.winRate - a.winRate);
}

function classifyPlaystyle(averages) {
  if (averages.visionPerMinute >= 1.5) {
    return {
      type: "시야·지원 중심",
      description: "시야 확보와 팀 지원에 강점을 보이는 플레이 스타일입니다.",
      metrics: [
        ["평균 시야", averages.visionScore.toFixed(1)],
        ["킬 관여율", `${averages.killParticipation.toFixed(0)}%`],
        ["평균 어시스트", averages.assists.toFixed(1)]
      ]
    };
  }

  if (averages.killParticipation >= 65 && averages.damagePerMinute >= 700) {
    return {
      type: "교전·피해량 중심",
      description: "교전에 적극적으로 참여하며 높은 피해량으로 흐름을 만드는 스타일입니다.",
      metrics: [
        ["킬 관여율", `${averages.killParticipation.toFixed(0)}%`],
        ["평균 딜량", number(Math.round(averages.damage))],
        ["평균 KDA", averages.kda.toFixed(2)]
      ]
    };
  }

  if (averages.csPerMinute >= 7 && averages.deaths <= 4.5) {
    return {
      type: "안정적인 성장 중심",
      description: "안정적인 성장과 자원 수급을 우선하는 플레이 스타일입니다.",
      metrics: [
        ["평균 CS/분", averages.csPerMinute.toFixed(1)],
        ["평균 데스", averages.deaths.toFixed(1)],
        ["평균 골드", number(Math.round(averages.gold))]
      ]
    };
  }

  if (averages.assists >= averages.kills * 1.4 && averages.killParticipation >= 55) {
    return {
      type: "팀 교전 중심",
      description: "팀 교전 합류와 연계 플레이에서 기여도가 높은 스타일입니다.",
      metrics: [
        ["평균 어시스트", averages.assists.toFixed(1)],
        ["킬 관여율", `${averages.killParticipation.toFixed(0)}%`],
        ["평균 KDA", averages.kda.toFixed(2)]
      ]
    };
  }

  if (
    averages.kda >= 3 &&
    averages.csPerMinute >= 6 &&
    averages.killParticipation >= 50 &&
    averages.damagePerMinute >= 500
  ) {
    return {
      type: "균형 잡힌 플레이",
      description: "성장, 교전, 팀 기여가 고르게 나타나는 균형 잡힌 스타일입니다.",
      metrics: [
        ["평균 KDA", averages.kda.toFixed(2)],
        ["평균 CS/분", averages.csPerMinute.toFixed(1)],
        ["킬 관여율", `${averages.killParticipation.toFixed(0)}%`]
      ]
    };
  }

  return {
    type: "뚜렷한 경향 없음",
    description: "최근 지표만으로 특정 플레이 경향을 판단하기 어렵습니다.",
    metrics: [
      ["최근 승률", `${averages.winRate.toFixed(0)}%`],
      ["평균 골드", number(Math.round(averages.gold))],
      ["평균 데스", averages.deaths.toFixed(1)]
    ]
  };
}

function selectHighlight(games, best) {
  if (!games.length) return null;

  const scored = games.map((game) => {
    const score =
      (game.win ? 35 : -25) +
      Math.min(game.kda * 8, 32) +
      game.killParticipation * 0.25 +
      Math.min(game.damage / 1200, 25) -
      game.deaths * 3;

    return { ...game, highlightScore: score };
  });

  return scored.sort((a, b) =>
    best ? b.highlightScore - a.highlightScore : a.highlightScore - b.highlightScore
  )[0];
}

function createImprovementTips(averages, position) {
  const tips = [];

  if (averages.deaths >= 6) {
    tips.push("데스가 많은 편이라 교전 전 시야 확보와 포지션 조절을 조금 더 의식하면 좋아요.");
  }
  if (position !== "SUPPORT" && averages.csPerMinute < 5.5) {
    tips.push(`평균 CS/분 ${averages.csPerMinute.toFixed(1)}입니다. 성장 흐름과 자원 수급 타이밍을 점검해보세요.`);
  }
  if (averages.visionPerMinute < (position === "SUPPORT" ? 1.2 : .5)) {
    tips.push(`평균 시야/분 ${averages.visionPerMinute.toFixed(1)}입니다. 와드 배치와 시야 제거 타이밍을 점검해보세요.`);
  }
  if (averages.killParticipation < 45) {
    tips.push("팀 교전 참여율이 낮은 편이라 오브젝트 타이밍의 합류를 의식해보세요.");
  }
  if (averages.winRate >= 60) {
    tips.push("최근 승률이 좋은 편이라 현재 플레이 흐름이 안정적으로 이어지고 있어요.");
  }
  if (averages.kda >= 4) {
    tips.push("최근 KDA가 안정적입니다. 현재의 생존 중심 판단을 유지해보세요.");
  }
  if (!tips.length) {
    tips.push("주요 지표가 비교적 균형적입니다. 자주 플레이한 포지션의 강점을 더 발전시켜보세요.");
  }

  return tips.slice(0, 3);
}

function renderAnalysisSummary(analysis, data) {
  document.querySelector("#analysis-summary-title").textContent = activeFilter === "all" ? "전체 경기 요약" : `${document.querySelector(`.filter-tabs button[data-filter="${activeFilter}"]`).dataset.label || "선택한 경기"} 요약`;
  document.querySelector("#analysis-scope").textContent = `${analysis.count}경기 기준${analysis.excludedCount ? ` · 다시하기·조기 종료 ${analysis.excludedCount}경기 제외` : ""}`;
  const cards = [
    ["최근 승률", `${analysis.averages.winRate.toFixed(0)}%`],
    ["평균 KDA", analysis.averages.kda.toFixed(2)],
    ["평균 킬 관여율", `${analysis.averages.killParticipation.toFixed(0)}%`],
    ["평균 CS/분", analysis.averages.csPerMinute.toFixed(1)],
    ["주 포지션", positionLabel(analysis.mainPosition)]
  ];

  document.querySelector("#analysis-summary").innerHTML = cards.map(([label, value]) => `
    <article class="analysis-stat-card">
      <span>${label}</span>
      <strong>${analysis.count ? escapeHtml(value) : "-"}</strong>
    </article>
  `).join("");
}

function renderPlaystyle(analysis) {
  const style = analysis.playstyle;

  document.querySelector("#playstyle-analysis").innerHTML = `
    <article class="playstyle-card">
      <div>
        <span>협곡 ${analysis.comparisonCount}경기 · 규칙 기반 참고 분석</span>
        <h3>${escapeHtml(style.type)}</h3>
        <p>${escapeHtml(style.description)}</p>
      </div>
      <div class="playstyle-metrics">
        ${style.metrics.map(([label, value]) => `
          <div><strong>${escapeHtml(value)}</strong><span>${label}</span></div>
        `).join("")}
      </div>
    </article>
  `;
}

function renderMatchHighlights(analysis, data) {
  const highlights = [
    ["BEST GAME", analysis.bestMatch, "높은 킬 관여율과 안정적인 KDA가 돋보인 경기입니다."],
    ["TOUGH GAME", analysis.worstMatch, "성장 흐름이 다소 끊겼지만 다음 경기에서 보완점을 찾을 수 있는 경기입니다."]
  ];

  document.querySelector("#match-highlights").innerHTML = highlights.map(([label, game, text]) => {
    if (!game) return "";

    return `
      <article class="highlight-card ${label === "BEST GAME" ? "best" : "tough"}">
        <span>${label}</span>
        <div class="highlight-champion">
          <img src="${championImage(data.ddragonVersion, game.championName)}" width="54" height="54" alt="${escapeHtml(game.championName)}">
          <div>
            <strong>${championDisplayName(data, game.championName)}</strong>
            <small>${game.win ? "승리" : "패배"} · ${positionLabel(game.position)}</small>
          </div>
        </div>
        <div class="highlight-kda">${game.kills} / ${game.deaths} / ${game.assists}<small>${game.kda.toFixed(2)} KDA · ${formatDuration(game.duration)}</small></div>
        <p>${text}</p>
      </article>
    `;
  }).join("");
}

function renderChampionPerformance(analysis, data) {
  if (!analysis || !data) return;

  const visibleStats = championPerformanceExpanded
    ? analysis.championStats
    : analysis.championStats.slice(0, 5);

  document.querySelector("#champion-performance").innerHTML = visibleStats.map((stat) => {
    const tier = personalTierStats.get(`${stat.name}:${stat.primaryPosition}`);

    return `
      <article class="personal-performance-card">
        <div class="performance-identity">
          <img src="${championImage(data.ddragonVersion, stat.name)}" width="46" height="46" alt="${escapeHtml(stat.name)}">
          <div><strong>${championDisplayName(data, stat.name)}</strong><span>${stat.games}경기 · ${positionLabel(stat.primaryPosition)}</span></div>
          <small class="personal-tag">${championPerformanceTag(stat)}</small>
        </div>
        <div class="personal-metrics">
          <div><strong>${stat.winRate.toFixed(0)}%</strong><span>승률</span></div>
          <div><strong>${stat.avgKDA.toFixed(2)}</strong><span>평균 KDA</span></div>
          <div><strong>${stat.avgCSPerMinute.toFixed(1)}</strong><span>CS/분</span></div>
          <div><strong>${number(Math.round(stat.avgDamage))}</strong><span>평균 딜량</span></div>
          <div><strong>${stat.avgVisionScore.toFixed(1)}</strong><span>시야</span></div>
        </div>
        <div class="personal-tier-link ${tier ? "" : "unavailable"}">
          ${tier ? `
            <span>수집 표본 티어</span>
            <strong>${tier.tierGrade === "N/A" ? "—" : tier.tierGrade}</strong>
            <small>점수 ${tier.tierScore.toFixed(1)} · ${tier.position}</small>
          ` : `
            <span>수집 표본 티어</span>
            <strong>—</strong>
            <small>현재 패치 표본 부족</small>
          `}
        </div>
      </article>
    `;
  }).join("");

  championPerformanceToggle.hidden = analysis.championStats.length <= 5;
  championPerformanceToggle.textContent = championPerformanceExpanded ? "접기" : "전체 보기";
}

async function loadPersonalTierStats(analysis, data) {
  const positions = [...new Set(
    analysis.championStats
      .map((stat) => stat.primaryPosition)
      .filter((position) => position !== "UNKNOWN")
  )];

  try {
    const responses = await Promise.all(
      positions.map(async (position) => {
        const response = await fetch(`/api/champion-stats?position=${position}`);
        if (!response.ok) return [position, []];
        const payload = await response.json();
        return [position, payload.champions || []];
      })
    );

    if (currentData !== data || currentAnalysis !== analysis) return;
    personalTierStats = new Map();

    for (const [position, rows] of responses) {
      for (const row of rows) {
        personalTierStats.set(`${row.championAssetId}:${position}`, {
          tierGrade: row.tierGrade,
          tierScore: row.tierScore,
          position
        });
      }
    }

    if (currentData === data) renderChampionPerformance(analysis, data);
  } catch {
    // Tier data is optional; personal performance remains available.
  }
}

function renderRecommendedPicks(analysis, data) {
  const eligible = analysis.recommendationStats.filter((stat) => stat.games >= 3);
  const maxDamage = Math.max(...eligible.map((stat) => stat.avgDamage), 1);

  const picks = eligible.map((stat) => {
    const winRateScore = stat.winRate;
    const kdaScore = Math.min((stat.avgKDA / 5) * 100, 100);
    const damageScore = Math.min((stat.avgDamage / maxDamage) * 100, 100);
    const deathControlScore = Math.max(0, 100 - stat.avgDeaths * 12);
    const sampleScore = Math.min((stat.games / 5) * 100, 100);

    return {
      ...stat,
      recommendScore:
        winRateScore * 0.4 +
        kdaScore * 0.25 +
        damageScore * 0.15 +
        deathControlScore * 0.1 +
        sampleScore * 0.1
    };
  }).sort((a, b) => b.recommendScore - a.recommendScore).slice(0, 3);

  document.querySelector("#recommended-picks").innerHTML = picks.length
    ? picks.map((pick, index) => `
      <article class="recommended-card">
        <span class="recommended-rank">0${index + 1}</span>
        <img src="${championImage(data.ddragonVersion, pick.name)}" width="58" height="58" alt="${escapeHtml(pick.name)}">
        <div>
          <strong>${championDisplayName(data, pick.name)}</strong>
          <small>${pick.games}경기 · 승률 ${pick.winRate.toFixed(0)}% · ${pick.avgKDA.toFixed(2)} KDA</small>
        </div>
        <p>${recommendedReason(pick)}</p>
        ${pick.games < 3 ? '<b>Low Sample</b>' : ""}
      </article>
    `).join("")
    : '<p class="analysis-empty">주 포지션에서 챔피언별 3경기 이상 플레이하면 추천을 제공합니다.</p>';
}

function recommendedReason(pick) {
  if (pick.games < 3 && pick.winRate >= 50) {
    return "표본은 적지만 최근 경기 성과가 좋습니다.";
  }
  if (pick.winRate >= 60 && pick.avgKDA >= 3) {
    return "최근 승률이 높고 KDA가 안정적입니다.";
  }
  if (pick.avgDamage >= 20000) {
    return "딜량 기여도가 높게 나타났습니다.";
  }
  return "최근 경기에서 비교적 균형 잡힌 성과를 기록했습니다.";
}

function renderPositionPerformance(analysis) {
  const statsByPosition = new Map(analysis.positionStats.map((stat) => [stat.name, stat]));
  const positions = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];

  document.querySelector("#position-performance").innerHTML = positions.map((position) => {
    const stat = statsByPosition.get(position);

    return `
      <article class="position-card ${stat ? "played" : "empty"}">
        <strong>${positionLabel(position)}</strong>
        ${stat ? `
          <span>${stat.games}경기 · 승률 ${stat.winRate.toFixed(0)}%</span>
          <div><b>${stat.avgKDA.toFixed(2)}</b><small>KDA</small></div>
          <div><b>${stat.avgCSPerMinute.toFixed(1)}</b><small>CS/분</small></div>
          <div><b>${number(Math.round(stat.avgDamage))}</b><small>딜량</small></div>
        ` : '<span>플레이 기록 없음</span>'}
      </article>
    `;
  }).join("");
}

function renderRecentTrends(analysis) {
  const chronological = [...analysis.games].reverse();
  const maxKda = Math.max(...analysis.games.map((game) => game.kda), 1);
  const maxCs = Math.max(...analysis.games.map((game) => game.csPerMinute), 1);

  document.querySelector("#recent-trends").innerHTML = `
    <div class="trend-row">
      <span>승패</span>
      <div class="result-trend">${chronological.map((game) => `<b class="${game.win ? "win" : "loss"}">${game.win ? "W" : "L"}</b>`).join("")}</div>
    </div>
    <div class="trend-row">
      <span>KDA</span>
      <div class="bar-trend">${chronological.map((game) => `<i style="height:${Math.max(8, (game.kda / maxKda) * 100)}%" title="${game.kda.toFixed(2)} KDA"></i>`).join("")}</div>
    </div>
    <div class="trend-row">
      <span>CS/분</span>
      <div class="bar-trend cs">${chronological.map((game) => `<i style="height:${Math.max(8, (game.csPerMinute / maxCs) * 100)}%" title="${game.csPerMinute.toFixed(1)} CS/분"></i>`).join("")}</div>
    </div>
    <p class="scope-note">과거 → 최근 · ${analysis.count}경기</p>
  `;
}

function renderImprovementTips(analysis) {
  document.querySelector("#improvement-tips").innerHTML = analysis.tips.map((tip, index) => `
    <article><strong>0${index + 1}</strong><p>${escapeHtml(tip)}</p><span>협곡 ${analysis.comparisonCount}경기 기준 · 참고 의견</span></article>
  `).join("");
}

function championPerformanceTag(stat) {
  if (stat.games < 3) return "표본 부족";
  if (stat.winRate >= 60) return "높은 승률";
  if (stat.avgKDA >= 4) return "높은 KDA";
  if (stat.winRate < 40) return "낮은 승률";
  if (stat.avgDeaths <= 4 && stat.avgKDA >= 2.5) return "안정적";
  return "성장 중";
}

function normalizePlayerPosition(position) {
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
  return positions[String(position || "").toUpperCase()] || "UNKNOWN";
}

function positionLabel(position) {
  const labels = {
    TOP: "탑",
    JUNGLE: "정글",
    MID: "미드",
    ADC: "원거리 딜러",
    SUPPORT: "서포터",
    UNKNOWN: "미확인"
  };
  return labels[position] || position;
}

function championDisplayName(data, championId) {
  const champion = Object.values(data.staticData?.champions || {}).find(
    (entry) => entry.id === championId
  );
  return champion?.name || championId;
}

function avg(items, key) {
  return items.length
    ? items.reduce((total, item) => total + (Number(item[key]) || 0), 0) / items.length
    : 0;
}

function renderRank(entries) {
  const container = document.querySelector("#profile-ranks");
  const queues = [
    ["솔로 랭크", "RANKED_SOLO_5x5"],
    ["자유 랭크", "RANKED_FLEX_SR"]
  ];

  container.innerHTML = queues.map(([label, queueType]) => {
    const entry = entries.find((rank) => rank.queueType === queueType);
    if (!entry) {
      return `
        <article class="profile-rank-card unranked-card">
          <span>${label}</span>
          <strong>${currentData?.rankWarning ? "조회 지연" : "Unranked"}</strong>
          <small>${currentData?.rankWarning ? "잠시 후 다시 조회해 주세요" : "이번 시즌 기록 없음"}</small>
        </article>
      `;
    }

    const total = entry.wins + entry.losses;
    const winRate = total ? Math.round((entry.wins / total) * 100) : 0;
    const tierLabel = `${capitalize(entry.tier)} ${entry.rank}`;
    const tierImage = `/assets/ranked/${entry.tier.toLowerCase()}.png`;

    return `
      <article class="profile-rank-card">
        <span class="profile-rank-label">${label}</span>
        <div class="profile-rank-main">
          <span
            class="profile-tier-emblem"
            role="img"
            aria-label="${escapeHtml(tierLabel)} 엠블럼"
            style="background-image:url('${tierImage}')"
          ></span>
          <div>
            <strong>${escapeHtml(tierLabel)}</strong>
            <small>${number(entry.leaguePoints)} LP</small>
            <p>${number(entry.wins)}승 ${number(entry.losses)}패 · 승률 ${winRate}%</p>
            ${rankChangeNote(queueType)}
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function rankChangeNote(queueType) {
  const tracking = currentData?.rankTracking?.[queueType];
  if (!tracking || tracking.status !== "tracked") return "";
  const since = new Date(tracking.previousUpdatedAt).toLocaleString("ko-KR");
  return `<p class="rank-change-note" title="${escapeHtml(since)} 조회와 비교">이전 조회 대비 ${tracking.delta > 0 ? "+" : ""}${number(tracking.delta)} LP <small>${escapeHtml(since)}</small></p>`;
}

function renderMasteries(data) {
  const container = document.querySelector("#profile-mastery-list");
  const masteries = (data.masteries || []).slice(0, 3);

  if (!masteries.length) {
    container.innerHTML = '<p class="profile-mastery-empty">숙련도 기록 없음</p>';
    return;
  }

  container.innerHTML = masteries.map((mastery) => {
    const champion = data.staticData?.champions?.[mastery.championId];
    if (!champion) return "";

    return `
      <div class="profile-mastery-item">
        <img src="${championImage(data.ddragonVersion, champion.id)}" width="38" height="38" alt="${escapeHtml(champion.name)}">
        <div>
          <strong>${escapeHtml(champion.name)}</strong>
          <span>${number(mastery.championPoints)}점</span>
        </div>
      </div>
    `;
  }).join("");
}

function renderMatches(data) {
  if (!data) return;

  updateMatchFilterCounts(data.matches);

  const filtered = data.matches.filter((match) => {
    const type = getQueueType(match.info.queueId);
    return activeFilter === "all" || type.category === activeFilter;
  });

  const visibleMatches = matchesExpanded ? filtered : filtered.slice(0, 10);

  emptyMatches.hidden = filtered.length > 0;
  matchList.innerHTML = visibleMatches.map((match) => matchCard(match, data)).join("");
  matchListToggle.hidden = filtered.length <= 10;
  matchListToggle.textContent = matchesExpanded ? "접기" : `더 보기 (${filtered.length - 10})`;

  matchList.querySelectorAll(".details-button").forEach((button) => {
    button.addEventListener("click", () => {
      const card = button.closest(".match-card");
      const isOpen = card.classList.toggle("open");
      button.setAttribute("aria-expanded", String(isOpen));
    });
  });

  matchList.querySelectorAll(".participant-search").forEach((button) => {
    button.addEventListener("click", () => {
      const riotId = button.dataset.riotId;
      if (!riotId) return;
      input.value = riotId;
      search(riotId);
    });
  });
}

function updateMatchFilterCounts(matches = []) {
  const counts = matches.reduce((total, match) => {
    const category = getQueueType(match.info.queueId).category;
    total.all += 1;
    total[category] = (total[category] || 0) + 1;
    return total;
  }, { all: 0, solo: 0, flex: 0, normal: 0, aram: 0 });

  document.querySelectorAll(".filter-tabs button").forEach((button) => {
    const filter = button.dataset.filter;
    if (!filter) return;
    button.dataset.label ||= button.textContent.trim();
    const count = counts[filter] || 0;
    button.setAttribute("aria-pressed", String(filter === activeFilter));
    button.innerHTML = `<span>${escapeHtml(button.dataset.label)}</span><b>${count}</b>`;
  });
}

function matchCard(match, data) {
  const player = getCurrentParticipant(match, data.account);
  if (!player) return "";

  const queue = getQueueType(match.info.queueId);
  const duration = formatDuration(match.info.gameDuration);
  const cs = (player.totalMinionsKilled || 0) + (player.neutralMinionsKilled || 0);
  const minutes = Math.max(match.info.gameDuration / 60, 1);
  const csPerMinute = (cs / minutes).toFixed(1);

  const totalTeamKills = match.info.participants
    .filter((participant) => participant.teamId === player.teamId)
    .reduce((total, participant) => total + (participant.kills || 0), 0);

  const killParticipation = totalTeamKills
    ? Math.min(100, Math.round(((player.kills + player.assists) / totalTeamKills) * 100))
    : 0;

  const kda = player.deaths
    ? ((player.kills + player.assists) / player.deaths).toFixed(2)
    : "Perfect";

  const result = isEarlyEnd(match) ? "조기 종료" : player.win ? "승리" : "패배";
  const resultClass = player.win ? "win" : "loss";
  const gameCreated = match.info.gameCreation || match.info.gameStartTimestamp;
  const lpBadge = renderLpTrackingBadge(match, data, queue);

  return `
    <article class="match-card ${resultClass}" data-category="${queue.category}">
      <div class="result-bar"></div>
      <div class="match-content">
        <div class="match-meta">
          <div class="match-result-line"><strong>${result}</strong>${lpBadge}</div>
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
            <span>${escapeHtml(championDisplayName(data, player.championName))} · ${kda} KDA</span>
          </div>
          <div class="build-row">
            <div class="rune-row">${renderRunes(player, data)}${renderSpells(player, data)}</div>
            <div class="item-row">${renderItems(player, data.ddragonVersion)}</div>
          </div>
        </div>
        <div class="performance">
          <div><strong>${number(cs)} (${csPerMinute})</strong><span>CS</span></div>
          <div><strong>${number(player.totalDamageDealtToChampions)}</strong><span>챔피언 피해량</span></div>
          <div><strong>${killParticipation}%</strong><span>킬 관여</span></div>
        </div>
        <button class="details-button" type="button" aria-label="참가자 상세 보기" aria-expanded="false">
          <span aria-hidden="true">⌄</span>
        </button>
      </div>
      <div class="match-details">
        <div class="match-analysis-detail">
          <div class="detail-champion">
            <img src="${championImage(data.ddragonVersion, player.championName)}" width="44" height="44" alt="${escapeHtml(player.championName)}">
            <div><strong>${championDisplayName(data, player.championName)}</strong><span>${positionLabel(normalizePlayerPosition(player.teamPosition || player.individualPosition))} · ${result}</span></div>
          </div>
          <div class="detail-metric-grid">
            <div><strong>${player.kills}/${player.deaths}/${player.assists}</strong><span>KDA</span></div>
            <div><strong>${killParticipation}%</strong><span>킬 관여율</span></div>
            <div><strong>${csPerMinute}</strong><span>CS/분</span></div>
            <div><strong>${number(player.totalDamageDealtToChampions)}</strong><span>챔피언 피해량</span></div>
            <div><strong>${number(player.visionScore)}</strong><span>시야 점수</span></div>
            <div><strong>${number(player.goldEarned)}</strong><span>획득 골드</span></div>
            <div><strong>${duration}</strong><span>게임 시간</span></div>
          </div>
          <div class="detail-items">${renderItems(player, data.ddragonVersion)}</div>
          <p>${matchAnalysisComment({
            deaths: player.deaths,
            kda: player.deaths ? (player.kills + player.assists) / player.deaths : player.kills + player.assists,
            killParticipation,
            csPerMinute: Number(csPerMinute),
            visionScore: player.visionScore || 0
           }, match, player)}</p>
        </div>
        ${renderTeams(match, data)}
      </div>
    </article>
  `;
}

function matchAnalysisComment(metrics, match, player) {
  if (isEarlyEnd(match)) return "조기 종료된 경기로 개인 요약과 플레이 경향 분석에서 제외합니다.";
  if (metrics.killParticipation >= 70) {
    return "높은 킬 관여율을 기록하며 팀 교전에 적극적으로 기여한 경기입니다.";
  }
  if (metrics.kda >= 4 && metrics.deaths <= 4) {
    return "안정적인 KDA와 생존 관리를 기록한 경기입니다.";
  }
  if (metrics.csPerMinute >= 7.5) {
    return "CS 수급이 좋아 안정적으로 성장한 경기입니다.";
  }
  if ([400, 420, 430, 440, 490].includes(match.info.queueId) && metrics.visionScore / Math.max(match.info.gameDuration / 60, 1) < .5) {
    return "시야 점수를 조금 더 높이면 오브젝트 교전 준비에 도움이 될 수 있습니다.";
  }
  if (metrics.deaths >= 7) {
    return "데스가 다소 많아 성장 흐름이 끊겼지만 교전 위치를 조절하면 더 안정적일 수 있습니다.";
  }
  return "주요 지표가 비교적 균형적으로 나타난 경기입니다.";
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
      ? `<img src="${ddragonUrl(version, `img/item/${itemId}.png`)}" alt="${escapeHtml(currentData?.staticData?.items?.[itemId]?.name || `아이템 ${itemId}`)}" title="${escapeHtml(currentData?.staticData?.items?.[itemId]?.name || `아이템 ${itemId}`)}" loading="lazy">`
      : '<span class="item-empty"></span>';
  }).join("");
}

function renderSpells(player, data) {
  return [player.summoner1Id, player.summoner2Id].map((id) => {
    const spell = data.staticData?.spells?.[id];
    return spell ? `<img class="spell-icon" src="${ddragonUrl(data.ddragonVersion, `img/spell/${spell.image}`)}" alt="${escapeHtml(spell.name)}" title="${escapeHtml(spell.name)}" loading="lazy">` : "";
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
      ${participants.map((participant) => {
        const riotId = participantRiotId(participant);
        const displayName = participant.riotIdGameName || participant.summonerName || "Unknown";
        return `
        <div class="participant ${isCurrentParticipant(participant, data.account) ? "current" : ""}">
          <img src="${championImage(data.ddragonVersion, participant.championName)}" alt="">
          ${riotId
            ? `<button class="participant-name participant-search" type="button" data-riot-id="${escapeHtml(riotId)}" title="${escapeHtml(`${riotId} 전적 검색`)}">${escapeHtml(displayName)}</button>`
            : `<span class="participant-name">${escapeHtml(displayName)}</span>`}
          <span class="participant-kda">${participant.kills}/${participant.deaths}/${participant.assists}</span>
          <div class="participant-metrics">
            <span>CS <b>${number((participant.totalMinionsKilled || 0) + (participant.neutralMinionsKilled || 0))}</b></span>
            <span>피해량 <b>${number(participant.totalDamageDealtToChampions)}</b></span>
            <span>시야 <b>${number(participant.visionScore)}</b></span>
          </div>
          <div class="participant-build item-row">${renderItems(participant, data.ddragonVersion)}</div>
        </div>
      `;
      }).join("")}
    </div>
  `;
}

function renderTftPlacementDistribution(matches) {
  if (!matches.length) return '<p class="tft-chart-empty">최근 경기 기록이 없습니다.</p>';
  const counts = Array.from({ length: 8 }, (_, index) =>
    matches.filter((match) => match.placement === index + 1).length
  );
  const max = Math.max(...counts, 1);

  return `
    <div class="tft-placement-bars">
      ${counts.map((count, index) => {
        const placement = index + 1;
        const height = Math.max(8, Math.round((count / max) * 48));
        return `
          <span class="${placement <= 4 ? "is-top4" : "is-bottom4"}">
            <b style="height:${height}px"></b>
            <em>${placement}</em>
            <small>${count}</small>
          </span>
        `;
      }).join("")}
    </div>
  `;
}

function participantRiotId(participant) {
  const gameName = String(participant?.riotIdGameName || participant?.gameName || "").trim();
  const tagLine = String(
    participant?.riotIdTagline
    || participant?.riotIdTagLine
    || participant?.tagLine
    || ""
  ).trim();
  return gameName && tagLine ? `${gameName}#${tagLine}` : "";
}

function getCurrentParticipant(match, account) {
  const participants = match?.info?.participants || [];
  return participants.find((participant) => isCurrentParticipant(participant, account)) || null;
}

function isCurrentParticipant(participant, account) {
  if (!participant || !account) return false;

  const accountPuuid = account.puuid;
  const resolvedPuuid = account.resolvedParticipantPuuid;
  const gameName = normalizeName(account.gameName);
  const tagLine = normalizeName(account.tagLine);

  if (accountPuuid && participant.puuid === accountPuuid) return true;
  if (resolvedPuuid && participant.puuid === resolvedPuuid) return true;

  const participantGameName = normalizeName(participant.riotIdGameName);
  const participantSummonerName = normalizeName(participant.summonerName);
  const participantTagLine = normalizeName(participant.riotIdTagline || participant.riotIdTagLine);

  if (gameName && participantGameName === gameName) {
    return !tagLine || !participantTagLine || participantTagLine === tagLine;
  }

  if (gameName && participantSummonerName === gameName) {
    return true;
  }

  return false;
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function updateRankSnapshots(data) {
  if (!data?.account?.puuid || data.isDemo || data.rankWarning) return {};

  const key = `rift-record-rank-snapshots:${data.account.puuid}`;
  let previous = {};

  try {
    previous = JSON.parse(storage.getItem(key) || "{}");
    if (!previous || typeof previous !== "object" || Array.isArray(previous)) previous = {};
  } catch {
    previous = {};
  }

  const current = {};
  const tracking = {};

  for (const entry of data.ranked || []) {
    if (!["RANKED_SOLO_5x5", "RANKED_FLEX_SR"].includes(entry.queueType)) continue;

    const snapshot = {
      puuid: data.account.puuid,
      queueType: entry.queueType,
      tier: entry.tier,
      rank: entry.rank,
      leaguePoints: Number(entry.leaguePoints || 0),
      wins: Number(entry.wins || 0),
      losses: Number(entry.losses || 0),
      updatedAt: data.updatedAt
    };
    const oldSnapshot = previous[entry.queueType];
    const comparable = oldSnapshot && snapshot.wins + snapshot.losses >= Number(oldSnapshot.wins || 0) + Number(oldSnapshot.losses || 0);
    if (comparable && oldSnapshot.updatedAt === data.updatedAt) {
      current[entry.queueType] = oldSnapshot;
      tracking[entry.queueType] = oldSnapshot.tracking || { status: "pending" };
      continue;
    }
    const delta = comparable
      ? rankSnapshotScore(snapshot) - rankSnapshotScore(oldSnapshot)
      : null;

    current[entry.queueType] = snapshot;
    tracking[entry.queueType] = {
      delta,
      status: comparable ? "tracked" : "pending",
      previousUpdatedAt: oldSnapshot?.updatedAt || null,
      latestMatchId: data.matches.find(
        (match) => getQueueType(match.info.queueId).queueType === entry.queueType
      )?.metadata?.matchId || null
    };
    current[entry.queueType].tracking = tracking[entry.queueType];
  }

  try {
    storage.setItem(key, JSON.stringify(current));
  } catch {
    // Rank tracking remains unavailable when storage is blocked.
  }

  return tracking;
}

function renderLpTrackingBadge(match, data, queue) {
  return "";
}

function saveRecentSearch(riotId) {
  const normalized = riotId.toLowerCase();
  const existing = getRecentSearches().filter((item) => item.toLowerCase() !== normalized);
  storage.setItem("rift-record-recent", JSON.stringify([riotId, ...existing].slice(0, 5)));
  renderRecentSearches();
}

function getRecentSearches() {
  try {
    const values = JSON.parse(storage.getItem("rift-record-recent") || "[]");
    return Array.isArray(values) ? values.filter((value) => typeof value === "string" && parseRiotId(value)).slice(0, 5) : [];
  } catch {
    return [];
  }
}

function renderRecentSearches() {
  const searches = getRecentSearches();
  recentSearches.hidden = searches.length === 0;
  clearRecentButton.hidden = searches.length === 0;

  recentList.innerHTML = searches.map((riotId) =>
    `<button type="button" data-riot-id="${escapeHtml(riotId)}">${escapeHtml(riotId)}</button>`
  ).join("");

  recentList.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => search(button.dataset.riotId));
  });
}

function getFavoriteSearches() {
  try {
    const values = JSON.parse(storage.getItem("rift-record-favorites") || "[]");
    return Array.isArray(values) ? values.filter((value) => typeof value === "string" && parseRiotId(value)).slice(0, 5) : [];
  } catch {
    return [];
  }
}

function toggleCurrentFavorite() {
  if (!currentData || currentData.isDemo || !currentRiotId) return;

  const normalized = currentRiotId.toLowerCase();
  const favorites = getFavoriteSearches();
  const exists = favorites.some((item) => item.toLowerCase() === normalized);

  const next = exists
    ? favorites.filter((item) => item.toLowerCase() !== normalized)
    : [currentRiotId, ...favorites.filter((item) => item.toLowerCase() !== normalized)].slice(0, 5);

  storage.setItem("rift-record-favorites", JSON.stringify(next));
  renderFavoriteSearches();
  updateFavoriteButton();
}

function updateFavoriteButton() {
  const disabled = !currentData || currentData.isDemo || !currentRiotId;

  const favorite = !disabled && getFavoriteSearches()
    .some((item) => item.toLowerCase() === currentRiotId.toLowerCase());

  favoriteButton.disabled = disabled;
  favoriteButton.textContent = favorite ? "★" : "☆";
  favoriteButton.classList.toggle("active", favorite);
  favoriteButton.title = favorite ? "즐겨찾기 해제" : "즐겨찾기 추가";
  favoriteButton.setAttribute("aria-label", favoriteButton.title);
}

function renderFavoriteSearches() {
  const favorites = getFavoriteSearches();
  favoriteSearches.hidden = favorites.length === 0;
  clearFavoriteButton.hidden = favorites.length === 0;

  favoriteList.innerHTML = favorites.map((riotId) =>
    `<button type="button" data-riot-id="${escapeHtml(riotId)}">${escapeHtml(riotId)}</button>`
  ).join("");

  favoriteList.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => search(button.dataset.riotId));
  });
}

function handleInitialQuery() {
  if (location.pathname === "/champions") return;

  const params = new URLSearchParams(location.search);
  setSearchGame(params.get("game"));

  if (params.get("demo") === "true") {
    showDemoData();
    return;
  }

  const riotId = params.get("riotId");
  const tag = params.get("tag");

  if (riotId && tag) {
    search(`${riotId}#${tag}`);
  }
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

function createDemoTftData(lolData) {
  const traits = ["별 수호자", "전략가", "기원자", "난동꾼", "결투가", "요새"];
  const units = ["아리", "럭스", "세라핀", "가렌", "이즈리얼", "리 신", "소나", "징크스"];
  const augments = ["판도라의 아이템", "보석 연꽃", "전투 마법사", "회복의 구", "단결된 의지"];
  const companion = { id: "demo-profile", name: "데모 전략가", imageUrl: null };
  const tftMatches = Array.from({ length: 10 }, (_, index) => ({
    matchId: `TFT_DEMO_${index + 1}`,
    gameDatetime: Date.now() - (index + 1) * 4 * 60 * 60 * 1000,
    gameLength: 1920 + index * 35,
    queueId: index % 4 === 0 ? 1090 : 1100,
    gameType: "standard",
    setNumber: 15,
    placement: [2, 5, 1, 4, 7, 3, 6, 2, 8, 4][index],
    level: [9, 8, 9, 8, 7, 9, 8, 9, 7, 8][index],
    lastRound: [36, 31, 38, 34, 27, 35, 30, 37, 25, 33][index],
    timeEliminated: 1780 + index * 28,
    companion,
    traits: [
      { id: `trait-${index}-main`, name: traits[index % traits.length], units: 6, style: 3, tier: 2 },
      { id: `trait-${index}-sub`, name: traits[(index + 2) % traits.length], units: 3, style: 1, tier: 1 }
    ],
    units: Array.from({ length: 7 }, (_, unitIndex) => ({
      id: `unit-${index}-${unitIndex}`,
      name: units[(index + unitIndex) % units.length],
      tier: unitIndex < 2 ? 2 : 1,
      rarity: unitIndex % 5,
      items: []
    })),
    augments: Array.from({ length: 3 }, (_, augmentIndex) =>
      ({ id: `augment-${index}-${augmentIndex}`, name: augments[(index + augmentIndex) % augments.length] })
    )
  }));
  tftMatches.forEach((match, matchIndex) => {
    match.participants = Array.from({ length: 8 }, (_, playerIndex) => {
      const placement = playerIndex + 1;
      return {
        name: playerIndex === match.placement - 1 ? `${lolData.account.gameName}#${lolData.account.tagLine}` : `TFT Player ${placement}#DEMO`,
        placement,
        level: Math.max(6, 9 - Math.floor(playerIndex / 2)),
        lastRound: Math.max(21, match.lastRound - Math.floor(playerIndex / 2)),
        timeEliminated: Math.max(620, match.timeEliminated - playerIndex * 80),
        goldLeft: (matchIndex + playerIndex) % 54,
        playersEliminated: playerIndex % 4,
        totalDamageToPlayers: 180 - playerIndex * 18,
        companion: playerIndex === match.placement - 1 ? companion : { id: `demo-companion-${playerIndex}`, name: `전략가 ${placement}`, imageUrl: null },
        traits: match.traits,
        units: match.units.slice(0, Math.max(4, 7 - Math.floor(playerIndex / 3))),
        isCurrentPlayer: playerIndex === match.placement - 1
      };
    });
  });
  const placements = tftMatches.map((match) => match.placement);
  const portraitIds = ["Ahri", "Lux", "Seraphine", "Garen", "Ezreal", "LeeSin", "Sona", "Jinx"];
  const unitAssets = {};
  for (const match of tftMatches) for (const unit of match.units) {
    unitAssets[unit.id.toLowerCase()] = { name: unit.name, imageUrl: championImage(lolData.ddragonVersion, portraitIds[units.indexOf(unit.name)]) };
  }
  companion.imageUrl = ddragonUrl(lolData.ddragonVersion, "img/profileicon/29.png");

  return {
    account: lolData.account,
    tftSummoner: {
      level: lolData.summoner.level,
      profileIconId: lolData.summoner.profileIconId
    },
    tftRank: {
      queueType: "RANKED_TFT",
      tier: "DIAMOND",
      rank: "IV",
      leaguePoints: 42,
      wins: 18,
      losses: 12,
      winRate: 60
    },
    tftMatches,
    tftStaticData: { units: unitAssets },
    tftSummary: {
      games: tftMatches.length,
      averagePlacement: placements.reduce((total, placement) => total + placement, 0) / placements.length,
      topFourRate: Math.round((placements.filter((placement) => placement <= 4).length / placements.length) * 100),
      firstPlaces: placements.filter((placement) => placement === 1).length,
      averageLevel: tftMatches.reduce((total, match) => total + match.level, 0) / tftMatches.length,
      mostTrait: "별 수호자",
      mostUnit: "아리"
    },
    updatedAt: new Date().toISOString()
  };
}

function createDemoData() {
  const version = "16.11.1";
  const puuid = "demo-player-puuid";

  const champions = [
    { id: "Ahri", name: "아리", key: 103 },
    { id: "LeeSin", name: "리 신", key: 64 },
    { id: "Ezreal", name: "이즈리얼", key: 81 },
    { id: "Ashe", name: "애쉬", key: 22 },
    { id: "Thresh", name: "쓰레쉬", key: 412 },
    { id: "Jinx", name: "징크스", key: 222 },
    { id: "Orianna", name: "오리아나", key: 61 },
    { id: "Caitlyn", name: "케이틀린", key: 51 }
  ];

  const matchChampions = ["Ahri", "LeeSin", "Ezreal", "Ashe", "Thresh", "Jinx", "Orianna", "Caitlyn"];

  const staticChampions = Object.fromEntries(
    champions.map((champion) => [
      String(champion.key),
      { id: champion.id, name: champion.name }
    ])
  );

  const matches = Array.from({ length: 15 }, (_, index) => {
    const championName = matchChampions[index % matchChampions.length];
    const win = index % 3 !== 2;

    const player = {
      puuid,
      teamId: 100,
      win,
      championId: champions.find((champion) => champion.id === championName).key,
      championName,
      champLevel: 14 + (index % 4),
      riotIdGameName: "Rift Record Demo",
      summonerName: "Rift Record Demo",
      teamPosition: ({ LeeSin: "JUNGLE", Ezreal: "BOTTOM", Ashe: "BOTTOM", Thresh: "UTILITY", Jinx: "BOTTOM", Caitlyn: "BOTTOM" })[championName] || "MIDDLE",
      individualPosition: "MIDDLE",
      kills: 4 + (index % 8),
      deaths: win ? 2 + (index % 3) : 5 + (index % 4),
      assists: 6 + (index % 10),
      totalMinionsKilled: 145 + index * 6,
      neutralMinionsKilled: index % 4 === 1 ? 92 : 8,
      totalDamageDealtToChampions: 16800 + index * 940,
      visionScore: 18 + (index % 7) * 3,
      goldEarned: 10800 + index * 360,
      item0: 6655,
      item1: 3020,
      item2: 3089,
      item3: 4645,
      item4: index > 7 ? 3135 : 0,
      item5: index > 11 ? 3157 : 0,
      item6: 3340,
      summoner1Id: 4,
      summoner2Id: 14,
      perks: {
        styles: [
          { style: 8100, selections: [{ perk: 8112 }] },
          { style: 8200, selections: [{ perk: 8210 }] }
        ]
      }
    };

    const allies = [
      ["Garen", "Top Sample", "TOP"],
      ["Vi", "Jungle Sample", "JUNGLE"],
      ["Jinx", "ADC Sample", "BOTTOM"],
      ["Nami", "Support Sample", "UTILITY"]
    ].map(([name, playerName, position], allyIndex) =>
      mockParticipant(100, name, playerName, position, win, allyIndex)
    );

    const enemies = [
      ["Darius", "Opponent Top", "TOP"],
      ["Viego", "Opponent Jungle", "JUNGLE"],
      ["Syndra", "Opponent Mid", "MIDDLE"],
      ["Caitlyn", "Opponent ADC", "BOTTOM"],
      ["Leona", "Opponent Support", "UTILITY"]
    ].map(([name, playerName, position], enemyIndex) =>
      mockParticipant(200, name, playerName, position, !win, enemyIndex + 4)
    );

    return {
      metadata: { matchId: `DEMO_${index + 1}` },
      info: {
        queueId: [420, 440, 430, 490, 450][index % 5],
        gameCreation: Date.now() - (index + 1) * 3 * 60 * 60 * 1000,
        gameStartTimestamp: Date.now() - (index + 1) * 3 * 60 * 60 * 1000,
        gameDuration: 1540 + index * 42,
        participants: [player, ...allies, ...enemies]
      }
    };
  });

  return {
    isDemo: true,
    account: { gameName: "Rift Record Demo", tagLine: "DEMO", puuid },
    summoner: { level: 248, profileIconId: 29 },
    ranked: [
      {
        queueType: "RANKED_SOLO_5x5",
        tier: "EMERALD",
        rank: "II",
        leaguePoints: 62,
        wins: 84,
        losses: 69
      },
      {
        queueType: "RANKED_FLEX_SR",
        tier: "PLATINUM",
        rank: "I",
        leaguePoints: 28,
        wins: 31,
        losses: 25
      }
    ],
    masteries: champions.map((champion, index) => ({
      championId: champion.key,
      championLevel: 7,
      championPoints: 284000 - index * 41000
    })),
    matches,
    staticData: {
      champions: staticChampions,
      items: { 6655: { name: "루덴의 동반자" }, 3020: { name: "마법사의 신발" }, 3089: { name: "라바돈의 죽음모자" }, 4645: { name: "그림자불꽃" }, 3340: { name: "투명 와드" }, 3135: { name: "공허의 지팡이" }, 3157: { name: "존야의 모래시계" }, 1055: { name: "도란의 검" }, 3006: { name: "광전사의 군화" } },
      spells: { 4: { name: "점멸", image: "SummonerFlash.png" }, 14: { name: "점화", image: "SummonerDot.png" } },
      runes: {
        8112: {
          name: "감전",
          icon: "perk-images/Styles/Domination/Electrocute/Electrocute.png"
        }
      },
      runeStyles: {
        8200: {
          name: "마법",
          icon: "perk-images/Styles/7202_Sorcery.png"
        }
      }
    },
    ddragonVersion: version,
    updatedAt: new Date().toISOString()
  };
}

function mockParticipant(teamId, championName, playerName, position, win, index) {
  return {
    puuid: `demo-${teamId}-${index}`,
    teamId,
    win,
    championId: 1,
    championName,
    champLevel: 15,
    riotIdGameName: playerName,
    summonerName: playerName,
    teamPosition: position,
    individualPosition: position,
    kills: 2 + (index % 5),
    deaths: 3 + (index % 4),
    assists: 4 + (index % 8),
    totalMinionsKilled: 120 + index * 9,
    neutralMinionsKilled: position === "JUNGLE" ? 95 : 4,
    totalDamageDealtToChampions: 12000 + index * 700,
    visionScore: 12 + index * 2,
    goldEarned: 9200 + index * 310,
    item0: 1055,
    item1: 3006,
    item2: 0,
    item3: 0,
    item4: 0,
    item5: 0,
    item6: 3340,
    perks: { styles: [] }
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
