const express = require('express');
const db = require('../db');
const { fetchPlayerProfile } = require('../lib/riot');

const router = express.Router();

router.get('/', (req, res) => {
  const players = db.prepare('SELECT * FROM players ORDER BY riot_game_name COLLATE NOCASE').all();
  res.json(players.map(serialize));
});

router.post('/', async (req, res) => {
  const { gameName, tagLine, displayName } = req.body;
  if (!gameName || !tagLine) return res.status(400).json({ error: 'gameName, tagLine이 필요합니다' });

  try {
    const profile = await fetchPlayerProfile(gameName.trim(), tagLine.trim());
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO players (riot_game_name, riot_tag_line, display_name, puuid, current_tier, current_rank, current_lp, top_champions_json, last_synced_at)
      VALUES (@gameName, @tagLine, @displayName, @puuid, @tier, @rank, @leaguePoints, @topChampionsJson, @now)
      ON CONFLICT(riot_game_name, riot_tag_line) DO UPDATE SET
        display_name = excluded.display_name, puuid = excluded.puuid, current_tier = excluded.current_tier,
        current_rank = excluded.current_rank, current_lp = excluded.current_lp,
        top_champions_json = excluded.top_champions_json, last_synced_at = excluded.last_synced_at
    `).run({
      gameName: profile.gameName,
      tagLine: profile.tagLine,
      displayName: displayName ? displayName.trim() : null,
      puuid: profile.puuid,
      tier: profile.tier,
      rank: profile.rank,
      leaguePoints: profile.leaguePoints,
      topChampionsJson: JSON.stringify(profile.topChampions),
      now,
    });
    const player = db.prepare('SELECT * FROM players WHERE riot_game_name = ? AND riot_tag_line = ?')
      .get(profile.gameName, profile.tagLine);
    res.status(201).json(serialize(player));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/:id/refresh', async (req, res) => {
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
  if (!player) return res.status(404).json({ error: '참가자를 찾을 수 없습니다' });

  try {
    const profile = await fetchPlayerProfile(player.riot_game_name, player.riot_tag_line);
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE players SET puuid=?, current_tier=?, current_rank=?, current_lp=?, top_champions_json=?, last_synced_at=?
      WHERE id = ?
    `).run(profile.puuid, profile.tier, profile.rank, profile.leaguePoints,
      JSON.stringify(profile.topChampions), now, player.id);
    res.json(serialize(db.prepare('SELECT * FROM players WHERE id = ?').get(player.id)));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM players WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

function serialize(p) {
  return {
    id: p.id,
    gameName: p.riot_game_name,
    tagLine: p.riot_tag_line,
    displayName: p.display_name,
    riotId: `${p.riot_game_name}#${p.riot_tag_line}`,
    tier: p.current_tier,
    rank: p.current_rank,
    leaguePoints: p.current_lp,
    topChampions: p.top_champions_json ? JSON.parse(p.top_champions_json) : [],
    opggUrl: `https://op.gg/lol/summoners/kr/${encodeURIComponent(p.riot_game_name)}-${encodeURIComponent(p.riot_tag_line)}`,
    lastSyncedAt: p.last_synced_at,
  };
}

module.exports = router;
