const state = {
  players: [],
  champions: [],
  championById: new Map(),
  activeSeries: null,
  usedFromPreviousSets: new Set(),
  editingSetId: null,
  seriesSummaries: [],
  expandedSeriesId: null,
  expandedSeriesData: null,
  expandedMatchId: null,
  soloQueueOpen: false,
  flexQueueOpen: false,
  playerSearchQuery: '',
};

async function api(path, opts) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || `요청 실패 (${res.status})`);
  return data;
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${tab}`));
  if (tab === 'stats') loadStats();
}

init();
async function init() {
  state.champions = await api('/api/champions');
  state.championById = new Map(state.champions.map((c) => [c.championId, c]));
  await loadPlayers();
  await loadSeriesList();
  resetMatchDateToToday();
}

// 내전은 보통 그날 바로 기록하므로 날짜 입력을 매번 새로 고르지 않아도 되게 기본값을 오늘로 채워둠.
// toISOString()은 UTC 기준이라 자정 근처에 하루 밀릴 수 있어 로컬 타임존 기준으로 직접 조합.
function resetMatchDateToToday() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  document.getElementById('matchDateInput').value = `${yyyy}-${mm}-${dd}`;
}

function championLabel(id) {
  const c = state.championById.get(Number(id));
  return c ? c.name : `#${id}`;
}
function championImg(id) {
  const c = state.championById.get(Number(id));
  return c ? c.imageUrl : '';
}
function playerDisplay(p) {
  return p.displayName ? `${p.riotId} (${p.displayName})` : p.riotId;
}

const LANES = ['top', 'jungle', 'mid', 'adc', 'support'];
const LANE_LABEL = { top: '탑', jungle: '정글', mid: '미드', adc: '원딜', support: '서폿' };
// 라이엇 게임 클라이언트의 실제 포지션 아이콘(Data Dragon엔 없어서 Community Dragon 미러로 로드)
const LANE_ICON_URL = {
  top: 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/svg/position-top.svg',
  jungle: 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/svg/position-jungle.svg',
  mid: 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/svg/position-middle.svg',
  adc: 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/svg/position-bottom.svg',
  support: 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/svg/position-utility.svg',
};
function laneIconImg(lane) {
  return `<img class="lane-icon-img" src="${LANE_ICON_URL[lane] || ''}" alt="${LANE_LABEL[lane] || lane}" title="${LANE_LABEL[lane] || lane}">`;
}

// 솔로랭크 티어 엠블럼(Data Dragon엔 없어서 Community Dragon 미러로 로드)
function tierIconUrl(tier) {
  return tier ? `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-mini-crests/${tier.toLowerCase()}.svg` : null;
}

// ---- 참가자 관리 ----
async function loadPlayers() {
  state.players = await api('/api/players');
  renderPlayers();
}
// 인원이 늘어날 걸 대비해 정렬 기준을 바꾸는 대신(랭크순은 승급/강등마다 카드 위치가 흔들려서 오히려 헷갈림)
// 이름순 정렬은 그대로 유지하고 검색으로 원하는 사람을 바로 찾을 수 있게 함(클라이언트 필터, API 재호출 없음).
function renderPlayers() {
  const el = document.getElementById('playerList');
  const query = state.playerSearchQuery.trim().toLowerCase();
  const filtered = query
    ? state.players.filter((p) => p.riotId.toLowerCase().includes(query) || (p.displayName || '').toLowerCase().includes(query))
    : state.players;

  if (!state.players.length) {
    el.innerHTML = '<p class="muted">등록된 참가자가 없습니다.</p>';
    return;
  }
  if (!filtered.length) {
    el.innerHTML = `<p class="muted">"${query}"에 맞는 참가자가 없습니다.</p>`;
    return;
  }
  el.innerHTML = filtered.map((p) => `
    <div class="player-card" data-id="${p.id}">
      <div class="player-header">
        <div class="player-names">
          <strong class="player-riotid">${p.riotId}</strong>
          ${p.displayName ? `<span class="player-realname">${p.displayName}</span>` : ''}
        </div>
      </div>
      <div class="player-tier">
        ${p.tier ? `<img class="tier-icon" src="${tierIconUrl(p.tier)}" alt="${p.tier}">` : ''}
        <span class="tier-badge">${p.tier ? `${p.tier} ${p.rank || ''}`.trim() : '언랭 (솔로랭크)'}</span>
      </div>
      <div class="player-actions">
        <a class="opgg-btn" href="${p.opggUrl}" target="_blank" rel="noopener">op.gg</a>
        <button data-action="refresh" data-id="${p.id}">새로고침</button>
        <button data-action="delete" data-id="${p.id}">삭제</button>
      </div>
    </div>
  `).join('');
}

document.getElementById('playerSearchInput').addEventListener('input', (e) => {
  state.playerSearchQuery = e.target.value;
  renderPlayers();
});

function renderQueueChampionStats(stats, fetchedAt) {
  if (!stats) return '<p class="muted">불러오는 중...</p>';
  if (!stats.perChampion.length) return '<p class="muted">최근 기록이 없습니다.</p>';
  return `
    <p class="recent-stats-summary">${stats.totalGames}전 ${stats.totalWins}승 ${stats.totalLosses}패 · ${formatRelativeTime(fetchedAt)} 기준</p>
    ${renderChampionAggregateTable(stats.perChampion)}`;
}

