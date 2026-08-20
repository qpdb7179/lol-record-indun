const express = require('express');
const db = require('../db');
const { getUsedChampionIds } = require('../lib/fearless');

const router = express.Router();
const LANES = ['top', 'jungle', 'mid', 'adc', 'support'];
const SETS_TO_WIN = { bo3: 2, bo5: 3 };

router.get('/', (req, res) => {
  const { date } = req.query;
  const rows = date
    ? db.prepare('SELECT * FROM series WHERE match_date = ? ORDER BY id DESC').all(date)
    : db.prepare('SELECT * FROM series ORDER BY match_date DESC, id DESC').all();
  res.json(rows.map(serializeSeries));
});

router.post('/', (req, res) => {
  const { matchDate, format } = req.body;
  if (!matchDate || !['bo3', 'bo5'].includes(format)) {
    return res.status(400).json({ error: 'matchDate, format(bo3|bo5)이 필요합니다' });
  }
  const info = db.prepare('INSERT INTO series (match_date, format) VALUES (?, ?)').run(matchDate, format);
  res.status(201).json(serializeSeries(db.prepare('SELECT * FROM series WHERE id = ?').get(info.lastInsertRowid)));
});

router.get('/:id', (req, res) => {
  const series = db.prepare('SELECT * FROM series WHERE id = ?').get(req.params.id);
  if (!series) return res.status(404).json({ error: '시리즈를 찾을 수 없습니다' });
  res.json(serializeSeriesDetail(series));
});

router.get('/:id/used-champions', (req, res) => {
  const beforeSet = Number(req.query.beforeSet) || 999;
  res.json([...getUsedChampionIds(req.params.id, beforeSet)]);
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM series WHERE id = ?').run(req.params.id); // 세트/로스터/참가자/밴은 ON DELETE CASCADE로 함께 삭제됨
  res.status(204).end();
});

router.post('/:id/sets', (req, res) => {
  const series = db.prepare('SELECT * FROM series WHERE id = ?').get(req.params.id);
  if (!series) return res.status(404).json({ error: '시리즈를 찾을 수 없습니다' });
  if (series.status === 'completed') return res.status(400).json({ error: '이미 종료된 시리즈입니다' });

  const { blueTeam, redTeam, bans = {}, winner } = req.body;
  const validationError = validateSetPayload(blueTeam, redTeam, bans, winner);
  if (validationError) return res.status(400).json({ error: validationError });

  const existingSets = db.prepare('SELECT * FROM sets WHERE series_id = ? ORDER BY set_number').all(series.id);
  const setNumber = existingSets.length + 1;

  let blueRoster;
  let redRoster;
  let newRosterPlayers = null;

  if (setNumber === 1) {
    blueRoster = 'A';
    redRoster = 'B';
    newRosterPlayers = { A: blueTeam.map((p) => p.playerId), B: redTeam.map((p) => p.playerId) };
  } else {
    const rosterRows = db.prepare('SELECT roster, player_id FROM series_rosters WHERE series_id = ?').all(series.id);
    const rosterA = new Set(rosterRows.filter((r) => r.roster === 'A').map((r) => r.player_id));
    const rosterB = new Set(rosterRows.filter((r) => r.roster === 'B').map((r) => r.player_id));
    const blueIds = blueTeam.map((p) => p.playerId);
    const redIds = redTeam.map((p) => p.playerId);

    if (sameMembers(blueIds, rosterA) && sameMembers(redIds, rosterB)) {
      blueRoster = 'A';
      redRoster = 'B';
    } else if (sameMembers(blueIds, rosterB) && sameMembers(redIds, rosterA)) {
      blueRoster = 'B';
      redRoster = 'A';
    } else {
      return res.status(400).json({ error: '이전 세트와 동일한 두 팀(선수 구성)이어야 합니다. 진영(블루/레드)만 바뀔 수 있습니다.' });
    }

    const prevSet = existingSets[existingSets.length - 1];
    if (prevSet.blue_roster === blueRoster) {
      return res.status(400).json({ error: '이전 세트와 같은 진영입니다. 세트마다 블루/레드 진영을 바꿔야 합니다.' });
    }
  }

  const used = getUsedChampionIds(series.id, setNumber);
  const allChampionIds = [
    ...blueTeam.map((p) => p.championId),
    ...redTeam.map((p) => p.championId),
    ...(bans.blue || []),
    ...(bans.red || []),
  ];
  const conflict = allChampionIds.find((cid) => used.has(cid));
  if (conflict) {
    return res.status(400).json({
      error: `챔피언 ID ${conflict}는 이 시리즈의 이전 세트에서 이미 사용되어 다시 사용할 수 없습니다 (피어리스 드래프트 규칙).`,
    });
  }

  const winnerRoster = winner === 'blue' ? blueRoster : redRoster;

  const runInTransaction = db.transaction(() => {
    if (newRosterPlayers) {
      const insertRoster = db.prepare('INSERT INTO series_rosters (series_id, roster, player_id) VALUES (?, ?, ?)');
      newRosterPlayers.A.forEach((pid) => insertRoster.run(series.id, 'A', pid));
      newRosterPlayers.B.forEach((pid) => insertRoster.run(series.id, 'B', pid));
    }

    const setInfo = db.prepare(`
      INSERT INTO sets (series_id, set_number, blue_roster, red_roster, winner_roster)
      VALUES (?, ?, ?, ?, ?)
    `).run(series.id, setNumber, blueRoster, redRoster, winnerRoster);
    const setId = setInfo.lastInsertRowid;

    const insertParticipant = db.prepare(
      'INSERT INTO set_participants (set_id, player_id, team, lane, champion_id) VALUES (?, ?, ?, ?, ?)'
    );
    blueTeam.forEach((p) => insertParticipant.run(setId, p.playerId, 'blue', p.lane, p.championId));
    redTeam.forEach((p) => insertParticipant.run(setId, p.playerId, 'red', p.lane, p.championId));

    const insertBan = db.prepare('INSERT INTO set_bans (set_id, team, champion_id, ban_order) VALUES (?, ?, ?, ?)');
    (bans.blue || []).forEach((cid, i) => insertBan.run(setId, 'blue', cid, i + 1));
    (bans.red || []).forEach((cid, i) => insertBan.run(setId, 'red', cid, i + 1));

    const wins = db.prepare('SELECT winner_roster, COUNT(*) as cnt FROM sets WHERE series_id = ? GROUP BY winner_roster').all(series.id);
    const winsMap = Object.fromEntries(wins.map((w) => [w.winner_roster, w.cnt]));
    const needed = SETS_TO_WIN[series.format];
    const doneRoster = ['A', 'B'].find((r) => (winsMap[r] || 0) >= needed);
    if (doneRoster) {
      db.prepare('UPDATE series SET status = ?, winner_roster = ? WHERE id = ?').run('completed', doneRoster, series.id);
    }
  });

  runInTransaction();
  res.status(201).json(serializeSeriesDetail(db.prepare('SELECT * FROM series WHERE id = ?').get(series.id)));
});

