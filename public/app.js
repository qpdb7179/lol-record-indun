const state = {
  players: [],
  champions: [],
  championById: new Map(),
  activeSeries: null,
  usedFromPreviousSets: new Set(),
  editingSetId: null,
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
        <strong>${playerDisplay(p)}</strong>
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
  await renderActiveSeries();
  await loadSeriesList();
});

function laneMapFromLastSet(lastSet, roster) {
  const arr = lastSet.blueRoster === roster ? lastSet.blueTeam : lastSet.redTeam;
  return new Map(arr.map((p) => [p.lane, p]));
}

async function renderActiveSeries() {
  const s = state.activeSeries;
  const el = document.getElementById('activeSeries');
  if (!s) { el.innerHTML = ''; return; }

  const editingSet = state.editingSetId ? s.sets.find((set) => set.id === state.editingSetId) : null;
  if (state.editingSetId && !editingSet) state.editingSetId = null;

  if (editingSet) {
    state.usedFromPreviousSets = new Set(await api(`/api/series/${s.id}/used-champions?beforeSet=${editingSet.setNumber}`));
    el.innerHTML = `
      ${renderSeriesCard(s)}
      <form id="setForm">
        <h4 class="set-form-title">Game ${editingSet.setNumber} 수정</h4>
        <div class="team-columns">
          ${renderTeamInputs('blue', editingSet.blueTeam, laneMapFromParticipants(editingSet.blueTeam), { includeChampionDefaults: true, banDefaults: editingSet.bans.blue, lockedLabel: '(선수 구성 고정)' })}
          ${renderTeamInputs('red', editingSet.redTeam, laneMapFromParticipants(editingSet.redTeam), { includeChampionDefaults: true, banDefaults: editingSet.bans.red, lockedLabel: '(선수 구성 고정)' })}
        </div>
        <div class="winner-pick">
          <label><input type="radio" name="winner" value="blue" ${editingSet.winnerRoster === editingSet.blueRoster ? 'checked' : ''}> 블루 승리</label>
          <label><input type="radio" name="winner" value="red" ${editingSet.winnerRoster === editingSet.redRoster ? 'checked' : ''}> 레드 승리</label>
        </div>
        <p class="error" id="setFormError"></p>
        <div class="edit-actions">
          <button type="submit">수정 저장</button>
          <button type="button" id="cancelEditBtn">취소</button>
        </div>
      </form>
    `;
    document.getElementById('setForm').addEventListener('submit', (e) => submitSet(e, editingSet.id));
    document.getElementById('cancelEditBtn').addEventListener('click', async () => {
      state.editingSetId = null;
      await renderActiveSeries();
    });
    attachDragHandlers(el);
    updatePlayerSelectOptions();
    return;
  }

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
      <h4 class="set-form-title">${nextSetNumber}세트 입력</h4>
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
  document.getElementById('setForm').addEventListener('submit', submitSet);
  attachDragHandlers(el);
  updatePlayerSelectOptions();
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
        <select class="player-select">
          <option value="">선수 선택</option>${playerOptionsHtml(defaultPlayerId)}
        </select>
        <button type="button" class="champion-slot" data-champion-id="${defaultChampionId || ''}">
          ${championSlotInnerHtml(defaultChampionId)}
        </button>
      </div>`;
  }).join('');

  const banSlotsHtml = banDefaults.map((cid) => `
    <span class="ban-slot-wrap">
      <button type="button" class="champion-slot ban-slot" data-champion-id="${cid}">${championSlotInnerHtml(cid, true)}</button>
      <button type="button" class="remove-ban" title="제거">×</button>
    </span>`).join('');

  return `
    <div class="team-block ${side}">
      <h4>${side === 'blue' ? '블루팀' : '레드팀'}${allowedPlayers ? ` <span class="muted small">${lockedLabel}</span>` : ''}</h4>
      ${rows}
      <div class="ban-section">
        <span class="ban-label">밴</span>
        <span class="ban-slots">${banSlotsHtml}</span>
        <button type="button" class="add-ban-btn" title="밴 추가">+</button>
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

function computeDisabledChampionIds(excludeButton) {
  const used = new Set(state.usedFromPreviousSets);
  document.querySelectorAll('#activeSeries .champion-slot[data-champion-id]').forEach((btn) => {
    if (btn === excludeButton) return;
    const id = Number(btn.dataset.championId);
    if (id) used.add(id);
  });
  return used;
}

function championSlotInnerHtml(championId, isBan) {
  if (!championId) return `<span class="champion-slot-empty">${isBan ? '+' : '챔피언 선택'}</span>`;
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
  document.getElementById('championPickerModal').classList.remove('hidden');
  searchInput.focus();
}
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

function addBanSlot(teamBlock) {
  const wrap = document.createElement('span');
  wrap.className = 'ban-slot-wrap';
  wrap.innerHTML = `
    <button type="button" class="champion-slot ban-slot" data-champion-id=""><span class="champion-slot-empty">+</span></button>
    <button type="button" class="remove-ban" title="제거">×</button>
  `;
  teamBlock.querySelector('.ban-slots').appendChild(wrap);
  openChampionPicker(wrap.querySelector('.champion-slot'));
}

document.getElementById('activeSeries').addEventListener('click', async (e) => {
  const removeBtn = e.target.closest('.remove-ban');
  if (removeBtn) {
    removeBtn.closest('.ban-slot-wrap').remove();
    return;
  }
  const champBtn = e.target.closest('.champion-slot');
  if (champBtn) {
    openChampionPicker(champBtn);
    return;
  }
  const addBanBtn = e.target.closest('.add-ban-btn');
  if (addBanBtn) {
    addBanSlot(addBanBtn.closest('.team-block'));
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
    state.editingSetId = Number(editBtn.dataset.setId);
    await renderActiveSeries();
  }
});

document.getElementById('activeSeries').addEventListener('change', (e) => {
  if (e.target.classList.contains('player-select')) updatePlayerSelectOptions();
});

function updatePlayerSelectOptions() {
  const selects = [...document.querySelectorAll('#activeSeries .player-select')];
  const chosen = new Set(selects.map((s) => s.value).filter(Boolean));
  selects.forEach((select) => {
    [...select.options].forEach((opt) => {
      if (!opt.value) return;
      opt.disabled = chosen.has(opt.value) && select.value !== opt.value;
    });
  });
}

function collectTeam(side) {
  const block = document.querySelector(`.team-block.${side}`);
  return [...block.querySelectorAll('.lane-row')].map((row) => ({
    playerId: Number(row.querySelector('.player-select').value),
    lane: row.dataset.lane,
    championId: Number(row.querySelector('.champion-slot').dataset.championId) || null,
  }));
}
function collectBans(side) {
  const block = document.querySelector(`.team-block.${side}`);
  return [...block.querySelectorAll('.ban-slot')].map((el) => Number(el.dataset.championId)).filter(Boolean);
}

async function submitSet(e, editingSetId) {
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
  const url = editingSetId
    ? `/api/series/${state.activeSeries.id}/sets/${editingSetId}`
    : `/api/series/${state.activeSeries.id}/sets`;
  const method = editingSetId ? 'PUT' : 'POST';
  try {
    state.activeSeries = await api(url, { method, body: JSON.stringify(payload) });
    state.editingSetId = null;
    await renderActiveSeries();
    await loadSeriesList();
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
      ${s.sets.map((set, i) => renderGameCard(set, i === s.sets.length - 1)).join('') || '<p class="muted series-empty">아직 기록된 세트가 없습니다.</p>'}
    </div>
  `;
}

function renderGameCard(set, isLast) {
  const redWon = set.winnerRoster === set.redRoster;
  return `
    <div class="game-card">
      <div class="game-card-header">
        <span>Game ${set.setNumber}</span>
        ${isLast ? `<button type="button" class="edit-game-btn" data-set-id="${set.id}">수정</button>` : ''}
      </div>
      <div class="game-teams">
        ${renderGameTeamColumn('red', set.redTeam, set.bans.red, redWon)}
        <div class="game-vs">VS</div>
        ${renderGameTeamColumn('blue', set.blueTeam, set.bans.blue, !redWon)}
      </div>
    </div>
  `;
}

function renderGameTeamColumn(side, team, bans, won) {
  const teamLabel = side === 'red' ? '레드팀' : '블루팀';
  const sortedTeam = team.slice().sort((a, b) => LANES.indexOf(a.lane) - LANES.indexOf(b.lane));
  return `
    <div class="game-team-col ${side}">
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
  await renderActiveSeries();
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