function renderRankedQueueCard(label, tier, rank, lp, wins, losses, queueKey, playerId, cachedStats, cachedFetchedAt, isOpen) {
  if (!tier) {
    return `
      <div class="ranked-card">
        <div class="ranked-card-header">${label}</div>
        <div class="ranked-card-body ranked-unranked">랭크 정보 없음</div>
      </div>`;
  }
  const total = (wins || 0) + (losses || 0);
  const winRate = total ? Math.round((wins / total) * 100) : 0;
  return `
    <div class="ranked-card">
      <button type="button" class="ranked-card-header ranked-card-toggle" data-queue="${queueKey}" data-id="${playerId}">
        <span>${label}</span>
        <span class="ranked-toggle-hint">최근 ${RANKED_QUEUE_GAMES_COUNT}판 챔피언별 성적 ${isOpen ? '▲' : '▾'}</span>
      </button>
      <div class="ranked-card-body">
        <img class="ranked-emblem" src="${tierIconUrl(tier)}" alt="${tier}">
        <div class="ranked-card-info">
          <div class="ranked-tier-line">${tier} ${rank || ''}</div>
          <div class="ranked-lp-line">${lp ?? 0} LP</div>
        </div>
        <div class="ranked-record">
          <div class="ranked-wl">${wins ?? 0}W ${losses ?? 0}L</div>
          <div class="ranked-winrate">승률 ${winRate}%</div>
        </div>
      </div>
      ${isOpen ? `<div class="ranked-queue-detail" id="${queueKey}QueueDetail">${renderQueueChampionStats(cachedStats, cachedFetchedAt)}</div>` : ''}
    </div>`;
}

// 백엔드 lib/riot.js의 RECENT_GAMES_COUNT/RANKED_QUEUE_GAMES_COUNT와 값이 같아야 함(자동 동기화 안 됨, 바꿀 때 둘 다 고칠 것)
const RECENT_GAMES_COUNT = 10;
const RANKED_QUEUE_GAMES_COUNT = 20;

function formatRelativeTime(iso) {
  if (!iso) return '';
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return '방금';
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  return `${Math.round(diffHour / 24)}일 전`;
}

