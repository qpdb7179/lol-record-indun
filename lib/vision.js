// 사설(내전) 게임은 Riot 공식 API로 가져올 방법이 없어서(match-v5에서 커스텀 게임 지원이
// 의도적으로 빠짐 — CLAUDE.md 참고) 대신 경기 종료 후 "점수판" 스크린샷을 비전 모델로 읽어서
// 세트 입력 폼을 자동으로 채우는 데 씀. Claude Sonnet 5로 테스트했을 때만 챔피언 초상화 인식과
// 한글 닉네임 OCR이 실용적인 수준이었고(Haiku는 닉네임을 잘못 읽고 챔피언 필드에 닉네임을 그대로
// 복붙하는 등 못 씀), 이미지 1장당 비용은 약 $0.02 수준.
const MODEL = 'claude-sonnet-5';

const EXTRACT_PROMPT = `이 이미지는 리그 오브 레전드 커스텀 게임(내전)의 경기 종료 후 "점수판" 탭 화면입니다.
화면 상단 그룹("1번 팀")과 하단 그룹("2번 팀") 각각 5명씩, 총 10명의 정보를 추출해주세요.

각 선수마다 다음 필드를 가진 JSON 객체로:
- team: 팀 이름 텍스트("1번 팀"/"2번 팀")가 청록색이면 "blue", 빨간색이면 "red"
- playerName: 화면에 표시된 이름 문자열 그대로(말줄임표로 잘려있으면 잘린 그대로 정확히 옮길 것)
- championName: 챔피언 초상화를 보고 판별한 챔피언 이름(한국어 또는 영어). 이름 텍스트를 그대로 복사하지 말고
  반드시 초상화 이미지를 보고 실제 챔피언을 판별할 것.
- kills, deaths, assists: 정수
- cs: 정수(미니언+정글몹 처치 수 합계 컬럼)

다른 설명 없이 JSON 배열만 출력하세요.`;

async function extractScoreboard(imageBase64, mediaType) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/png', data: imageBase64 } },
          { type: 'text', text: EXTRACT_PROMPT },
        ],
      }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`스크린샷 분석 API 오류 ${res.status}: ${body || res.statusText}`);
  }

  const data = await res.json();
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock) throw new Error('스크린샷 분석 결과를 받지 못했습니다');

  const jsonMatch = textBlock.text.match(/\[[\s\S]*\]/);
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
