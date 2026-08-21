// 사설(내전) 게임은 Riot API로 가져올 방법이 없어서(match-v5에서 커스텀 게임 지원이 의도적으로
// 빠짐 — CLAUDE.md 참고) 대신 경기 종료 후 "점수판" 스크린샷을 비전 모델로 읽어서 세트 입력 폼을
// 자동으로 채우는 데 씀. 처음엔 Claude Sonnet 5로 시도했는데 챔피언 초상화(44×44px 정도)를 반복
// 호출마다 다르게 판별해서(사실상 무작위) 못 썼음 — Gemini(gemini-flash-latest)로 바꾸니 같은
// 이미지를 5번 반복 호출해도 10명 중 8명은 완벽히 일치, 나머지 2명도 4/5 일치할 정도로 훨씬
// 안정적이었고 비용도 이미지 1장당 더 저렴함($0.007 vs $0.02). 선수 이름·K/D/A·CS·골드는 둘 다
// 원래도 정확했음.
const MODEL = 'gemini-flash-latest';

const EXTRACT_PROMPT = `이 이미지는 리그 오브 레전드 커스텀 게임(내전)의 경기 종료 후 "점수판" 탭 화면입니다.
화면 상단 그룹("1번 팀")과 하단 그룹("2번 팀") 각각 5명씩, 총 10명의 정보를 추출해주세요.

각 선수마다 다음 필드를 가진 JSON 객체로:
- team: 팀 이름 텍스트("1번 팀"/"2번 팀")가 청록색이면 "blue", 빨간색이면 "red"
- playerName: 화면에 표시된 이름 문자열 그대로(말줄임표로 잘려있으면 잘린 그대로 정확히 옮길 것)
- championName: 챔피언 초상화를 보고 판별한 챔피언 이름(한국어 또는 영어). 이름 텍스트를 그대로 복사하지 말고
  반드시 초상화 이미지를 보고 실제 챔피언을 판별할 것.
- kills, deaths, assists: 정수
- cs: 정수(미니언+정글몹 처치 수 합계 컬럼)
- gold: 정수(골드 컬럼, 쉼표 없이 숫자만)

다른 설명 없이 JSON 배열만 출력하세요.`;

// Gemini가 "high demand"로 503을 꽤 자주 돌려줘서(테스트 중 체감상 3~4번에 1번꼴) 그냥 실패
// 처리하면 사용자가 매번 재시도 버튼을 눌러야 해서 번거로움 — 503/429일 때만 잠깐 쉬고 재시도.
async function callGemini(apiKey, imageBase64, mediaType) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  const body = JSON.stringify({
    contents: [{
      parts: [
        { inline_data: { mime_type: mediaType || 'image/png', data: imageBase64 } },
        { text: EXTRACT_PROMPT },
      ],
    }],
  });

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    if (res.ok) return res.json();
    if ((res.status === 503 || res.status === 429) && attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, attempt * 1500));
      continue;
    }
    const errBody = await res.text().catch(() => '');
    throw new Error(`스크린샷 분석 API 오류 ${res.status}: ${errBody || res.statusText}`);
  }
}

async function extractScoreboard(imageBase64, mediaType) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다');

  const data = await callGemini(apiKey, imageBase64, mediaType);
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  if (!text) throw new Error('스크린샷 분석 결과를 받지 못했습니다');

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('스크린샷 분석 결과를 해석하지 못했습니다');

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error('스크린샷 분석 결과가 올바른 형식이 아닙니다');
  }
  if (!Array.isArray(parsed) || parsed.length !== 10) {
    throw new Error(`스크린샷에서 10명이 아니라 ${Array.isArray(parsed) ? parsed.length : '알 수 없는'}명이 인식되었습니다. 점수판 탭 전체가 보이는 스크린샷인지 확인해주세요.`);
  }
  return parsed;
}

module.exports = { extractScoreboard };