function renderChampionAggregateTable(perChampion) {
  return `
    <table class="recent-stats-table">
      <thead><tr><th>챔피언</th><th>전적</th><th>승률</th><th>KDA</th></tr></thead>
      <tbody>
        ${perChampion.map((c) => `
          <tr>
            <td><img class="recent-champ-icon" src="${championImg(c.championId)}" alt="${championLabel(c.championId)}">${championLabel(c.championId)}</td>
            <td>${c.games}전 ${c.wins}승 ${c.losses}패</td>
            <td>${c.winRate}%</td>
            <td>${c.kda === null ? 'Perfect' : `${c.kda}:1`}<br><span class="muted">${c.avgKills}/${c.avgDeaths}/${c.avgAssists}</span></td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function renderScoreRow(p, myRiotId) {
  const isMe = p.riotId === myRiotId;
  return `
    <div class="score-row ${p.win ? 'score-win' : 'score-loss'} ${isMe ? 'score-me' : ''}">
      <img class="score-champ-icon" src="${championImg(p.championId)}" alt="${championLabel(p.championId)}" title="${championLabel(p.championId)}">
      <span class="score-riotid">${p.riotId}</span>
      <span class="score-kda">${p.kills}/${p.deaths}/${p.assists}</span>
      <span class="score-cs">CS ${p.cs}</span>
    </div>`;
}

function renderMatchDetailPanel(g, myRiotId) {
  return `
    <div class="match-detail">
      <div class="match-detail-team">
        <div class="match-detail-team-label">우리팀</div>
        ${g.myTeam.map((p) => renderScoreRow(p, myRiotId)).join('')}
      </div>
      <div class="match-detail-team">
        <div class="match-detail-team-label">상대팀</div>
        ${g.enemyTeam.map((p) => renderScoreRow(p, myRiotId)).join('')}
      </div>
    </div>`;
}

function renderRecentMatchList(perGame, expandedMatchId, myRiotId) {
  if (!perGame || !perGame.length) return '<p class="muted">최근 경기가 없습니다.</p>';
  return `
    <div class="match-list">
      ${perGame.map((g) => `
        <div class="match-row ${g.win ? 'match-win' : 'match-loss'}" data-match-id="${g.matchId}">
          <img class="match-champ-icon" src="${championImg(g.championId)}" alt="${championLabel(g.championId)}">
          <div class="match-main">
            <div class="match-line1">
              <span class="match-result">${g.win ? '승리' : '패배'}</span>
              <span class="match-champ-name">${championLabel(g.championId)}</span>
              <span class="match-queue">${g.queueLabel}</span>
              <span class="match-time">${formatRelativeTime(g.gameEndTimestamp)}</span>
            </div>
            <div class="match-line2">
              <span class="match-kda">${g.kills}/${g.deaths}/${g.assists} <b>${g.kda === null ? 'Perfect' : `${g.kda}:1`}</b></span>
              <span class="match-cs">CS ${g.cs}</span>
              <span class="match-duration">${Math.round(g.gameDurationSec / 60)}분</span>
            </div>
            <div class="match-teams">
              <span class="match-team-icons">${g.myTeam.map((p) => `<img src="${championImg(p.championId)}" alt="${championLabel(p.championId)}" title="${championLabel(p.championId)}">`).join('')}</span>
              <span class="match-team-sep">vs</span>
              <span class="match-team-icons">${g.enemyTeam.map((p) => `<img src="${championImg(p.championId)}" alt="${championLabel(p.championId)}" title="${championLabel(p.championId)}">`).join('')}</span>
            </div>
          </div>
        </div>
        ${g.matchId === expandedMatchId ? renderMatchDetailPanel(g, myRiotId) : ''}`).join('')}
    </div>`;
}

function renderRecentStatsBody(stats, fetchedAt, myRiotId) {
  if (!stats) return '<p class="muted">아직 불러오지 않았습니다. API 호출량이 있어서 버튼을 눌러야 조회됩니다.</p>';
  return `
    <p class="recent-stats-summary">${stats.totalGames}전 ${stats.totalWins}승 ${stats.totalLosses}패 · ${formatRelativeTime(fetchedAt)} 기준 · 경기를 클릭하면 전체 스코어보드가 열려요</p>
    ${renderRecentMatchList(stats.perGame, state.expandedMatchId, myRiotId)}
    <details class="recent-stats-aggregate">
      <summary>챔피언별 요약</summary>
      ${renderChampionAggregateTable(stats.perChampion)}
    </details>`;
}

function renderPlayerDetailBody(p) {
  return `
    ${renderRankedQueueCard('솔로랭크', p.tier, p.rank, p.leaguePoints, p.wins, p.losses, 'solo', p.id, p.soloQueueStats, p.soloQueueStatsFetchedAt, state.soloQueueOpen)}
    ${renderRankedQueueCard('자유랭크', p.flexTier, p.flexRank, p.flexLeaguePoints, p.flexWins, p.flexLosses, 'flex', p.id, p.flexQueueStats, p.flexQueueStatsFetchedAt, state.flexQueueOpen)}
    <div class="mastery-card">
      <div class="ranked-card-header">숙련도 Top 3</div>
      <div class="mastery-list">
        ${p.topChampions.length ? p.topChampions.map((tc) => `
          <div class="mastery-row">
            <img class="mastery-champ-img" src="${championImg(tc.championId)}" alt="${championLabel(tc.championId)}">
            <div class="mastery-info">
              <div class="mastery-champ-name">${championLabel(tc.championId)}</div>
              <div class="mastery-points">Lv.${tc.championLevel} · ${tc.championPoints.toLocaleString()}점</div>
            </div>
          </div>`).join('') : '<p class="muted">숙련도 정보 없음</p>'}
      </div>
    </div>
    <div class="recent-stats-card">
      <div class="ranked-card-header recent-stats-header">
        <span>최근 ${RECENT_GAMES_COUNT}경기</span>
        <button type="button" id="recentStatsBtn" data-id="${p.id}">${p.recentStats ? '새로고침' : '불러오기'}</button>
      </div>
      <div class="recent-stats-body" id="recentStatsBody">${renderRecentStatsBody(p.recentStats, p.recentStatsFetchedAt, p.riotId)}</div>
    </div>
    <a class="opgg-btn player-detail-opgg" href="${p.opggUrl}" target="_blank" rel="noopener">op.gg에서 전체 전적 보기</a>
  `;
}

function openPlayerDetail(player) {
  state.expandedMatchId = null;
  state.soloQueueOpen = false;
  state.flexQueueOpen = false;
  document.getElementById('playerDetailTitle').textContent = playerDisplay(player);
  document.getElementById('playerDetailBody').innerHTML = renderPlayerDetailBody(player);
  document.getElementById('playerDetailModal').classList.remove('hidden');
}
function closePlayerDetail() {
  document.getElementById('playerDetailModal').classList.add('hidden');
}
document.getElementById('closePlayerDetail').addEventListener('click', closePlayerDetail);
document.getElementById('playerDetailBody').addEventListener('click', async (e) => {
  const queueToggle = e.target.closest('.ranked-card-toggle');
  if (queueToggle) {
    const queueKey = queueToggle.dataset.queue;
    const playerId = queueToggle.dataset.id;
    const openStateKey = queueKey === 'solo' ? 'soloQueueOpen' : 'flexQueueOpen';
    const statsKey = queueKey === 'solo' ? 'soloQueueStats' : 'flexQueueStats';
    const fetchedAtKey = queueKey === 'solo' ? 'soloQueueStatsFetchedAt' : 'flexQueueStatsFetchedAt';
    const player = state.players.find((p) => String(p.id) === playerId);
    if (!player) return;

    state[openStateKey] = !state[openStateKey];
    document.getElementById('playerDetailBody').innerHTML = renderPlayerDetailBody(player);

    if (state[openStateKey] && !player[statsKey]) {
      try {
        const result = await api(`/api/players/${playerId}/recent-stats?queue=${queueKey}`, { method: 'POST' });
        player[statsKey] = result.stats;
        player[fetchedAtKey] = result.fetchedAt;
        document.getElementById('playerDetailBody').innerHTML = renderPlayerDetailBody(player);
      } catch (err) {
        const detailEl = document.getElementById(`${queueKey}QueueDetail`);
        if (detailEl) detailEl.innerHTML = `<p class="error">${err.message}</p>`;
      }
    }
    return;
  }

  const matchRow = e.target.closest('.match-row');
  if (matchRow) {
    const matchId = matchRow.dataset.matchId;
    state.expandedMatchId = state.expandedMatchId === matchId ? null : matchId;
    const btn = document.getElementById('recentStatsBtn');
    const player = state.players.find((p) => String(p.id) === btn.dataset.id);
    if (player) {
      document.getElementById('recentStatsBody').innerHTML = renderRecentStatsBody(player.recentStats, player.recentStatsFetchedAt, player.riotId);
    }
    return;
  }

  const btn = e.target.closest('#recentStatsBtn');
  if (!btn) return;
  const id = btn.dataset.id;
  const isRefresh = btn.textContent === '새로고침';
  const bodyEl = document.getElementById('recentStatsBody');
  const player = state.players.find((p) => String(p.id) === id);
  btn.disabled = true;
  state.expandedMatchId = null;
  bodyEl.innerHTML = '<p class="muted">불러오는 중... (최근 경기를 하나씩 조회하고 있어요)</p>';
  try {
    const result = await api(`/api/players/${id}/recent-stats${isRefresh ? '?force=1' : ''}`, { method: 'POST' });
    bodyEl.innerHTML = renderRecentStatsBody(result.stats, result.fetchedAt, player ? player.riotId : null);
    btn.textContent = '새로고침';
    if (player) {
      player.recentStats = result.stats;
      player.recentStatsFetchedAt = result.fetchedAt;
    }
  } catch (err) {
    bodyEl.innerHTML = `<p class="error">${err.message}</p>`;
  } finally {
    btn.disabled = false;
  }
});
document.getElementById('playerDetailModal').addEventListener('click', (e) => {
  if (e.target.id === 'playerDetailModal') closePlayerDetail();
});

document.getElementById('playerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const gameName = document.getElementById('gameNameInput').value.trim();
  const tagLine = document.getElementById('tagLineInput').value.trim();
  const displayName = document.getElementById('displayNameInput').value.trim();
  const errEl = document.getElementById('playerFormError');
  errEl.textContent = '';
  try {
    await api('/api/players', { method: 'POST', body: JSON.stringify({ gameName, tagLine, displayName }) });
    e.target.reset();
    await loadPlayers();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById('playerList').addEventListener('click', async (e) => {
  const actionBtn = e.target.closest('button[data-action]');
  if (actionBtn) {
    const id = actionBtn.dataset.id;
    if (actionBtn.dataset.action === 'refresh') {
      actionBtn.disabled = true;
      try {
        await api(`/api/players/${id}/refresh`, { method: 'POST' });
        await loadPlayers();
      } catch (err) {
        alert(err.message);
      } finally {
        actionBtn.disabled = false;
      }
    } else if (actionBtn.dataset.action === 'delete') {
      if (!confirm('삭제할까요?')) return;
      await api(`/api/players/${id}`, { method: 'DELETE' });
      await loadPlayers();
    }
    return;
  }
  if (e.target.closest('a')) return; // op.gg 링크는 그냥 새 탭으로 이동
  const card = e.target.closest('.player-card');
  if (card) {
    const player = state.players.find((p) => String(p.id) === card.dataset.id);
    if (player) openPlayerDetail(player);
  }
});

// ---- 전적 기록 ----
// 날짜 입력 중 엔터를 치면(날짜 선택 후 습관적으로 누르는 경우가 많음) 브라우저 기본 동작으로
// 폼이 그냥 제출돼서 "새 시리즈 시작" 버튼을 안 눌러도 시리즈가 생기던 문제 — 버튼 자체에서
// 누른 엔터만 허용하고 나머지 입력 필드에서의 엔터는 막음.
document.getElementById('seriesForm').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
    e.preventDefault();
  }
});
document.getElementById('seriesForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const matchDate = document.getElementById('matchDateInput').value;
  const format = document.getElementById('formatInput').value;
  const series = await api('/api/series', { method: 'POST', body: JSON.stringify({ matchDate, format }) });
  state.activeSeries = await api(`/api/series/${series.id}`);
  await renderActiveSeries();
  await loadSeriesList();
  resetMatchDateToToday();
});

