const state = {
  players: [],
  champions: [],
  championById: new Map(),
  activeSeries: null,
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
}

function championLabel(id) {
  const c = state.championById.get(Number(id));
  return c ? c.name : `#${id}`;
}
function championImg(id) {
  const c = state.championById.get(Number(id));
  return c ? c.imageUrl : '';
}

// ---- 참가자 관리 ----
async function loadPlayers() {
  state.players = await api('/api/players');
  renderPlayers();
}
function renderPlayers() {
  const el = document.getElementById('playerList');
  el.innerHTML = state.players.map((p) => `
    <div class="player-card">
      <div class="player-header">
        <strong>${p.riotId}</strong>
        <span class="tier-badge">${p.tier ? `${p.tier} ${p.rank || ''}`.trim() : '언랭'}</span>
      </div>
      <div class="top-champs">
        ${p.topChampions.map((tc) => `<img src="${championImg(tc.championId)}" title="${championLabel(tc.championId)} (Lv.${tc.championLevel})">`).join('') || '<span class="muted">숙련도 정보 없음</span>'}
      </div>
      <div class="player-actions">
        <a href="${p.opggUrl}" target="_blank" rel="noopener">op.gg</a>
        <button data-action="refresh" data-id="${p.id}">새로고침</button>
        <button data-action="delete" data-id="${p.id}">삭제</button>
      </div>
    </div>
  `).join('') || '<p class="muted">등록된 참가자가 없습니다.</p>';
}

document.getElementById('playerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const gameName = document.getElementById('gameNameInput').value.trim();
  const tagLine = document.getElementById('tagLineInput').value.trim();
  const errEl = document.getElementById('playerFormError');
  errEl.textContent = '';
  try {
    await api('/api/players', { method: 'POST', body: JSON.stringify({ gameName, tagLine }) });
    e.target.reset();
    await loadPlayers();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById('playerList').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.action === 'refresh') {
    btn.disabled = true;
    try {
      await api(`/api/players/${id}/refresh`, { method: 'POST' });
      await loadPlayers();
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
    }
  } else if (btn.dataset.action === 'delete') {
    if (!confirm('삭제할까요?')) return;
    await api(`/api/players/${id}`, { method: 'DELETE' });
    await loadPlayers();
  }
});

// ---- 전적 기록 ----
document.getElementById('seriesForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const matchDate = document.getElementById('matchDateInput').value;
  const format = document.getElementById('formatInput').value;
  const series = await api('/api/series', { method: 'POST', body: JSON.stringify({ matchDate, format }) });
  state.activeSeries = await api(`/api/series/${series.id}`);
  renderActiveSeries();
  await loadSeriesList();
});

function renderActiveSeries() {
  const s = state.activeSeries;
  const el = document.getElementById('activeSeries');
  if (!s) { el.innerHTML = ''; return; }

  if (s.status === 'completed') {
    el.innerHTML = `<p><strong>시리즈 #${s.id}</strong> (${s.matchDate}, ${s.format.toUpperCase()}) 종료됨 — 로스터 ${s.winnerRoster} 승리</p>${renderSetHistory(s)}`;
    return;
  }

  const nextSetNumber = s.sets.length + 1;
  let bluePlayers = null;
  let redPlayers = null;
  if (nextSetNumber > 1) {
    const lastSet = s.sets[s.sets.length - 1];
    bluePlayers = s.rosters[lastSet.redRoster]; // 매 세트 진영 스왑
    redPlayers = s.rosters[lastSet.blueRoster];
  }

  el.innerHTML = `
    <p><strong>시리즈 #${s.id}</strong> (${s.matchDate}, ${s.format.toUpperCase()}) — ${nextSetNumber}세트 입력</p>
    ${renderSetHistory(s)}
    <form id="setForm">
      <div class="team-columns">
        ${renderTeamInputs('blue', bluePlayers)}
        ${renderTeamInputs('red', redPlayers)}
      </div>
      <div class="winner-pick">
        <label><input type="radio" name="winner" value="blue" required> 블루 승리</label>
        <label><input type="radio" name="winner" value="red"> 레드 승리</label>
      </div>
      <p class="error" id="setFormError"></p>
      <button type="submit">세트 기록 저장</button>
    </form>
  `;
  document.getElementById('setForm').addEventListener('submit', submitSet);
}

const LANES = ['top', 'jungle', 'mid', 'adc', 'support'];
const LANE_LABEL = { top: '탑', jungle: '정글', mid: '미드', adc: '원딜', support: '서폿' };

