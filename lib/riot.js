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

async function fetchPlayerProfile(gameName, tagLine) {
  const account = await getAccountByRiotId(gameName, tagLine);
  const [entries, topMasteries] = await Promise.all([
    getLeagueEntriesByPuuid(account.puuid),
    getTopChampionMasteries(account.puuid, 3),
  ]);
  const solo = entries.find((e) => e.queueType === 'RANKED_SOLO_5x5') || entries[0] || null;

  return {
    puuid: account.puuid,
    gameName: account.gameName,
    tagLine: account.tagLine,
    tier: solo ? solo.tier : null,
    rank: solo ? solo.rank : null,
    leaguePoints: solo ? solo.leaguePoints : null,
    topChampions: topMasteries.map((m) => ({
      championId: m.championId,
      championLevel: m.championLevel,
      championPoints: m.championPoints,
    })),
  };
}

module.exports = { fetchPlayerProfile };