function laneMapFromLastSet(lastSet, roster) {
  const arr = lastSet.blueRoster === roster ? lastSet.blueTeam : lastSet.redTeam;
  return new Map(arr.map((p) => [p.lane, p]));
}

// 상단(#activeSeries)은 오직 "최초 입력"(아직 기록 안 된 다음 세트) 전용 — 이미 기록된 세트 수정은
// 전부 시리즈 목록(#seriesList) 쪽에서 그 시리즈가 펼쳐진 자리에 인라인으로 렌더됨(startEditingSet 참고).
async function renderActiveSeries() {
  const s = state.activeSeries;
  const el = document.getElementById('activeSeries');
  if (!s) { el.innerHTML = ''; return; }

  if (s.status === 'completed') {
    el.innerHTML = renderSeriesCard(s);
    return;
  }

  const nextSetNumber = s.sets.length + 1;
  state.usedFromPreviousSets = new Set(await api(`/api/series/${s.id}/used-champions?beforeSet=${nextSetNumber}`));

  let bluePlayers = null;
  let redPlayers = null;
  let blueDefaults = null;
  let redDefaults = null;
  if (nextSetNumber > 1) {
    const lastSet = s.sets[s.sets.length - 1];
    const blueRosterKey = lastSet.redRoster; // 매 세트 진영 스왑
    const redRosterKey = lastSet.blueRoster;
    bluePlayers = s.rosters[blueRosterKey];
    redPlayers = s.rosters[redRosterKey];
    blueDefaults = laneMapFromLastSet(lastSet, blueRosterKey);
    redDefaults = laneMapFromLastSet(lastSet, redRosterKey);
  }

  el.innerHTML = `
    ${renderSeriesCard(s)}
    <form id="setForm">
      <h4 class="set-form-title">
        ${nextSetNumber}세트 입력
        ${nextSetNumber === 1 ? '<button type="button" id="loadLastRosterBtn" class="load-roster-btn">지난 로스터 불러오기</button>' : ''}
      </h4>
      <div class="team-columns">
        ${renderTeamInputs('blue', bluePlayers, blueDefaults)}
        ${renderTeamInputs('red', redPlayers, redDefaults)}
      </div>
      <div class="winner-pick">
        <label><input type="radio" name="winner" value="blue" required> 블루 승리</label>
        <label><input type="radio" name="winner" value="red"> 레드 승리</label>
      </div>
      <p class="error" id="setFormError"></p>
      <button type="submit">세트 기록 저장</button>
    </form>
  `;
  document.getElementById('setForm').addEventListener('submit', (e) => submitSet(e, s.id, null));
  if (nextSetNumber === 1) {
    document.getElementById('loadLastRosterBtn').addEventListener('click', () => loadLastRoster(s.id));
  }
  attachDragHandlers(el);
  updatePlayerSelectOptions(el);
}

// 매번 10명을 처음부터 고르지 않아도 되게, 가장 최근에 실제로 세트가 기록된(=로스터가 확정된)
// 다른 시리즈를 찾아서 그 세트1의 블루/레드 팀(선수+라인)을 그대로 채워줌. 챔피언은 시리즈마다
// 피어리스가 초기화되므로 일부러 안 채움(선수/라인만 재사용).
async function loadLastRoster(currentSeriesId) {
  const candidates = state.seriesSummaries.filter((s) => s.id !== currentSeriesId).slice(0, 20);
  for (const candidate of candidates) {
    const detail = await api(`/api/series/${candidate.id}`);
    const set1 = detail.sets.find((set) => set.setNumber === 1);
    if (!set1) continue;
    applyRosterToForm('blue', set1.blueTeam);
    applyRosterToForm('red', set1.redTeam);
    updatePlayerSelectOptions();
    return;
  }
  alert('불러올 이전 로스터가 없습니다.');
}
function applyRosterToForm(side, team) {
  const block = document.querySelector(`.team-block.${side}`);
  const byLane = new Map(team.map((p) => [p.lane, p]));
  block.querySelectorAll('.lane-row').forEach((row) => {
    const entry = byLane.get(row.dataset.lane);
    if (entry) row.querySelector('.player-select').value = entry.playerId;
  });
}

