const express = require('express');
const db = require('../db');
const { extractScoreboard } = require('../lib/vision');
const { getChampionList } = require('../lib/dataDragon');

const router = express.Router();

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[\s.]/g, '');
}

function matchChampion(rawName, champions) {
  const n = normalize(rawName);
  if (!n) return null;
  const exact = champions.find((c) => normalize(c.name) === n || normalize(c.id) === n);
  if (exact) return exact.championId;
  // 모델이 스킨 이름 등 살짝 다른 표기를 줄 수 있어서 부분 일치도 시도하되,
  // 후보가 정확히 하나로 좁혀질 때만 채택(애매하면 사람이 고르게 비워둠).
  const partial = champions.filter((c) => normalize(c.name).includes(n) || n.includes(normalize(c.name)));
  return partial.length === 1 ? partial[0].championId : null;
}

function matchPlayer(rawName, players) {
  if (!rawName) return null;
  const exact = players.find((p) => normalize(p.riot_game_name) === normalize(rawName) || normalize(p.display_name) === normalize(rawName));
  if (exact) return exact.id;
  // 게임 클라이언트가 긴 닉네임을 "..."/"…"으로 잘라 보여주는 경우 — 그 잘린 접두사로
  // 시작하는 등록 참가자가 정확히 한 명일 때만 채택(여러 명이면 사람이 고르게 비워둠).
  if (/[.…]\s*$/.test(rawName)) {
    const prefix = normalize(rawName).replace(/[.…]+$/, '');
    if (prefix) {
      const candidates = players.filter((p) => normalize(p.riot_game_name).startsWith(prefix));
      if (candidates.length === 1) return candidates[0].id;
    }
  }
  return null;
}

function toIntOrNull(v) {
  return Number.isInteger(v) && v >= 0 ? v : null;
}

const VALID_LANES = new Set(['top', 'jungle', 'mid', 'adc', 'support']);
function toLaneOrNull(v) {
  return VALID_LANES.has(v) ? v : null;
}

router.post('/extract-scoreboard', async (req, res) => {
  const { imageBase64, mediaType, banZoomBase64 } = req.body;
  if (!imageBase64) return res.status(400).json({ error: '이미지가 필요합니다' });

  try {
    const { players: raw, blueBans, redBans } = await extractScoreboard(imageBase64, mediaType, banZoomBase64);
    const champions = await getChampionList();
    const players = db.prepare('SELECT id, riot_game_name, display_name FROM players').all();

    const unmatchedPlayers = [];
    const unmatchedChampions = [];
    const unmatchedBans = [];
    const result = raw.map((r) => {
      const playerId = matchPlayer(r.playerName, players);
      const championId = matchChampion(r.championName, champions);
      if (!playerId) unmatchedPlayers.push(r.playerName);
      if (!championId) unmatchedChampions.push(r.championName);
      return {
        team: r.team === 'red' ? 'red' : 'blue',
        playerId,
        championId,
        lane: toLaneOrNull(r.lane),
        rawPlayerName: r.playerName,
        rawChampionName: r.championName,
        kills: toIntOrNull(r.kills),
        deaths: toIntOrNull(r.deaths),
        assists: toIntOrNull(r.assists),
        cs: toIntOrNull(r.cs),
        gold: toIntOrNull(r.gold),
      };
    });

    const matchBans = (names) => names.map((name) => {
      const championId = matchChampion(name, champions);
      if (!championId) unmatchedBans.push(name);
      return championId;
    }).filter(Boolean);

    const bans = { blue: matchBans(blueBans), red: matchBans(redBans) };

    res.json({ players: result, bans, unmatchedPlayers, unmatchedChampions, unmatchedBans });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
