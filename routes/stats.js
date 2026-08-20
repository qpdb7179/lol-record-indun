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

  const result = rows.map((r) => ({
    playerId: r.playerId,
    riotId: `${r.riot_game_name}#${r.riot_tag_line}`,
    games: r.games,
    wins: r.wins,
    winRate: r.games ? Number(((r.wins / r.games) * 100).toFixed(1)) : 0,
    favoriteLane: favoriteLaneByPlayer.get(r.playerId)?.lane || null,
  }));
  result.sort((a, b) => b.games - a.games);
  res.json(result);
});

module.exports = router;