function laneMapFromParticipants(team) {
  return new Map(team.map((p) => [p.lane, p]));
}

function renderTeamInputs(side, allowedPlayers, laneDefaults, options = {}) {
  const { includeChampionDefaults = false, banDefaults = [], lockedLabel = '(로스터 고정, 라인은 드래그로 변경 가능)' } = options;
  // state.players 항목은 id, 로스터/세트 참가자 항목은 playerId 필드를 씀 — 여기서 id로 통일
  const pool = (allowedPlayers || state.players).map((p) => ({ id: p.id ?? p.playerId, riotId: p.riotId, displayName: p.displayName }));
  const playerOptionsHtml = (selectedId) => pool.map((p) =>
    `<option value="${p.id}" ${String(p.id) === String(selectedId) ? 'selected' : ''}>${playerDisplay(p)}</option>`).join('');

  const rows = LANES.map((lane) => {
    const entry = laneDefaults ? laneDefaults.get(lane) : null;
    const defaultPlayerId = entry ? entry.playerId : '';
    const defaultChampionId = includeChampionDefaults && entry ? entry.championId : null;
    return `
      <div class="lane-row" draggable="true" data-lane="${lane}">
        <span class="drag-handle" title="드래그해서 라인 교체">⠿</span>
        <span class="lane-icon">${laneIconImg(lane)}</span>
        <select class="player-select" required>
          <option value="">선수 선택</option>${playerOptionsHtml(defaultPlayerId)}
        </select>
        <button type="button" class="champion-slot" data-champion-id="${defaultChampionId || ''}">
          ${championSlotInnerHtml(defaultChampionId)}
        </button>
      </div>`;
  }).join('');

  // 밴은 항상 5슬롯 고정 — 각 슬롯은 실제 챔피언 또는 명시적 '없음'으로 결정해야 함
  const banSlotsHtml = Array.from({ length: 5 }, (_, i) => {
    const cid = banDefaults[i] || '';
    return `<button type="button" class="champion-slot ban-slot" data-champion-id="${cid}">${championSlotInnerHtml(cid, true)}</button>`;
  }).join('');

  return `
    <div class="team-block ${side}">
      <h4>${side === 'blue' ? '블루팀' : '레드팀'}${allowedPlayers ? ` <span class="muted small">${lockedLabel}</span>` : ''}</h4>
      ${rows}
      <div class="ban-section">
        <span class="ban-label">밴 (5개)</span>
        <span class="ban-slots">${banSlotsHtml}</span>
      </div>
    </div>`;
}

// ---- 드래그로 라인(선수+챔프) 교체 ----
let dragSourceRow = null;
function attachDragHandlers(container) {
  container.querySelectorAll('.lane-row').forEach((row) => {
    row.addEventListener('dragstart', () => {
      dragSourceRow = row;
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      container.querySelectorAll('.lane-row').forEach((r) => r.classList.remove('drag-over'));
      dragSourceRow = null;
    });
    row.addEventListener('dragover', (e) => {
      if (!dragSourceRow || dragSourceRow === row) return;
      if (dragSourceRow.closest('.team-block') !== row.closest('.team-block')) return;
      e.preventDefault();
      row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('drag-over');
      if (!dragSourceRow || dragSourceRow === row) return;
      if (dragSourceRow.closest('.team-block') !== row.closest('.team-block')) return;
      swapRowContents(dragSourceRow, row);
    });
  });
}
function getRowState(row) {
  const champBtn = row.querySelector('.champion-slot');
  return { playerId: row.querySelector('.player-select').value, championId: champBtn.dataset.championId || '' };
}
function setRowState(row, rowState) {
  row.querySelector('.player-select').value = rowState.playerId;
  setChampionSlot(row.querySelector('.champion-slot'), rowState.championId ? Number(rowState.championId) : null);
}
function swapRowContents(rowA, rowB) {
  const a = getRowState(rowA);
  const b = getRowState(rowB);
  setRowState(rowA, b);
  setRowState(rowB, a);
  updatePlayerSelectOptions();
}

// ---- 챔피언 이미지 피커 ----
let pickerTargetBtn = null;

// 상단 새 세트 입력 폼과 목록 안의 수정 폼이 동시에 열려있을 수 있어서(각자 다른 시리즈일 수 있음),
// 문서 전체가 아니라 클릭된 슬롯이 속한 <form> 안에서만 중복 픽/밴을 검사해야 서로 안 섞임.
function computeDisabledChampionIds(excludeButton) {
  const used = new Set(state.usedFromPreviousSets);
  const scope = excludeButton.closest('form') || document;
  scope.querySelectorAll('.champion-slot[data-champion-id]').forEach((btn) => {
    if (btn === excludeButton) return;
    const id = Number(btn.dataset.championId);
    if (id) used.add(id);
  });
  return used;
}

function championSlotInnerHtml(championId, isBan) {
  if (championId === 'none') return `<span class="champion-slot-empty ban-none">없음</span>`;
  if (!championId) return `<span class="champion-slot-empty">${isBan ? '밴 선택' : '챔피언 선택'}</span>`;
  const c = state.championById.get(Number(championId));
  return `<img src="${c.imageUrl}" class="champion-slot-img" alt="${c.name}"><span>${c.name}</span>`;
}
function setChampionSlot(btn, championId) {
  btn.dataset.championId = championId ? String(championId) : '';
  btn.innerHTML = championSlotInnerHtml(championId, btn.classList.contains('ban-slot'));
}

