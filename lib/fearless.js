const db = require('../db');

// 같은 시리즈의 이전 세트(들)에서 밴 또는 픽으로 이미 쓰인 챔피언 id 집합 (피어리스 드래프트 검증용)
function getUsedChampionIds(seriesId, beforeSetNumber) {
  const rows = db.prepare(`
    SELECT sp.champion_id AS championId FROM set_participants sp
    JOIN sets s ON s.id = sp.set_id
    WHERE s.series_id = ? AND s.set_number < ?
    UNION
    SELECT sb.champion_id AS championId FROM set_bans sb
    JOIN sets s ON s.id = sb.set_id
    WHERE s.series_id = ? AND s.set_number < ?
  `).all(seriesId, beforeSetNumber, seriesId, beforeSetNumber);
  return new Set(rows.map((r) => r.championId));
}

module.exports = { getUsedChampionIds };
