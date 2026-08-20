const TTL_MS = 6 * 60 * 60 * 1000; // 6시간마다 패치 버전/챔프 목록 갱신

let cache = { champions: null, byNumericKey: null, fetchedAt: 0 };

async function loadChampions() {
  const now = Date.now();
  if (cache.champions && now - cache.fetchedAt < TTL_MS) return cache;

  const versions = await fetch('https://ddragon.leagueoflegends.com/api/versions.json').then((r) => r.json());
  const version = versions[0];
  const data = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/ko_KR/champion.json`).then((r) => r.json());

  const champions = Object.values(data.data).map((c) => ({
    championId: Number(c.key),
    id: c.id,
    name: c.name,
    imageUrl: `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${c.image.full}`,
  }));
  const byNumericKey = new Map(champions.map((c) => [c.championId, c]));

  cache = { champions, byNumericKey, fetchedAt: now };
  return cache;
}

async function getChampionList() {
  const { champions } = await loadChampions();
  return champions;
}

module.exports = { getChampionList };