function openChampionPicker(btn) {
  pickerTargetBtn = btn;
  const searchInput = document.getElementById('championSearchInput');
  searchInput.value = '';
  renderChampionGrid('');
  document.getElementById('noBanBtn').classList.toggle('hidden', !btn.classList.contains('ban-slot'));
  document.getElementById('championPickerModal').classList.remove('hidden');
  searchInput.focus();
}
document.getElementById('noBanBtn').addEventListener('click', () => {
  setChampionSlot(pickerTargetBtn, 'none');
  closeChampionPicker();
});
function closeChampionPicker() {
  pickerTargetBtn = null;
  document.getElementById('championPickerModal').classList.add('hidden');
}
document.getElementById('closeChampionPicker').addEventListener('click', closeChampionPicker);
document.getElementById('championPickerModal').addEventListener('click', (e) => {
  if (e.target.id === 'championPickerModal') closeChampionPicker();
});
document.getElementById('championSearchInput').addEventListener('input', (e) => renderChampionGrid(e.target.value));

function renderChampionGrid(filterText) {
  const disabled = computeDisabledChampionIds(pickerTargetBtn);
  const q = filterText.trim().toLowerCase();
  const list = state.champions
    .filter((c) => !q || c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  document.getElementById('championGrid').innerHTML = list.map((c) => `
    <button type="button" class="champion-grid-item ${disabled.has(c.championId) ? 'disabled' : ''}" data-champion-id="${c.championId}" ${disabled.has(c.championId) ? 'disabled' : ''}>
      <img src="${c.imageUrl}" alt="${c.name}">
      <span>${c.name}</span>
    </button>
  `).join('');
}
document.getElementById('championGrid').addEventListener('click', (e) => {
  const item = e.target.closest('.champion-grid-item');
  if (!item || item.disabled) return;
  setChampionSlot(pickerTargetBtn, Number(item.dataset.championId));
  closeChampionPicker();
});

document.getElementById('activeSeries').addEventListener('click', async (e) => {
  const champBtn = e.target.closest('.champion-slot');
  if (champBtn) {
    openChampionPicker(champBtn);
    return;
  }
  const delBtn = e.target.closest('.delete-series-btn');
  if (delBtn) {
    if (!confirm('이 시리즈를 삭제할까요? 되돌릴 수 없습니다.')) return;
    await api(`/api/series/${delBtn.dataset.id}`, { method: 'DELETE' });
    state.activeSeries = null;
    document.getElementById('activeSeries').innerHTML = '';
    await loadSeriesList();
    return;
  }
  const editBtn = e.target.closest('.edit-game-btn');
  if (editBtn) {
    // 상단은 최초 입력 전용이라, 이미 기록된 세트 수정은 시리즈 목록 쪽으로 내려서 그 자리에서 함.
    await startEditingSet(Number(editBtn.dataset.seriesId), Number(editBtn.dataset.setId));
    return;
  }
  const deleteGameBtn = e.target.closest('.delete-game-btn');
  if (deleteGameBtn) {
    if (!confirm(`Game ${deleteGameBtn.closest('.game-card').querySelector('.game-card-header span').textContent.replace('Game ', '')}을(를) 삭제할까요?`)) return;
    state.activeSeries = await api(`/api/series/${deleteGameBtn.dataset.seriesId}/sets/${deleteGameBtn.dataset.setId}`, { method: 'DELETE' });
    state.editingSetId = null;
    await renderActiveSeries();
    await loadSeriesList();
  }
});

// 이미 기록된 세트 수정은 어디서 클릭했든(상단 또는 목록) 항상 시리즈 목록(#seriesList)의 그 시리즈가
// 펼쳐진 자리에서 진행 — 상단은 "최초 입력" 전용으로 남겨두기 위함.
async function startEditingSet(seriesId, setId) {
  state.expandedSeriesData = await api(`/api/series/${seriesId}`);
  state.expandedSeriesId = seriesId;
  state.editingSetId = setId;
  state.usedFromPreviousSets = new Set(await api(`/api/series/${seriesId}/used-champions?excludeSet=${setId}`));
  renderSeriesList();
  document.getElementById('seriesList').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.getElementById('activeSeries').addEventListener('change', (e) => {
  if (e.target.classList.contains('player-select')) updatePlayerSelectOptions(document.getElementById('activeSeries'));
});

// 상단(새 세트 입력)과 목록(기존 세트 수정) 폼이 동시에 열려있을 수 있어서 scope를 명시적으로 받음 —
// 안 주면 문서 전체를 봐서 서로 다른 폼끼리 "이미 선택된 선수"가 잘못 간섭할 수 있음.
function updatePlayerSelectOptions(scope) {
  const root = scope || document;
  const selects = [...root.querySelectorAll('.player-select')];
  const chosen = new Set(selects.map((s) => s.value).filter(Boolean));
  selects.forEach((select) => {
    [...select.options].forEach((opt) => {
      if (!opt.value) return;
      opt.disabled = chosen.has(opt.value) && select.value !== opt.value;
    });
  });
}

function collectTeam(form, side) {
  const block = form.querySelector(`.team-block.${side}`);
  return [...block.querySelectorAll('.lane-row')].map((row) => ({
    playerId: Number(row.querySelector('.player-select').value),
    lane: row.dataset.lane,
    championId: Number(row.querySelector('.champion-slot').dataset.championId) || null,
  }));
}
function collectBans(form, side) {
  const block = form.querySelector(`.team-block.${side}`);
  return [...block.querySelectorAll('.ban-slot')].map((el) => Number(el.dataset.championId)).filter(Boolean);
}

// seriesId/editingSetId를 state가 아니라 인자로 명시적으로 받음 — 상단 새 세트 입력과 목록 안 세트
// 수정이 서로 다른 시리즈를 대상으로 동시에 열려있을 수 있어서, 폼 자신(e.target)이 어떤 시리즈/세트를
// 대상으로 하는지 스스로 알고 있어야 함(state.activeSeries에만 의존하면 둘이 섞일 수 있었음).
async function submitSet(e, seriesId, editingSetId) {
  e.preventDefault();
  const form = e.target;
  const errEl = form.querySelector('.error');
  errEl.textContent = '';

  const undecidedBans = form.querySelectorAll('.ban-slot[data-champion-id=""]').length;
  if (undecidedBans > 0) {
    errEl.textContent = '아직 정하지 않은 밴 슬롯이 있습니다. 챔피언을 고르거나 "밴 없음으로 표시"를 눌러 5개를 모두 정해주세요.';
    return;
  }

  const winner = form.querySelector('input[name="winner"]:checked')?.value;
  const payload = {
    blueTeam: collectTeam(form, 'blue'),
    redTeam: collectTeam(form, 'red'),
    bans: { blue: collectBans(form, 'blue'), red: collectBans(form, 'red') },
    winner,
  };
  const url = editingSetId ? `/api/series/${seriesId}/sets/${editingSetId}` : `/api/series/${seriesId}/sets`;
  const method = editingSetId ? 'PUT' : 'POST';
  try {
    const updated = await api(url, { method, body: JSON.stringify(payload) });
    if (editingSetId) {
      // 수정은 항상 목록(#seriesList) 쪽 아코디언에 반영 — 상단은 건드리지 않음(최초 입력 전용).
      state.expandedSeriesData = updated;
      state.editingSetId = null;
      await loadSeriesList();
    } else {
      state.activeSeries = updated;
      await renderActiveSeries();
      await loadSeriesList();
    }
  } catch (err) {
    errEl.textContent = err.message;
  }
}

// ---- 시리즈/게임 카드 (다크 UI) ----
function renderSeriesCard(s) {
  const winsA = s.sets.filter((set) => set.winnerRoster === 'A').length;
  const winsB = s.sets.filter((set) => set.winnerRoster === 'B').length;
  const statusLabel = s.status === 'completed' ? '완료' : '진행중';
  return `
    <div class="series-card">
      <div class="series-card-header">
        <div class="series-badges">
          <span class="badge badge-format">${s.format.toUpperCase()}</span>
          <span class="badge badge-fearless">피어리스 (하드)</span>
          <span class="series-score">${winsA} - ${winsB}</span>
        </div>
        <div class="series-meta">
          <span class="series-date">${s.matchDate}</span>
          <span class="badge badge-status-${s.status}">${statusLabel}</span>
          <button type="button" class="delete-series-btn" data-id="${s.id}">삭제</button>
        </div>
      </div>
      ${s.sets.map((set) => renderGameCard(set, s.id, set.setNumber === s.sets.length)).join('') || '<p class="muted series-empty">아직 기록된 세트가 없습니다.</p>'}
    </div>
  `;
}

function renderGameCard(set, seriesId, isLast) {
  const redWon = set.winnerRoster === set.redRoster;
  return `
    <div class="game-card">
      <div class="game-card-header">
        <span>Game ${set.setNumber}</span>
        <div class="game-card-actions">
          <button type="button" class="edit-game-btn" data-set-id="${set.id}" data-series-id="${seriesId}">수정</button>
          ${isLast ? `<button type="button" class="delete-game-btn" data-set-id="${set.id}" data-series-id="${seriesId}">삭제</button>` : ''}
        </div>
      </div>
      <div class="game-teams">
        ${renderGameTeamColumn('blue', set.blueTeam, set.bans.blue, !redWon)}
        <div class="game-vs">VS</div>
        ${renderGameTeamColumn('red', set.redTeam, set.bans.red, redWon)}
      </div>
    </div>
  `;
}

function renderGameTeamColumn(side, team, bans, won) {
  const teamLabel = side === 'red' ? '레드팀' : '블루팀';
  const sortedTeam = team.slice().sort((a, b) => LANES.indexOf(a.lane) - LANES.indexOf(b.lane));
  return `
    <div class="game-team-col ${side} ${won ? '' : 'lose'}">
      <div class="game-team-header">
        <span class="game-team-name">${teamLabel}</span>
        <span class="badge ${won ? 'badge-win' : 'badge-lose'}">${won ? 'WIN' : 'LOSE'}</span>
      </div>
      <div class="game-ban-row">
        <span class="ban-row-label">밴</span>
        ${bans.length ? bans.map((cid) => `<img class="ban-icon" src="${championImg(cid)}" title="${championLabel(cid)}">`).join('') : '<span class="muted">없음</span>'}
      </div>
      <div class="game-player-rows">
        ${sortedTeam.map((p) => `
          <div class="game-player-row">
            <span class="lane-icon">${laneIconImg(p.lane)}</span>
            <img class="game-champ-avatar" src="${championImg(p.championId)}" alt="${championLabel(p.championId)}">
            <div class="game-player-info">
              <div class="game-player-name">${p.riotId}${p.displayName ? ` (${p.displayName})` : ''}</div>
              <div class="game-champ-name">${championLabel(p.championId)}</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

async function loadSeriesList() {
  state.seriesSummaries = await api('/api/series');
  renderSeriesList();
}

// 하루에 여러 내전이 있을 수 있어서(요구사항) 날짜가 바뀔 때마다 헤더를 끼워 넣어 묶어줌.
// state.seriesSummaries는 백엔드에서 이미 날짜 내림차순으로 오므로 그냥 순회하며 이전 항목과 날짜만 비교하면 됨.
function renderSeriesList() {
  const el = document.getElementById('seriesList');
  if (!state.seriesSummaries.length) {
    el.innerHTML = '<li class="muted">기록된 시리즈가 없습니다.</li>';
    return;
  }
  let lastDate = null;
  const rows = state.seriesSummaries.map((s) => {
    const dateHeading = s.matchDate !== lastDate
      ? `<li class="series-date-heading">${s.matchDate}</li>`
      : '';
    lastDate = s.matchDate;
    const isExpanded = state.expandedSeriesId === s.id && state.expandedSeriesData;
    const editingSet = isExpanded && state.editingSetId
      ? state.expandedSeriesData.sets.find((set) => set.id === state.editingSetId)
      : null;
    return `${dateHeading}
    <li class="series-list-item">
      <button class="series-link" data-id="${s.id}" data-status="${s.status}">
        <span>${s.format.toUpperCase()} · ${s.status === 'completed' ? `종료(로스터 ${s.winnerRoster} 승)` : '진행중'}</span>
        <span class="series-link-chevron">${state.expandedSeriesId === s.id ? '▲' : '▼'}</span>
      </button>
      <div class="series-expand">
        ${isExpanded ? renderSeriesCard(state.expandedSeriesData) : ''}
        ${editingSet ? renderSetEditForm(state.expandedSeriesData.id, editingSet) : ''}
      </div>
    </li>`;
  });
  el.innerHTML = rows.join('');
  attachDragHandlers(el);
  updatePlayerSelectOptions(el);
}

// 이미 기록된 세트 수정 폼 — 예전엔 상단에서만 렌더했는데, 이제 시리즈 목록이 펼쳐진 자리에 인라인으로 붙음.
function renderSetEditForm(seriesId, editingSet) {
  return `
    <form class="set-edit-form" data-series-id="${seriesId}" data-set-id="${editingSet.id}">
      <h4 class="set-form-title">Game ${editingSet.setNumber} 수정</h4>
      <div class="team-columns">
        ${renderTeamInputs('blue', editingSet.blueTeam, laneMapFromParticipants(editingSet.blueTeam), { includeChampionDefaults: true, banDefaults: editingSet.bans.blue, lockedLabel: '(선수 구성 고정)' })}
        ${renderTeamInputs('red', editingSet.redTeam, laneMapFromParticipants(editingSet.redTeam), { includeChampionDefaults: true, banDefaults: editingSet.bans.red, lockedLabel: '(선수 구성 고정)' })}
      </div>
      <div class="winner-pick">
        <label><input type="radio" name="winner" value="blue" ${editingSet.winnerRoster === editingSet.blueRoster ? 'checked' : ''}> 블루 승리</label>
        <label><input type="radio" name="winner" value="red" ${editingSet.winnerRoster === editingSet.redRoster ? 'checked' : ''}> 레드 승리</label>
      </div>
      <p class="error"></p>
      <div class="edit-actions">
        <button type="submit">수정 저장</button>
        <button type="button" class="cancel-edit-btn">취소</button>
      </div>
    </form>`;
}

document.getElementById('seriesList').addEventListener('click', async (e) => {
  const champBtn = e.target.closest('.champion-slot');
  if (champBtn) {
    openChampionPicker(champBtn);
    return;
  }

  const cancelBtn = e.target.closest('.cancel-edit-btn');
  if (cancelBtn) {
    state.editingSetId = null;
    renderSeriesList();
    return;
  }

  const linkBtn = e.target.closest('.series-link');
  if (linkBtn) {
    const id = Number(linkBtn.dataset.id);
    if (linkBtn.dataset.status === 'in_progress') {
      // 진행중인 시리즈는 계속 입력해야 하니 상단 입력 영역으로
      state.activeSeries = await api(`/api/series/${id}`);
      await renderActiveSeries();
      document.getElementById('activeSeries').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    // 완료된 시리즈는 스크롤 이동 없이 목록 안에서 그 자리에 펼침(아코디언)
    state.editingSetId = null; // 다른 시리즈로 전환하거나 접을 때 남아있던 수정 상태는 정리
    if (state.expandedSeriesId === id) {
      state.expandedSeriesId = null;
      state.expandedSeriesData = null;
    } else {
      state.expandedSeriesData = await api(`/api/series/${id}`);
      state.expandedSeriesId = id;
    }
    renderSeriesList();
    return;
  }

  const delBtn = e.target.closest('.delete-series-btn');
  if (delBtn) {
    if (!confirm('이 시리즈를 삭제할까요? 되돌릴 수 없습니다.')) return;
    await api(`/api/series/${delBtn.dataset.id}`, { method: 'DELETE' });
    state.expandedSeriesId = null;
    state.expandedSeriesData = null;
    state.editingSetId = null;
    await loadSeriesList();
    return;
  }

  const editBtn = e.target.closest('.edit-game-btn');
  if (editBtn) {
    await startEditingSet(Number(editBtn.dataset.seriesId), Number(editBtn.dataset.setId));
    return;
  }

  const deleteGameBtn = e.target.closest('.delete-game-btn');
  if (deleteGameBtn) {
    if (!confirm(`Game ${deleteGameBtn.closest('.game-card').querySelector('.game-card-header span').textContent.replace('Game ', '')}을(를) 삭제할까요?`)) return;
    state.expandedSeriesData = await api(`/api/series/${deleteGameBtn.dataset.seriesId}/sets/${deleteGameBtn.dataset.setId}`, { method: 'DELETE' });
    state.editingSetId = null;
    await loadSeriesList();
  }
});

document.getElementById('seriesList').addEventListener('change', (e) => {
  if (e.target.classList.contains('player-select')) updatePlayerSelectOptions(document.getElementById('seriesList'));
});

document.getElementById('seriesList').addEventListener('submit', (e) => {
  if (!e.target.classList.contains('set-edit-form')) return;
  submitSet(e, Number(e.target.dataset.seriesId), Number(e.target.dataset.setId));
});

// ---- 통계 ----
async function loadStats() {
  const [champions, players] = await Promise.all([api('/api/stats/champions'), api('/api/stats/players')]);
  document.getElementById('championStats').innerHTML = `
    <table><thead><tr><th>챔피언</th><th>픽</th><th>픽률</th><th>승률</th><th>밴</th><th>밴률</th></tr></thead>
    <tbody>${champions.map((c) => `
      <tr><td>${championLabel(c.championId)}</td><td>${c.picks}</td><td>${c.pickRate}%</td><td>${c.winRate}%</td><td>${c.bans}</td><td>${c.banRate}%</td></tr>
    `).join('')}</tbody></table>`;
  document.getElementById('playerStats').innerHTML = `
    <table><thead><tr><th>선수</th><th>경기수</th><th>승수</th><th>승률</th><th>선호 라인</th></tr></thead>
    <tbody>${players.map((p) => `
      <tr><td>${p.riotId}</td><td>${p.games}</td><td>${p.wins}</td><td>${p.winRate}%</td><td>${p.favoriteLane ? LANE_LABEL[p.favoriteLane] : '-'}</td></tr>
    `).join('')}</tbody></table>`;
}
