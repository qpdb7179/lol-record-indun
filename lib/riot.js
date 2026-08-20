const REGION_ROUTE = 'asia'; // account-v1 지역 라우팅 (KR 포함)
const PLATFORM_ROUTE = 'kr'; // summoner/league/mastery 플랫폼 라우팅

function apiKey() {
  const key = process.env.RIOT_API_KEY;
  if (!key) throw new Error('RIOT_API_KEY가 설정되지 않았습니다 (.env 확인)');
  return key;
}

async function riotFetch(url) {
  const res = await fetch(url, { headers: { 'X-Riot-Token': apiKey() } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Riot API 오류 ${res.status}: ${body || res.statusText}`);
  }
  return res.json();
}

function getAccountByRiotId(gameName, tagLine) {
  const url = `https://${REGION_ROUTE}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
  return riotFetch(url); // { puuid, gameName, tagLine }
}

function getLeagueEntriesByPuuid(puuid) {
  const url = `https://${PLATFORM_ROUTE}.api.riotgames.com/lol/league/v4/entries/by-puuid/${puuid}`;
  return riotFetch(url); // [{queueType, tier, rank, leaguePoints, ...}]
}

function getTopChampionMasteries(puuid, count) {
  const url = `https://${PLATFORM_ROUTE}.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}/top?count=${count}`;
  return riotFetch(url); // [{championId, championLevel, championPoints}]
}

const RECENT_GAMES_COUNT = 7; // API 호출량(프로필당 1+N건) 실측 후 결정한 기본값

function getMatchIdsByPuuid(puuid, count) {
  // match-v5는 account-v1과 같은 지역(REGION_ROUTE) 라우팅을 씀 — kr이 아니라 asia
  const url = `https://${REGION_ROUTE}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=${count}`;
  return riotFetch(url); // [matchId, ...]
}

function getMatchDetail(matchId) {
  const url = `https://${REGION_ROUTE}.api.riotgames.com/lol/match/v5/matches/${matchId}`;
  return riotFetch(url);
}

// 최근 N경기(전체 큐, 랭크 필터 없음)를 챔피언별로 집계 — 호출량: 1(목록) + N(상세)
async function fetchRecentChampionStats(puuid, count = RECENT_GAMES_COUNT) {
  const matchIds = await getMatchIdsByPuuid(puuid, count);
  const matches = await Promise.all(matchIds.map((id) => getMatchDetail(id)));

  const byChampion = new Map();
  let totalWins = 0;
  for (const match of matches) {
    const p = match.info.participants.find((x) => x.puuid === puuid);
    if (!p) continue;
    if (p.win) totalWins += 1;
    const entry = byChampion.get(p.championId) || {
      championId: p.championId, games: 0, wins: 0, kills: 0, deaths: 0, assists: 0,
    };
    entry.games += 1;
    if (p.win) entry.wins += 1;
    entry.kills += p.kills;
    entry.deaths += p.deaths;
    entry.assists += p.assists;
    byChampion.set(p.championId, entry);
  }

  const perChampion = [...byChampion.values()]
    .map((e) => ({
      championId: e.championId,
      games: e.games,
      wins: e.wins,
      losses: e.games - e.wins,
      winRate: Math.round((e.wins / e.games) * 100),
      kda: e.deaths > 0 ? Number(((e.kills + e.assists) / e.deaths).toFixed(2)) : null,
      avgKills: Number((e.kills / e.games).toFixed(1)),
      avgDeaths: Number((e.deaths / e.games).toFixed(1)),
      avgAssists: Number((e.assists / e.games).toFixed(1)),
    }))
    .sort((a, b) => b.games - a.games);

  return {
    totalGames: matches.length,
    totalWins,
    totalLosses: matches.length - totalWins,
    perChampion,
  };
}

async function fetchPlayerProfile(gameName, tagLine) {
  const account = await getAccountByRiotId(gameName, tagLine);
  const [entries, topMasteries] = await Promise.all([
    getLeagueEntriesByPuuid(account.puuid),
    getTopChampionMasteries(account.puuid, 3),
  ]);
  // 솔로랭크(RANKED_SOLO_5x5)는 다른 큐로 대체하지 않고 없으면 그냥 언랭 처리. 자유랭크(RANKED_FLEX_SR)도 별도로 같이 가져옴.
  const solo = entries.find((e) => e.queueType === 'RANKED_SOLO_5x5') || null;
  const flex = entries.find((e) => e.queueType === 'RANKED_FLEX_SR') || null;

  return {
    puuid: account.puuid,
    gameName: account.gameName,
    tagLine: account.tagLine,
    tier: solo ? solo.tier : null,
    rank: solo ? solo.rank : null,
    leaguePoints: solo ? solo.leaguePoints : null,
    wins: solo ? solo.wins : null,
    losses: solo ? solo.losses : null,
    flexTier: flex ? flex.tier : null,
    flexRank: flex ? flex.rank : null,
    flexLeaguePoints: flex ? flex.leaguePoints : null,
    flexWins: flex ? flex.wins : null,
    flexLosses: flex ? flex.losses : null,
    topChampions: topMasteries.map((m) => ({
      championId: m.championId,
      championLevel: m.championLevel,
      championPoints: m.championPoints,
    })),
  };
}

module.exports = { fetchPlayerProfile, fetchRecentChampionStats, RECENT_GAMES_COUNT };
