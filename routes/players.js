const express = require('express');
const db = require('../db');
const { fetchPlayerProfile, fetchRecentChampionStats, RECENT_GAMES_COUNT } = require('../lib/riot');

const router = express.Router();
const RECENT_STATS_CACHE_MS = 60 * 60 * 1000; // 1시간 — match-v5 호출량이 커서(프로필당 1+N건) 매번 새로 안 불러옴

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
      INSERT INTO players (
        riot_game_name, riot_tag_line, display_name, puuid,
        current_tier, current_rank, current_lp, current_wins, current_losses,
        flex_tier, flex_rank, flex_lp, flex_wins, flex_losses,
        top_champions_json, last_synced_at
      )
      VALUES (
        @gameName, @tagLine, @displayName, @puuid,
        @tier, @rank, @leaguePoints, @wins, @losses,
        @flexTier, @flexRank, @flexLeaguePoints, @flexWins, @flexLosses,
        @topChampionsJson, @now
      )
      ON CONFLICT(riot_game_name, riot_tag_line) DO UPDATE SET
        display_name = excluded.display_name, puuid = excluded.puuid, current_tier = excluded.current_tier,
        current_rank = excluded.current_rank, current_lp = excluded.current_lp,
        current_wins = excluded.current_wins, current_losses = excluded.current_losses,
        flex_tier = excluded.flex_tier, flex_rank = excluded.flex_rank, flex_lp = excluded.flex_lp,
        flex_wins = excluded.flex_wins, flex_losses = excluded.flex_losses,
        top_champions_json = excluded.top_champions_json, last_synced_at = excluded.last_synced_at
    `).run({
      gameName: profile.gameName,
      tagLine: profile.tagLine,
      displayName: displayName ? displayName.trim() : null,
      puuid: profile.puuid,
      tier: profile.tier,
      rank: profile.rank,
      leaguePoints: profile.leaguePoints,
      wins: profile.wins,
      losses: profile.losses,
      flexTier: profile.flexTier,
      flexRank: profile.flexRank,
      flexLeaguePoints: profile.flexLeaguePoints,
      flexWins: profile.flexWins,
      flexLosses: profile.flexLosses,
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
      UPDATE players SET
        puuid=?, current_tier=?, current_rank=?, current_lp=?, current_wins=?, current_losses=?,
        flex_tier=?, flex_rank=?, flex_lp=?, flex_wins=?, flex_losses=?,
        top_champions_json=?, last_synced_at=?
      WHERE id = ?
    `).run(
      profile.puuid, profile.tier, profile.rank, profile.leaguePoints, profile.wins, profile.losses,
      profile.flexTier, profile.flexRank, profile.flexLeaguePoints, profile.flexWins, profile.flexLosses,
      JSON.stringify(profile.topChampions), now, player.id
    );
    res.json(serialize(db.prepare('SELECT * FROM players WHERE id = ?').get(player.id)));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// 최근 N경기(match-v5) 챔피언별 전적 — 호출량이 커서 온디맨드(버튼 클릭)로만 조회, 결과는 캐싱.
router.post('/:id/recent-stats', async (req, res) => {
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
  if (!player) return res.status(404).json({ error: '참가자를 찾을 수 없습니다' });
  if (!player.puuid) return res.status(400).json({ error: 'PUUID 정보가 없습니다. 먼저 새로고침해주세요.' });

  const forceRefresh = req.query.force === '1';
  const cachedAt = player.recent_stats_fetched_at ? new Date(player.recent_stats_fetched_at).getTime() : 0;
  const isFresh = player.recent_stats_json && Date.now() - cachedAt < RECENT_STATS_CACHE_MS;

  if (!forceRefresh && isFresh) {
    return res.json({ stats: JSON.parse(player.recent_stats_json), fetchedAt: player.recent_stats_fetched_at, fromCache: true });
  }

  try {
    const stats = await fetchRecentChampionStats(player.puuid, RECENT_GAMES_COUNT);
    const now = new Date().toISOString();
    db.prepare('UPDATE players SET recent_stats_json = ?, recent_stats_fetched_at = ? WHERE id = ?')
      .run(JSON.stringify(stats), now, player.id);
    res.json({ stats, fetchedAt: now, fromCache: false });
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
    wins: p.current_wins,
    losses: p.current_losses,
    flexTier: p.flex_tier,
    flexRank: p.flex_rank,
    flexLeaguePoints: p.flex_lp,
    flexWins: p.flex_wins,
    flexLosses: p.flex_losses,
    topChampions: p.top_champions_json ? JSON.parse(p.top_champions_json) : [],
    recentStats: p.recent_stats_json ? JSON.parse(p.recent_stats_json) : null,
    recentStatsFetchedAt: p.recent_stats_fetched_at,
    opggUrl: `https://op.gg/lol/summoners/kr/${encodeURIComponent(p.riot_game_name)}-${encodeURIComponent(p.riot_tag_line)}`,
    lastSyncedAt: p.last_synced_at,
  };
}

module.exports = router;