function sameMembers(arr, set) {
  return arr.length === set.size && arr.every((x) => set.has(x));
}

function validateSetPayload(blueTeam, redTeam, bans, winner) {
  if (!Array.isArray(blueTeam) || blueTeam.length !== 5) return 'blueTeam은 5명이어야 합니다';
  if (!Array.isArray(redTeam) || redTeam.length !== 5) return 'redTeam은 5명이어야 합니다';
  if (!['blue', 'red'].includes(winner)) return "winner는 'blue' 또는 'red'여야 합니다";

  const allPlayerIds = [...blueTeam, ...redTeam].map((p) => p.playerId);
  if (new Set(allPlayerIds).size !== 10) return '10명의 참가자가 모두 달라야 합니다';

  for (const team of [blueTeam, redTeam]) {
    const lanes = team.map((p) => p.lane);
    if (new Set(lanes).size !== 5 || lanes.some((l) => !LANES.includes(l))) {
      return `각 팀은 ${LANES.join('/')} 라인이 정확히 한 번씩 있어야 합니다`;
    }
    if (team.some((p) => !p.championId)) return '모든 참가자는 챔피언을 선택해야 합니다';
  }

  const allChampionIdsInSet = [
    ...blueTeam.map((p) => p.championId),
    ...redTeam.map((p) => p.championId),
    ...(bans.blue || []),
    ...(bans.red || []),
  ];
  const seen = new Set();
  for (const cid of allChampionIdsInSet) {
    if (seen.has(cid)) return `챔피언 ID ${cid}가 이 세트 안에서 중복 선택(픽/밴)되었습니다`;
    seen.add(cid);
  }
  return null;
}

function serializeSeries(s) {
  return {
    id: s.id,
    matchDate: s.match_date,
    format: s.format,
    status: s.status,
    winnerRoster: s.winner_roster,
    createdAt: s.created_at,
  };
}

function serializeSeriesDetail(series) {
  const sets = db.prepare('SELECT * FROM sets WHERE series_id = ? ORDER BY set_number').all(series.id);
  const rosters = db.prepare(`
    SELECT sr.roster, p.id AS player_id, p.riot_game_name, p.riot_tag_line, p.display_name
    FROM series_rosters sr JOIN players p ON p.id = sr.player_id
    WHERE sr.series_id = ?
  `).all(series.id);

  const setDetails = sets.map((set) => {
    const participants = db.prepare(`
      SELECT sp.*, p.riot_game_name, p.riot_tag_line, p.display_name FROM set_participants sp
      JOIN players p ON p.id = sp.player_id WHERE sp.set_id = ?
    `).all(set.id);
    const bans = db.prepare('SELECT * FROM set_bans WHERE set_id = ? ORDER BY team, ban_order').all(set.id);
    return {
      id: set.id,
      setNumber: set.set_number,
      blueRoster: set.blue_roster,
      redRoster: set.red_roster,
      winnerRoster: set.winner_roster,
      blueTeam: participants.filter((p) => p.team === 'blue').map(serializeParticipant),
      redTeam: participants.filter((p) => p.team === 'red').map(serializeParticipant),
      bans: {
        blue: bans.filter((b) => b.team === 'blue').map((b) => b.champion_id),
        red: bans.filter((b) => b.team === 'red').map((b) => b.champion_id),
      },
    };
  });

  return {
    ...serializeSeries(series),
    rosters: {
      A: rosters.filter((r) => r.roster === 'A').map(serializeRosterPlayer),
      B: rosters.filter((r) => r.roster === 'B').map(serializeRosterPlayer),
    },
    sets: setDetails,
  };
}

function serializeRosterPlayer(r) {
  return { playerId: r.player_id, riotId: `${r.riot_game_name}#${r.riot_tag_line}`, displayName: r.display_name };
}

function serializeParticipant(p) {
  return {
    playerId: p.player_id,
    riotId: `${p.riot_game_name}#${p.riot_tag_line}`,
    displayName: p.display_name,
    lane: p.lane,
    championId: p.champion_id,
  };
}

module.exports = router;
