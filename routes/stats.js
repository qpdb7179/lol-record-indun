const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/champions', (req, res) => {
  const rows = db.prepare(`
    SELECT sp.champion_id AS championId,
      COUNT(*) AS picks,
      SUM(CASE WHEN sp.team = 'blue' AND s.blue_roster = s.winner_roster THEN 1
               WHEN sp.team = 'red' AND s.red_roster = s.winner_roster THEN 1 ELSE 0 END) AS wins
    FROM set_participants sp
    JOIN sets s ON s.id = sp.set_id
    GROUP BY sp.champion_id
  `).all();

  const banRows = db.prepare('SELECT champion_id AS championId, COUNT(*) AS bans FROM set_bans GROUP BY champion_id').all();
  const banMap = new Map(banRows.map((b) => [b.championId, b.bans]));
  const totalSets = db.prepare('SELECT COUNT(*) AS cnt FROM sets').get().cnt;

  const result = rows.map((r) => {
    const bans = banMap.get(r.championId) || 0;
    return {
      championId: r.championId,
      picks: r.picks,
      wins: r.wins,
      winRate: r.picks ? Number(((r.wins / r.picks) * 100).toFixed(1)) : 0,
      pickRate: totalSets ? Number(((r.picks / totalSets) * 100).toFixed(1)) : 0,
      bans,
      banRate: totalSets ? Number(((bans / totalSets) * 100).toFixed(1)) : 0,
    };
  });
  result.sort((a, b) => b.picks - a.picks);
  res.json(result);
});

const LANES = ['top', 'jungle', 'mid', 'adc', 'support'];

// 라인별 챔피언 통계 — 밴은 라인 개념이 없어서(팀 단위 밴이라 특정 라인에 귀속 안 됨) 제외.
// pickRate 분모는 전체 라인 통합과 동일하게 totalSets(세트마다 라인당 정확히 1명씩 있으므로
// "이 라인이 나온 세트 수" = 전체 세트 수와 같음).
router.get('/champions/by-lane', (req, res) => {
  const rows = db.prepare(`
    SELECT sp.champion_id AS championId, sp.lane AS lane,
      COUNT(*) AS picks,
      SUM(CASE WHEN sp.team = 'blue' AND s.blue_roster = s.winner_roster THEN 1
               WHEN sp.team = 'red' AND s.red_roster = s.winner_roster THEN 1 ELSE 0 END) AS wins
    FROM set_participants sp
    JOIN sets s ON s.id = sp.set_id
    GROUP BY sp.champion_id, sp.lane
  `).all();

  const totalSets = db.prepare('SELECT COUNT(*) AS cnt FROM sets').get().cnt;
  const byLane = Object.fromEntries(LANES.map((l) => [l, []]));
  for (const r of rows) {
    if (!byLane[r.lane]) continue;
    byLane[r.lane].push({
      championId: r.championId,
      picks: r.picks,
      wins: r.wins,
      winRate: r.picks ? Number(((r.wins / r.picks) * 100).toFixed(1)) : 0,
      pickRate: totalSets ? Number(((r.picks / totalSets) * 100).toFixed(1)) : 0,
    });
  }
  for (const lane of LANES) byLane[lane].sort((a, b) => b.picks - a.picks);
  res.json(byLane);
});

router.get('/players', (req, res) => {
  const rows = db.prepare(`
    SELECT sp.player_id AS playerId, p.riot_game_name, p.riot_tag_line,
      COUNT(*) AS games,
      SUM(CASE WHEN sp.team = 'blue' AND s.blue_roster = s.winner_roster THEN 1
               WHEN sp.team = 'red' AND s.red_roster = s.winner_roster THEN 1 ELSE 0 END) AS wins
    FROM set_participants sp
    JOIN sets s ON s.id = sp.set_id
    JOIN players p ON p.id = sp.player_id
    GROUP BY sp.player_id
  `).all();

  const laneRows = db.prepare('SELECT player_id AS playerId, lane, COUNT(*) AS cnt FROM set_participants GROUP BY player_id, lane').all();
  const favoriteLaneByPlayer = new Map();
  for (const r of laneRows) {
    const current = favoriteLaneByPlayer.get(r.playerId);
    if (!current || r.cnt > current.cnt) favoriteLaneByPlayer.set(r.playerId, r);
  }

  // 선수별 최고 챔피언 Top 3 — 판수 우선, 동률이면 승률로 정렬
  const champRows = db.prepare(`
    SELECT sp.player_id AS playerId, sp.champion_id AS championId,
      COUNT(*) AS games,
      SUM(CASE WHEN sp.team = 'blue' AND s.blue_roster = s.winner_roster THEN 1
               WHEN sp.team = 'red' AND s.red_roster = s.winner_roster THEN 1 ELSE 0 END) AS wins
    FROM set_participants sp
    JOIN sets s ON s.id = sp.set_id
    GROUP BY sp.player_id, sp.champion_id
  `).all();
  const champsByPlayer = new Map();
  for (const r of champRows) {
    if (!champsByPlayer.has(r.playerId)) champsByPlayer.set(r.playerId, []);
    champsByPlayer.get(r.playerId).push({
      championId: r.championId,
      games: r.games,
      wins: r.wins,
      winRate: r.games ? Number(((r.wins / r.games) * 100).toFixed(1)) : 0,
    });
  }
  for (const list of champsByPlayer.values()) list.sort((a, b) => b.games - a.games || b.winRate - a.winRate);

  const result = rows.map((r) => ({
    playerId: r.playerId,
    riotId: `${r.riot_game_name}#${r.riot_tag_line}`,
    games: r.games,
    wins: r.wins,
    winRate: r.games ? Number(((r.wins / r.games) * 100).toFixed(1)) : 0,
    favoriteLane: favoriteLaneByPlayer.get(r.playerId)?.lane || null,
    topChampions: (champsByPlayer.get(r.playerId) || []).slice(0, 3),
  }));
  result.sort((a, b) => b.games - a.games);
  res.json(result);
});

module.exports = router;