function renderTeamInputs(side, fixedPlayers) {
  const playerOptions = (selectedId) => state.players.map((p) =>
    `<option value="${p.id}" ${String(p.id) === String(selectedId) ? 'selected' : ''}>${p.riotId}</option>`).join('');
  const championOptions = () => state.champions.slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    .map((c) => `<option value="${c.championId}">${c.name}</option>`).join('');

  const rows = LANES.map((lane, i) => {
    const fixedPlayerId = fixedPlayers ? fixedPlayers[i]?.playerId : '';
    return `
      <div class="lane-row" data-lane="${lane}">
        <span class="lane-label">${LANE_LABEL[lane]}</span>
        <select class="player-select" ${fixedPlayers ? 'disabled' : ''}>
          <option value="">선수 선택</option>${playerOptions(fixedPlayerId)}
        </select>
        ${fixedPlayers ? `<input type="hidden" class="player-select-hidden" value="${fixedPlayerId}">` : ''}
        <select class="champion-select">
          <option value="">챔피언 선택</option>${championOptions()}
        </select>
      </div>`;
  }).join('');

  return `
    <div class="team-block ${side}">
      <h4>${side === 'blue' ? '블루팀' : '레드팀'}${fixedPlayers ? ' (자동 배정, 진영 스왑됨)' : ''}</h4>
      ${rows}
      <div class="ban-section">
        <span>밴:</span>
        <select class="ban-select"><option value="">챔피언 선택</option>${championOptions()}</select>
        <button type="button" class="add-ban">밴 추가</button>
        <ul class="ban-list"></ul>
      </div>
    </div>`;
}

document.getElementById('activeSeries').addEventListener('click', (e) => {
  if (e.target.classList.contains('add-ban')) {
    const block = e.target.closest('.team-block');
    const sel = block.querySelector('.ban-select');
    if (!sel.value) return;
    const li = document.createElement('li');
    li.dataset.championId = sel.value;
    li.textContent = championLabel(sel.value);
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.textContent = '×';
    rm.className = 'remove-ban';
    li.appendChild(rm);
    block.querySelector('.ban-list').appendChild(li);
    sel.value = '';
  } else if (e.target.classList.contains('remove-ban')) {
    e.target.closest('li').remove();
  }
});

function collectTeam(side) {
  const block = document.querySelector(`.team-block.${side}`);
  return [...block.querySelectorAll('.lane-row')].map((row) => {
    const hidden = row.querySelector('.player-select-hidden');
    const playerId = hidden ? hidden.value : row.querySelector('.player-select').value;
    return {
      playerId: Number(playerId),
      lane: row.dataset.lane,
      championId: Number(row.querySelector('.champion-select').value),
    };
  });
}
function collectBans(side) {
  const block = document.querySelector(`.team-block.${side}`);
  return [...block.querySelectorAll('.ban-list li')].map((li) => Number(li.dataset.championId));
}

async function submitSet(e) {
  e.preventDefault();
  const errEl = document.getElementById('setFormError');
  errEl.textContent = '';
  const winner = document.querySelector('input[name="winner"]:checked')?.value;
  const payload = {
    blueTeam: collectTeam('blue'),
    redTeam: collectTeam('red'),
    bans: { blue: collectBans('blue'), red: collectBans('red') },
    winner,
  };
  try {
    state.activeSeries = await api(`/api/series/${state.activeSeries.id}/sets`, { method: 'POST', body: JSON.stringify(payload) });
    renderActiveSeries();
    await loadSeriesList();
  } catch (err) {
    errEl.textContent = err.message;
  }
}

function renderSetHistory(s) {
  if (!s.sets.length) return '';
  return `<div class="set-history">${s.sets.map((set) => `
    <div class="set-summary">
      <strong>${set.setNumber}세트</strong> — 승자: ${set.winnerRoster === set.blueRoster ? '블루' : '레드'}팀 (로스터 ${set.winnerRoster})
      <div class="set-detail">
        블루: ${set.blueTeam.map((p) => `${p.riotId}(${championLabel(p.championId)})`).join(', ')}<br>
        레드: ${set.redTeam.map((p) => `${p.riotId}(${championLabel(p.championId)})`).join(', ')}<br>
        밴 — 블루: ${set.bans.blue.map(championLabel).join(', ') || '없음'} / 레드: ${set.bans.red.map(championLabel).join(', ') || '없음'}
      </div>
    </div>
  `).join('')}</div>`;
}

async function loadSeriesList() {
  const list = await api('/api/series');
  const el = document.getElementById('seriesList');
  el.innerHTML = list.map((s) => `
    <li>
      <button class="series-link" data-id="${s.id}">
        ${s.matchDate} · ${s.format.toUpperCase()} · ${s.status === 'completed' ? `종료(로스터 ${s.winnerRoster} 승)` : '진행중'}
      </button>
    </li>`).join('') || '<li class="muted">기록된 시리즈가 없습니다.</li>';
}
document.getElementById('seriesList').addEventListener('click', async (e) => {
  const btn = e.target.closest('.series-link');
  if (!btn) return;
  state.activeSeries = await api(`/api/series/${btn.dataset.id}`);
  renderActiveSeries();
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
