# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

**lol-record-indun** — 리그 오브 레전드 사설방(내전) 5v5 전적 기록 사이트. 공식 전적 검색 사이트는 사설방(커스텀) 게임 기록을 보여주지 않기 때문에, 지인들끼리 하는 내전 이력을 수동으로 남기고 통계를 보기 위해 만듦.

과거(2026-08 이전) 같은 계정으로 한 번 만들었던 프로젝트였으나 호스팅 서버가 삭제되며 소스도 함께 유실됨(대화 로그로도 복구 불가 확인). 이번엔 그 실수를 되풀이하지 않기 위해 ① GitHub(private repo)에 소스를 남기고 ② 배포를 이 서버(indun.cloud EC2)의 k3s+ArgoCD GitOps 파이프라인에 태워서, 서버가 통째로 사라져도 새 서버에서 k3s 설치 + ArgoCD sync 몇 번으로 복구 가능하게 함.

Node.js/Express 백엔드 + 바닐라 JS 프론트엔드(indun 프로젝트와 동일한 스타일, 빌드 스텝 없음) + SQLite(`better-sqlite3`).

## Commands

```bash
# 의존성 설치
npm install

# 로컬 실행
node server.js
# 또는
npm start
```

빌드 스텝, 테스트, 린트 없음.

## Architecture

- `server.js` — Express 앱 엔트리포인트. `public/` 정적 서빙, `/api/champions`(Data Dragon 프록시), `/api/players`, `/api/series`, `/api/stats` 라우트 마운트.
- `db.js` — SQLite 연결 및 스키마(`players`, `series`, `series_rosters`, `sets`, `set_participants`, `set_bans`). `DB_PATH` 환경변수로 파일 위치 지정(기본 `./data/lol-record-indun.db`), 없는 디렉토리는 자동 생성.
- `lib/riot.js` — Riot 공식 API 클라이언트. Account-v1(`asia` 라우팅)으로 riotId→PUUID, League-v4/Champion-Mastery-v4(`kr` 라우팅, 둘 다 **by-puuid**)로 티어·숙련도 상위 3개 조회. `RIOT_API_KEY` 환경변수 필요(없으면 참가자 등록/새로고침 API가 에러 반환). 솔로랭크(`RANKED_SOLO_5x5`)와 자유랭크(`RANKED_FLEX_SR`)를 각각 별도로 가져옴(둘 다 `entries` 배열에서 `queueType`으로 찾음) — 솔로랭크는 없으면 다른 큐로 대체하지 않고 그냥 언랭 처리(예전엔 `entries[0]` 폴백이 있어서 자유랭크가 솔로랭크인 것처럼 보일 수 있었음, 제거함). 각 큐마다 `tier/rank/leaguePoints/wins/losses` 반환(참가자 상세 모달의 승패·승률 표시에 사용).
  - **2026-08-20 버그 수정**: 원래 `summoner-v4`로 암호화된 summonerId를 받아 `league-v4`(`by-summoner`)를 호출했는데, Riot API가 `summoner-v4` 응답에서 `id` 필드를 더 이상 내려주지 않게 바뀌어서 `by-summoner/undefined` 호출이 되며 403이 발생했음. `league-v4`가 이제 `by-puuid`도 지원해서 summoner-v4 호출 자체를 없애고 puuid로 직접 조회하도록 변경(`players.summoner_id` 컬럼도 함께 제거).
- `lib/dataDragon.js` — Riot Data Dragon(`ddragon.leagueoflegends.com`)에서 최신 패치의 챔피언 목록(한글명+이미지 URL)을 가져와 6시간 캐싱. API 키 불필요.
- `lib/fearless.js` — `getUsedChampionIds(seriesId, beforeSetNumber)`: 같은 시리즈의 이전 세트들에서 밴/픽으로 쓰인 챔피언 id 집합을 반환. 피어리스 드래프트(이번 시즌 LCK 방식 — 한 시리즈 내에서 이미 쓴 챔피언은 이후 세트에서 밴/픽 불가) 검증에 사용.
- `routes/players.js` — 참가자 등록(Riot API 조회 후 upsert)/목록/새로고침/삭제. `displayName`(실명/닉네임, 선택)은 Riot 데이터와 무관하게 사용자가 직접 입력해 저장. op.gg 링크는 `https://op.gg/lol/summoners/kr/{gameName}-{tagLine}` 형태로 생성만 하고 스크래핑은 하지 않음(ToS 이슈 회피).
  - `POST /:id/recent-stats` — match-v5 기반 최근 `RECENT_GAMES_COUNT`(7)경기 챔피언별 전적. **온디맨드 전용**(참가자 목록/등록 시 자동 호출 안 함) — 프로필 1개당 API 호출이 1(목록)+N(상세)건이라 비쌈(아래 상태 로그의 레이트리밋 실측 참고). `players.recent_stats_json`/`recent_stats_fetched_at`에 결과를 캐싱하고 **1시간**(`RECENT_STATS_CACHE_MS`) 이내 재요청은 캐시 반환, `?force=1`이면 캐시 무시하고 강제 재조회.
- `routes/series.js` — 시리즈(Bo3/Bo5) 생성 및 세트 기록의 핵심 로직:
  - **로스터 A/B 개념**: 시리즈 내 두 팀은 색(블루/레드)이 세트마다 바뀌므로, 1세트에서 블루였던 5명을 로스터 A, 레드였던 5명을 로스터 B로 `series_rosters`에 고정 저장. 이후 세트는 제출된 10명이 정확히 로스터 A/B와 일치해야 하며, 직전 세트와 같은 진영(블루 로스터)이면 400 에러(매 세트 진영 스왑 강제).
  - **피어리스 검증**: `lib/fearless.js`로 이전 세트 사용 챔피언 집합을 구해 새 세트의 밴+픽 전체와 교집합 있으면 400.
  - **세트 내 중복 검증**: `validateSetPayload`가 양팀 픽 10개 + 양팀 밴 전체를 합쳐 같은 세트 안에서 챔피언이 중복되면 400 (피어리스와 별개로, 애초에 한 세트 안에서도 같은 챔프를 두 명이 쓸 수 없다는 기본 규칙).
  - **시리즈 자동 종료**: 세트 저장 후 로스터별 승수를 집계해 Bo3=2승/Bo5=3승 도달 시 `series.status='completed'` (`recomputeSeriesStatus()`).
  - `DELETE /:id`— 시리즈 삭제(세트/로스터/참가자/밴은 FK `ON DELETE CASCADE`로 함께 삭제).
  - `PUT /:id/sets/:setId` — **어느 세트든** 수정 가능(처음엔 마지막 세트만 허용했다가, 사용자 요청으로 전체 세트로 확장). 선수 구성(어느 로스터가 그 세트에 참여했는지)은 절대 안 바뀌고 라인/챔피언/밴/승자만 수정 가능. 안전장치 두 가지:
    1. **피어리스**: `getUsedChampionIdsExcludingSet()`으로 "이 세트를 제외한 시리즈의 나머지 전체"(이전+이후)와 비교 — `beforeSetNumber` 기준(생성 시 쓰는 것)과 달리 이후 세트와도 충돌 검사해야 함.
    2. **완료 시점 모순 방지**: 승자를 바꾸면 시리즈가 몇 세트 만에 끝났어야 했는지 세트 번호 순으로 시뮬레이션(`decidedAt`)해서, 그게 실제 마지막으로 기록된 세트 번호보다 이르면(그 뒤에 이미 세트가 존재하면) 400으로 거부 — "이미 끝났어야 할 시리즈에 그 뒤 게임이 존재하는" 모순 상태를 막음. 걸리면 사용자가 그 뒤 세트를 먼저 지우고 수정해야 함(현재 세트 단위 삭제 API는 없고 시리즈 전체 삭제만 있음 — 필요해지면 추가 고려).
    - `existingParticipants`와 새 payload의 플레이어 집합이 정확히 같은지(`sameMembers`) 검증 후 참가자/밴을 지우고 다시 넣고, `recomputeSeriesStatus()`로 시리즈 완료 상태를 처음부터 다시 계산(수정으로 완료↔진행중이 양방향으로 바뀔 수 있음).
- `routes/stats.js` — 챔피언별 픽률/승률/밴률, 플레이어별 승률·선호 라인. 승패 판정은 `set.team(blue/red)`가 `sets.blue_roster/red_roster` 중 `winner_roster`와 일치하는지로 계산(로스터 A/B ↔ 그날의 블루/레드 매핑이 세트마다 바뀌므로 매번 join해서 판정).
- `public/app.js` — 프론트 전체 로직. 3탭(참가자 관리/전적 기록/통계) 전환.
  - **챔피언 이미지 피커**: `<select>` 대신 버튼(`.champion-slot`) 클릭 → 검색 가능한 이미지 그리드 모달(`#championPickerModal`). `computeDisabledChampionIds()`가 피어리스(이전 세트, `/api/series/:id/used-champions`) + 현재 폼에서 이미 선택된 챔프(자기 자신 제외)를 합쳐 실시간으로 회색처리/선택불가 처리 — 백엔드 중복 검증과 이중 방어.
  - **드래그로 라인 교체**: `.lane-row`에 `draggable`, 같은 `.team-block` 안에서 드롭하면 두 라인의 (선수+챔피언)을 통째로 스왑(`swapRowContents`) — 챔피언은 라인이 아니라 선수를 따라감.
  - **2세트 이후 기본 배정**: `laneMapFromLastSet()`으로 직전 세트에 그 로스터가 서 있던 라인을 그대로 기본값으로 채워줌(드래그로 바꿀 수 있음). 이때 로스터 항목은 `{playerId, riotId, displayName}` 형태라 `state.players`의 `{id, ...}`와 필드명이 달라서, `renderTeamInputs`에서 `id: p.id ?? p.playerId`로 통일해야 함 — **한 번 여기서 실제로 버그 났었음**(값이 `"undefined"` 문자열로 들어가 2세트 폼이 통째로 깨짐), 이 필드 통일 없이 로스터 배열을 직접 select 옵션에 넣지 말 것.
  - **게임(세트) 수정**: `renderGameCard()`가 **모든** 게임 카드에 "수정" 버튼을 그림(백엔드가 어느 세트든 수정 허용하도록 확장됨 — 아래 상태 로그 참고). 클릭 시 `state.editingSetId` 설정 → `renderActiveSeries()`가 "다음 세트 입력" 폼 대신 그 세트의 기존 데이터로 채운 편집 폼을 렌더(`renderTeamInputs`에 `includeChampionDefaults:true`, `banDefaults`로 기존 값 프리필, `allowedPlayers`는 그 세트의 고정 `blueTeam`/`redTeam`이라 라인만 바꿀 수 있음). 저장은 `submitSet(e, editingSetId)`가 `editingSetId` 유무로 POST(새 세트)/PUT(수정)을 분기. 피어리스 비활성화 조회는 `beforeSet`이 아니라 `excludeSet=<setId>`로 호출(수정 중인 세트를 제외한 시리즈 전체와 비교해야 하므로 — 생성 흐름의 "이전 세트만" 조회와 파라미터가 다름, 헷갈리지 말 것).
  - **라인 아이콘**: Data Dragon엔 포지션 아이콘이 없어서 Community Dragon 미러(`raw.communitydragon.org/.../svg/position-{top,jungle,middle,bottom,utility}.svg`)에서 로드 — 라이엇 클라이언트가 실제로 쓰는 자산이지만 라이엇이 직접 운영하는 도메인은 아님(Data Dragon처럼 공식 문서화된 API가 아니라 게임 파일 추출 미러라는 점 인지하고 있을 것 — 만약 나중에 이 미러가 죽으면 `LANE_ICON_URL`만 교체하면 됨).
  - **티어 엠블럼**: 같은 이유로 Community Dragon `.../images/ranked-mini-crests/{tier}.svg`에서 로드(`tierIconUrl()`, tier는 소문자로 변환해서 사용).
  - **밴 슬롯(고정 5개 + '없음')**: 원래 `+` 버튼으로 자유롭게 추가/제거하던 방식이었는데, 추가했다가 밴을 안 하고 나가면 이유 없이 제거(×) 아이콘만 남는 문제로 사용자가 혼란스러워함 → 팀당 항상 5슬롯을 고정으로 렌더(`renderTeamInputs`에서 `Array.from({length:5}, ...)`)하고, 각 슬롯은 실제 챔피언 또는 문자열 `'none'`(명시적 "없음")으로 결정해야 함. `'none'`은 챔피언 피커 모달의 `#noBanBtn`("밴 없음으로 표시", 밴 슬롯을 열 때만 보임)으로 설정. `submitSet()`이 제출 전에 `.ban-slot[data-champion-id=""]`(아직 미결정)가 하나라도 있으면 막음 — `collectBans()`는 `Number('none')`이 `NaN`이라 자동으로 걸러져서 실제로 밴한 챔피언만 서버로 감(별도 분기 처리 불필요).
  - **시리즈 목록 아코디언**: 예전엔 시리즈 목록(하단)을 클릭하면 상세가 `#activeSeries`(상단)에 렌더돼서 매번 스크롤을 위로 올려야 하는 게 불편하다는 피드백 → `loadSeriesList()`/`renderSeriesList()`로 분리하고, **진행중** 시리즈는 여전히 상단으로 끌어올리지만(입력 폼이 거기 있어서), **완료된** 시리즈는 목록 안 그 항목 바로 아래(`.series-expand`)에 그 자리에서 펼쳐짐(아코디언, `state.expandedSeriesId`/`expandedSeriesData`로 토글, 재클릭하면 접힘). 목록 안에서 펼친 카드의 "수정" 버튼을 누르면 그때는 편집 폼이 필요하니 상단으로 끌어올림(`state.activeSeries = state.expandedSeriesData`) — 조회는 제자리, 수정만 상단이라는 원칙.
  - **참가자 상세 모달**: 참가자 카드를 클릭(단, `<button>`/`<a>` 클릭은 제외 — 새로고침/삭제/op.gg 버튼과 겹치지 않게 `e.target.closest('button[data-action]')`/`closest('a')`로 먼저 걸러냄)하면 `#playerDetailModal`이 열리고 솔로랭크/자유랭크 카드(티어 엠블럼+LP+승패+승률, `renderRankedQueueCard()`)와 숙련도 top3를 op.gg 위젯 느낌으로 보여줌(`/root/ex1.png`~`ex5.png` 참고). 참가자 카드 목록에 있던 숙련도 미니 아이콘 미리보기는 이 모달로 옮기면서 제거.
- `public/style.css` — 전체 다크 테마(`/root/example.png` 참고, 헤더/탭/폼/참가자카드/통계 테이블까지 전부 다크 톤 통일). 시리즈 카드만 골드 테두리(`--accent-gold`)로 살짝 강조.
  - **시리즈/게임 카드(다크 UI)**: `renderSeriesCard()`/`renderGameCard()` — `/root/example.png` 참고해서 만든 다크 테마. 상단 배지(포맷/피어리스(하드) 고정 표기/스코어/날짜/상태/삭제), 게임별로 **블루(왼쪽 고정)-VS-레드(오른쪽 고정)** 컬럼(그날의 실제 진영 기준, 로스터 기준 아님 — 밴픽 입력 폼과 좌우 배치를 통일해달라는 피드백으로 2026-08-20에 레드↔블루 순서를 뒤집음, 아래 상태 로그 참고) + 패배팀은 챔프 아바타/밴 아이콘/선수명·챔프명을 `opacity:0.4`로 흐리게 처리(`.game-team-col.lose`)해서 승리팀 강조. 밴 아이콘 행, 라인 아이콘(`laneIconImg()`, Community Dragon 이미지)+챔프 원형 아바타+선수명(표시이름)+챔프명. 상단 스코어(`X - Y`)는 로스터 A/B 기준이라 레드/블루 축과는 다르다는 점은 여전함 — 의도적 설계.

### 데이터 모델 요약
`players`(riot 계정+티어+숙련도 캐시) → `series`(날짜+포맷+상태) → `series_rosters`(시리즈별 로스터 A/B 고정) → `sets`(세트별 블루/레드 로스터+승자) → `set_participants`(세트별 선수-라인-챔프) / `set_bans`(세트별 밴 목록).

## 배포 환경 (코드만 봐서는 알 수 없는 실제 운영 정보)

- **서버**: 이 저장소는 indun.cloud와 같은 AWS EC2(Amazon Linux 2023)에서 개발됨. 실제 운영은 이 서버의 **k3s 클러스터**(별도 인프라 랩 프로젝트로 구축) 위에서 돎 — 기존 indun처럼 systemd가 아님.
- **컨테이너**: `Dockerfile`(node:18-alpine, better-sqlite3 소스 빌드를 위해 python3/make/g++ 설치). 이미지는 **GitHub Actions**(`.github/workflows/build.yml`)가 main 브랜치 push마다 빌드해서 `ghcr.io/qpdb7179/lol-record-indun`(`:latest`, `:<sha>`)로 푸시. 이 서버엔 docker가 없어서(containerd만 있음) 로컬 빌드 대신 이 방식을 씀.
- **k8s 매니페스트**: 앱 코드는 이 repo, k8s 리소스(Deployment/Service/PVC/ArgoCD Application)는 별도 GitOps repo `k3s-lab`(`/root/k3s-lab`, `github.com/qpdb7179/k3s-lab`)의 `manifests/lol-record-indun/`에 있음. ArgoCD가 그 repo를 보고 자동 동기화.
- **배포 이미지 태그 & 롤백 (2026-08-20부터)**: `app.yaml`의 `image`는 더 이상 `:latest`가 아니라 **커밋 SHA로 고정**되어 있음(`:latest`+매번 재시작만으로는 진짜 롤백이 안 됨 — k8s가 새 리비전을 만들어도 이미지 태그 자체는 항상 최신 push를 가리켜서 `kubectl rollout undo`가 의미가 없었음). 배포 절차: ① `lol-record-indun` repo에 push, ② GitHub Actions가 `ghcr.io/qpdb7179/lol-record-indun:<새 sha>`를 빌드/푸시(자동), ③ `k3s-lab/manifests/lol-record-indun/app.yaml`의 `image:` 줄을 그 sha로 **직접 수정**해서 commit+push(수동, 의도적으로 자동화 안 함), ④ ArgoCD가 자동 동기화하거나 안 기다리려면 `kubectl patch application lol-record-indun -n argocd --type merge -p '{"operation":{"sync":{"revision":"main","prune":true}}}'`로 즉시 sync.
  **롤백하려면**: `app.yaml`의 `image:` 태그를 이전 sha로 되돌리고 위와 같이 push+sync만 하면 됨(새 이미지 빌드 필요 없음, GHCR에 이미 있는 이미지라 즉시 적용됨). 지금까지의 안정 지점: git tag **`stable-pre-match-v5`**(commit `3ef77d2`, match-v5/최근전적 기능 추가하기 전 마지막 안정 버전) — 문제 생기면 `image: ghcr.io/qpdb7179/lol-record-indun:3ef77d25c66641a954aee092a42743b5adae7c50`로 되돌리면 그 시점으로 즉시 복구됨.
- **네트워크**: k3s의 Traefik/ServiceLB는 기존 nginx(indun.cloud가 80/443 사용 중)와 충돌 방지를 위해 비활성화된 상태 → 이 앱은 **NodePort 30081**로 노출, nginx(`/etc/nginx/conf.d/lol-record-indun.conf`)가 `lol-record.indun.site` → `127.0.0.1:30081`로 리버스 프록시.
- **DB 영속화**: SQLite 파일은 k3s PVC(local-path-provisioner, 이 노드에 로컬 저장)에 저장. 단일 노드 클러스터라 파드가 재시작돼도 유지되지만, EC2 인스턴스 자체가 삭제되면 함께 사라짐(별도 백업 없음 — 향후 개선 여지로 남겨둠).
- **Riot API 키**: `RIOT_API_KEY`는 git에 커밋하지 않고 k8s Secret으로 관리(서버에서 `kubectl create secret` 직접 실행). 초기엔 Personal(개발자) 키로 시작(24시간 만료, 수동 갱신 필요) — Production Key는 신청 후 승인되면 같은 방식으로 Secret 값만 교체.
- **DNS**: 이 서버엔 AWS 자격증명이 없어 Claude가 Route53 레코드를 직접 못 만듦 — `lol-record.indun.site` A레코드는 사용자가 직접 추가해야 함.

## 진행 상황 로그 (Status Log)

새 세션에서 작업을 이어받을 때는 이 섹션을 먼저 확인할 것.

- **2026-08-20**: 프로젝트 최초 생성. 참가자 관리/전적 기록(피어리스 드래프트+Bo3·Bo5+진영 스왑)/통계 3탭 전체 스캐폴딩 완료. 로컬에서 API 동작 검증 예정, 아직 배포 파이프라인(Docker/CI/k8s/nginx) 연결 전.
- **2026-08-20**: 프로젝트명을 `lol-recored-indun`(오타) → `lol-record-indun`으로 리네임. GitHub repo 이름 변경(`gh repo rename`, 자동 리다이렉트됨), 로컬 디렉토리 `/opt/lol-record-indun`으로 이동, 코드 내 모든 참조(package.json, DB_PATH 기본값, 로그 메시지, Dockerfile 이미지 태그) 일괄 치환. GHCR 이미지 이름도 `ghcr.io/qpdb7179/lol-record-indun`으로 바뀌므로 기존 `lol-recored-indun` 패키지는 더 이상 쓰지 않음(정리 필요시 GitHub 패키지 설정에서 수동 삭제).
- **2026-08-20**: GHCR 패키지 visibility를 public으로 바꿔도 계속 401(익명 pull 거부)이 나서 — UI 반영 지연인지 다른 원인인지 확인이 안 돼 — 대신 **imagePullSecret**(`ghcr-pull-secret`, `gh auth token`으로 발급한 개인 토큰 사용, git 미추적)으로 확정. private 유지가 오히려 기본값으로 더 안전해서 그대로 감.
- **2026-08-20**: 실제 Riot API 키로 참가자 등록 테스트 중 403 Forbidden 발견. 원인은 Riot이 `summoner-v4` 응답에서 암호화된 `id`(summonerId) 필드를 더 이상 내려주지 않게 바뀐 것 — 기존 코드가 `league-v4`를 `by-summoner/{undefined}`로 호출하고 있었음. `league-v4`가 이제 `by-puuid`도 지원해서 `lib/riot.js`에서 summoner-v4 호출 자체를 제거하고 puuid 기반으로 통일(`players.summoner_id` 컬럼도 함께 제거, 당시 DB에 실제 데이터 없어서 무손실). 실제 계정("Hide on bush#KR1")으로 티어(챌린저)·숙련도 top3까지 정상 조회 확인.
- **2026-08-20**: 도메인 `lol-record.indun.site`(가비아 관리) A레코드를 사용자가 직접 추가, certbot으로 Let's Encrypt 인증서 발급 완료(만료 2026-11-18, 자동 갱신 등록됨). `https://lol-record.indun.site`로 전체 배포 파이프라인(GitHub push → Actions → GHCR → ArgoCD → k3s → nginx) 엔드투엔드 검증 완료. **재구축 프로젝트 1차 완료.**
- **2026-08-20**: 사용자 피드백으로 전적 기록 탭 대폭 개선 — (1) 같은 세트 안에서 챔피언 중복 선택되던 버그 수정, (2) 챔피언 select를 이미지+검색 그리드 모달로 교체, (3) 같은 팀 내 선수 드래그로 라인 교체(챔피언도 같이 이동), (4) `/root/example.png`를 참고한 다크 테마 시리즈/게임 카드로 재설계, (5) 참가자 표시이름(실명) 필드 추가, (6) 시리즈 삭제 API/버튼 추가. indun의 Playwright 셋업을 이 프로젝트에도 적용해 실제 브라우저로 챔피언 피커·드래그스왑·중복방지·삭제·통계까지 전 플로우 검증 — 이 과정에서 "2세트 이후 로스터 select가 `p.playerId`를 `id`로 못 읽어 `option value="undefined"`가 되는" 실제 버그를 찾아 수정함(코드만 봐서는 안 보이고 실제 실행해봐야 드러나는 종류의 버그였음, 위 Architecture 섹션 `public/app.js` 항목 참고). 기존 배포 DB에 `display_name` 컬럼이 없어서 `db.js`에 `PRAGMA table_info` 기반 자동 마이그레이션 추가. 배포 후 라이브 사이트에서 사용자가 이미 실제로 등록해둔 참가자 10명(실계정, 실 티어) 데이터가 마이그레이션으로 손실 없이 유지됨을 확인.
- **2026-08-20**: 후속 피드백 3건 반영 — (1) 앱 전체를 example.png 톤의 다크 테마로 통일(헤더/탭/참가자관리/폼/통계 테이블까지, 기존엔 시리즈 카드만 다크였음), (2) 라인 아이콘을 자체 제작 SVG(방패/별/하트 모양)에서 라이엇 실제 게임 클라이언트 포지션 아이콘으로 교체(Community Dragon 미러 경유, `LANE_ICON_URL` 참고), (3) 시리즈의 **마지막 세트 수정** 기능 구현(`PUT /:id/sets/:setId`) — 선수 구성은 고정하고 라인/챔피언/밴/승자만 고칠 수 있고, 수정 후 시리즈 완료 상태를 처음부터 다시 계산(완료→진행중으로 되돌아갈 수도 있음). 마지막 세트가 아닌 중간 세트 수정은 의도적으로 막아둠(피어리스/로스터 정체성 연쇄 재계산 문제 때문 — 위 Architecture 참고). Playwright로 챔피언/승자 수정 후 스코어 재계산, 마지막 세트에만 "수정" 버튼 노출, 중간 세트 수정 시도 시 400 거부까지 전부 확인.
- **2026-08-20**: 사용자가 "모든 세트가 수정 가능해야 하는 거 아니냐"고 재질문 — 다시 검토해보니 선수 구성(로스터)은 애초에 수정 불가로 막아뒀기 때문에, 로스터 정체성 연쇄 문제는 사실 처음부터 발생하지 않는 것이었음(그건 팀 구성 자체를 바꿀 때만 문제). 남은 진짜 리스크는 두 가지뿐이라 그것만 안전장치로 막고 **모든 세트 수정 가능**하도록 확장:
  1. 피어리스: `getUsedChampionIds`(이전 세트만) 대신 `getUsedChampionIdsExcludingSet`(이 세트 제외 전체)로 교체 — 수정한 챔프가 이후 세트와 충돌하는 것도 잡아야 하므로.
  2. 승자 변경 시 "시리즈가 더 이른 세트에서 이미 끝났어야 하는데 그 뒤 세트가 실제 존재하는" 모순 상태 — 세트 번호 순으로 승수 시뮬레이션해서 그런 경우면 400으로 거부(사용자에게 그 뒤 세트부터 먼저 지우라고 안내).
  프론트는 모든 게임 카드에 "수정" 버튼을 띄우도록 변경, 피어리스 조회 파라미터도 `beforeSet`→`excludeSet`으로 교체. curl로 중간 세트 챔피언 수정 성공/피어리스 충돌 거부/모순되는 승자 변경 거부 3가지, Playwright로 3게임 전부에 수정 버튼 뜨고 실제 폼이 여는지까지 확인 후 배포.
- **2026-08-20**: UI 세부 피드백 6건 반영 —
  1. 결과 카드도 밴픽 입력 폼처럼 **블루팀을 항상 왼쪽**에 배치(기존엔 레드가 왼쪽이라 입력 폼과 좌우가 안 맞았음).
  2. 패배팀은 챔프 아바타/밴 아이콘/이름을 `opacity:0.4`로 흐리게 처리해 승리팀 강조(`.game-team-col.lose`).
  3. 밴을 **고정 5슬롯 + 명시적 "없음"** 방식으로 재설계, 5개를 다 정하기 전엔 제출 차단.
  4. 위 3번 재설계로 "밴 추가 후 취소하면 이유 없이 × 아이콘만 남는" 문제도 자연히 해결(그 UI 자체를 없앴으므로).
  5. 참가자 카드에서 표시이름을 넣으면 `...`으로 잘려 보이던 문제 수정 — riotId/표시이름을 한 줄에 욱여넣지 않고 줄바꿈해서 분리(`player-riotid`/`player-realname`).
  6. op.gg 링크를 버튼 스타일로(`opgg-btn`), 솔로랭크 전용으로 티어를 가져오도록 명확히 하고(`lib/riot.js`) 티어 엠블럼 이미지도 같이 표시(`tierIconUrl()`).
  Playwright로 6가지 전부(블루 왼쪽 배치, 패배팀 opacity 0.4 실측, 밴 5슬롯+없음 옵션+미완료 시 제출 차단, 긴 표시이름 안 잘림, 실제 챌린저 계정으로 솔로랭크 티어+엠블럼 로드) 확인 후 배포.
- **2026-08-20**: 추가 UX 개선 2건 —
  1. 시리즈 목록을 아코디언 방식으로 전환(완료된 시리즈는 목록 안 그 자리에서 펼침, 진행중 시리즈만 상단으로) — 위 Architecture `public/app.js` 항목 참고.
  2. 참가자 카드의 숙련도 미리보기를 없애고, 카드를 클릭하면 op.gg 위젯 스타일의 상세 모달(솔로/자유랭크 카드+숙련도 top3)이 뜨도록 변경. 이를 위해 `lib/riot.js`가 자유랭크와 두 큐의 승/패 수까지 가져오도록 확장, `players` 테이블에 `current_wins/current_losses/flex_tier/flex_rank/flex_lp/flex_wins/flex_losses` 컬럼 추가(기존 배포 DB용 마이그레이션 포함).
  사용자가 op.gg 스크린샷(`/root/ex1.png`~`ex5.png`)을 주면서 "챔피언별 KDA/승률/최근 폼, 포지션 비율, 최근 7일 승률"까지 원했으나, 이건 Riot **match-v5**(매치 기록) API가 별도로 필요해서 범위를 나눠 진행하기로 함(시즌별 티어 히스토리는 애초에 Riot API로 재현 불가 — op.gg 자체 크롤링 데이터라 공식 API엔 없음).
- **2026-08-20**: match-v5 확장 시 API 호출량을 실제 프로덕션 키로 측정 — `X-App-Rate-Limit` 헤더 확인 결과 이 키는 **여전히 기본 티어(100req/120s, 20req/1s)**임(프로덕션 키는 24시간 만료가 없어지는 것뿐이고, 레이트리밋 상향은 Riot에 별도로 신청해야 하는 것으로 확인됨 — "프로덕션 키 = 무제한"이 아님, 착각하기 쉬운 부분이라 기록해둠). 실측: 매치 ID 목록 1회 + 최근 20경기 상세 20회 = **프로필 1개당 21건**, 순차 호출 시 약 3초 소요, 실제로 앱 레이트리밋 카운트가 22로 정확히 올라가는 것까지 확인. 100/120s 예산 안에서 프로필을 4~5개만 연달아 열어도 다른 기능(참가자 등록/새로고침 등)까지 같이 429를 맞을 수 있다는 뜻 — 만약 나중에 이 기능을 붙인다면 ① 분석 경기 수를 줄이거나(10경기 = 11건) ② 서버에서 결과를 캐싱(예: 1시간)하거나 ③ 자동 조회가 아니라 사용자가 명시적으로 누르는 "최근 전적 불러오기" 버튼으로 온디맨드화하는 것 중 최소 하나는 같이 해야 함. 사용자에게 수치 보고 후 진행 여부는 보류 상태.

- **2026-08-20**: 위 실측 수치를 보고 사용자가 "7경기 + 캐싱 + 온디맨드 버튼"으로 진행 결정. 구현 순서:
  1. **롤백 안전망 먼저**: 배포 이미지를 `:latest`에서 **커밋 SHA 고정**으로 전환(`k3s-lab/manifests/lol-record-indun/app.yaml`), git tag `stable-pre-match-v5`(`lol-record-indun@3ef77d2`)로 이 시점을 표시. 자세한 롤백 절차는 위 "배포 이미지 태그 & 롤백" 항목 참고.
  2. `lib/riot.js`에 `getMatchIdsByPuuid`/`getMatchDetail`/`fetchRecentChampionStats`(챔피언별 게임수/승패/KDA 집계) 추가, `RECENT_GAMES_COUNT=7`.
  3. `routes/players.js`에 `POST /:id/recent-stats`(위 Architecture 참고, 1시간 캐싱).
  4. 참가자 상세 모달에 "최근 7경기" 카드 + "불러오기"/"새로고침" 버튼(`public/app.js`의 `renderRecentStatsTable`/`RECENT_GAMES_COUNT` — 백엔드 상수와 값이 같아야 하니 바꿀 때 둘 다 고칠 것, 자동 동기화 안 됨).
  실측: 최초 호출 267ms, 캐시 히트 20ms, 강제 새로고침 220ms. Playwright로 모달 열기→불러오기→7전 3승 4패 테이블(챔피언별 KDA 포함) 렌더 확인 후 새 SHA로 배포.
- **2026-08-20**: 사용자가 3가지 문제 제보 — 조사 결과 2개는 버그가 아니라 데이터, 1개는 진짜 CSS 버그였음.
  1. "자유랭크 집계가 부정확", 2. "솔로랭크 승률이 안 보임" → 실제로는 버그 아님. 라이엇 API 원본 데이터와 직접 대조해서 우리 시스템이 정확히 일치하게 가져오고 있음을 확인(예: 싱슝샹슝#KR1 솔로 37승36패/자유 28승22패 — 원본과 정확히 일치). 원인은 **자유랭크/승패 컬럼이 생기기 전에 등록된 참가자들의 캐시 데이터가 갱신 안 된 것**뿐 — 그 컬럼들이 전부 NULL이라 0%로 보였음. 이미 등록된 기존 참가자 전원을 새로고침해서 해결(신규 등록/새로고침한 계정은 처음부터 문제없음).
  2. "최근 전적 불러오면 위쪽(숙련도/솔로/자유랭크)이 안 보임" → **진짜 CSS 버그**였음. `.player-detail-body`(모달의 스크롤 영역)에 `overflow-y:auto`는 있었지만, flex column 안에서 컨텐츠가 넘칠 때 **자식 요소들의 기본 `flex-shrink:1` 때문에 스크롤되는 대신 찌부러져서(compress) 잘려 보이는** 전형적인 flexbox 함정이었음 — `scrollHeight === clientHeight`로 측정돼서 "오버플로우 자체가 없다"고 나온 게 단서였음(스크롤 대상이 아니라 압축되고 있었던 것). 고친 방법: `.player-detail-body`/`.champion-grid`(스크롤 컨테이너)에 `flex:1 1 auto; min-height:0`을, 그 안의 직접 자식들(`.ranked-card`/`.mastery-card`/`.recent-stats-card`/`.player-detail-opgg`, `.modal-header`)에 `flex-shrink:0`을 명시적으로 줘야 함 — **모달 안에 스크롤 영역을 새로 만들 때마다 이 두 세트를 항상 같이 챙길 것**, 안 그러면 똑같은 버그가 재현됨. 참고로 챔피언 피커 모달(`.champion-grid`)도 같은 구조라 전체 챔피언 목록에서 스크롤이 안 됐을 가능성이 있었는데(검색으로 결과가 적을 때만 써봐서 못 알아챘던 것으로 추정), 같이 고치면서 확인해보니 실제로 2339px 중 580px만 보이던 상태였음 — 이것도 같이 수정됨.
- **2026-08-20**: 사용자가 "최근 전적이 챔피언별 집계로만 나오는데 op.gg처럼 판별로 전부 볼 수 없냐"고 요청 → `fetchRecentChampionStats()`가 이미 match-v5 상세 응답을 다 받아오고 있었으므로 **추가 API 호출 없이** 같은 데이터에서 `perGame`(경기별 상세: 큐타입/시간/KDA/CS/게임시간/우리팀·상대팀 챔피언 10명) 배열을 같이 뽑아내도록 확장(`lib/riot.js`, `QUEUE_LABEL` 맵으로 큐ID→한글 라벨 변환, 모르는 큐ID는 `기타(N)`으로 안전하게 폴백). 프론트는 `renderRecentMatchList()`로 op.gg 스타일 경기별 행(승패 색상 왼쪽 보더, 챔프 아이콘, KDA, CS, 분, 양팀 미니 챔프 아이콘)을 기본으로 보여주고, 기존 챔피언별 집계 테이블은 `<details>`로 접어서 "챔피언별 요약"으로 하단에 남김. 모달도 420px→480px로 살짝 넓혀서 양팀 10명 아이콘이 한 줄에 들어가게 함. Playwright로 7개 경기 행 전부 렌더 + 요약 details 펼치기까지 확인 후 배포.
- **2026-08-20**: "특정 경기 클릭하면 세부정보(10인 스코어보드)도 보여줄 수 있냐"는 요청에, 아이템/룬/오브젝트까지 다 보여주는 풀 op.gg 수준 대신 **"양팀 10명 전체(챔피언+실제 롤 아이디+KDA+CS)"** 선에서 시작하기로 사용자와 합의(아이템/룬은 이미지 에셋을 새로 붙여야 해서 다음 단계로 미룸). match-v5 응답에 이미 다 들어있는 데이터라 추가 API 호출 없이 구현:
  - `lib/riot.js`: `participantSummary()`로 `myTeam`/`enemyTeam`을 챔피언ID 배열 대신 `{championId, riotId, kills, deaths, assists, cs, win}` 객체 배열로 확장. `riotIdGameName`/`riotIdTagline`이 실제 Riot API 필드명(대소문자 주의, `riotIdTagLine`이 아니라 `riotIdTagline`).
  - `public/app.js`: `.match-row` 클릭 시 `state.expandedMatchId` 토글 → `renderMatchDetailPanel()`이 그 경기 아래에 우리팀/상대팀 2열 스코어보드를 삽입(재클릭하면 접힘, 다른 경기 클릭하면 그쪽으로 전환). 본인 행은 `riotId` 일치로 찾아서 파란 배경 강조(`score-me`) — 등록된 참가자 본인의 riotId와 그 경기 참가자의 riotId를 문자열 비교.
  Playwright로 10행 렌더/재클릭 시 접힘/본인 강조(정확히 1명, riotId 일치) 확인 후 배포.
- **2026-08-20**: 사용자 버그 리포트 2건 + 정리 요청 —
  1. 스코어보드에서 우리팀/상대팀 닉네임이 길면 반대쪽 KDA/CS가 화면 밖으로 밀려나가던 문제 — `.match-detail`(2컬럼 그리드)의 자식인 `.match-detail-team`에 `min-width:0`이 없어서 grid 기본값(`min-width:auto`, 즉 내용물의 min-content 크기)이 컬럼을 강제로 넓히던 것. `.player-detail-body`/`.champion-grid` 때 겪었던 flex-shrink 함정과 **완전히 같은 계열의 버그(그리드 버전)** — 그리드/플렉스 자식에 텍스트 오버플로우 처리를 맡기려면 그 자식 자체에도 `min-width:0`(세로면 `min-height:0`)을 반드시 같이 줘야 함, 안 그러면 `overflow:hidden`/`text-overflow:ellipsis`가 있어도 무용지물이라는 걸 또 확인함 — 이 프로젝트에서 세 번째로 겪은 동일 패턴이라 CLAUDE.md에 명확히 남겨둠.
  2. 날짜 입력 후 습관적으로 엔터를 치면 "새 시리즈 시작" 버튼을 안 눌러도 폼이 그냥 제출되던 문제(HTML 폼의 기본 동작 — 텍스트/날짜 인풋에서 엔터 = 제출) → `#seriesForm`에 `keydown` 리스너를 추가해서 타깃이 `<button>`이 아닌 엔터는 `preventDefault()`로 막음. 이 버그 때문에 쌓인 빈 시리즈 17개(세트 하나도 없는 것들)를 라이브에서 전부 `DELETE /api/series/:id`로 정리.
  Playwright로 (a) 엔터로는 안 생기고 버튼 클릭으로만 생기는지, (b) 극단적으로 긴 닉네임 양쪽에 강제로 주입해서 가로 스크롤/밀림 없이 "..."로 잘리는지(scrollWidth===clientWidth로 확인) 검증 후 배포.
- **2026-08-20**: 두 가지 추가 —
  1. "새 시리즈 시작" 인라인 폼을 카드 UI로 재디자인(`.new-series-card` — 제목+라벨 붙인 날짜/포맷 필드+강조된 파란 버튼). 가시성이 안 좋다는 피드백 반영.
  2. 참가자 상세 모달의 솔로랭크/자유랭크 카드를 클릭하면 그 큐로만 필터링된 챔피언별 성적(전적/승률/KDA)이 펼쳐지도록 추가. match-v5 `queue` 파라미터(420=솔로, 440=자유)로 필터링(`lib/riot.js`의 `getMatchIdsByPuuid`가 이제 queueId를 받음), 캐시도 "전체 최근 7경기"와 별도로 `solo_queue_stats_json`/`flex_queue_stats_json` 컬럼에 독립 저장 — 세 종류(전체/솔로/자유)가 서로 다른 캐시라 하나 새로고침해도 나머지엔 영향 없음. 프론트는 두 큐 패널을 서로 독립적으로 토글 가능(하나 열려있어도 다른 거 여닫는 데 지장 없음, `state.soloQueueOpen`/`flexQueueOpen` 별도 관리) — 단, 이 큐별 패널은 챔피언별 집계 테이블만 보여주고 "최근 7경기" 섹션에 있는 경기별 스코어보드 펼치기 기능은 없음(의도적으로 범위를 좁힘 — 안 그러면 같은 UI를 세 벌 관리해야 해서 `expandedMatchId` 상태가 섹션끼리 꼬일 수 있었음).
  Playwright로 솔로/자유 독립 토글(하나 닫아도 다른 하나 유지), 큐별로 실제 다른 챔피언/전적이 나오는지 확인 후 배포.
- **2026-08-20**: 사용자가 "솔로랭크/자유랭크는 최근 20판 기준, 최근 기록은 10판 기준으로 가자"고 기준 수치 확정. (배경: 처음엔 "솔로/자유 볼 때는 전체 전적을 가져오는 게 맞지 않냐"는 요청이 있었으나, 확인해보니 의도는 "매치 상세를 더 많이"가 아니라 "챔피언별 승패/승률 표본을 더 넉넉히"였음. 다만 Riot match-v5엔 챔피언별 집계 전용 엔드포인트가 없어 **표본을 늘리는 것 자체가 곧 매치당 1회씩 API 호출을 늘리는 것과 동일**하고, "이번 시즌"을 API로 정확히 구분할 공식 방법도 없어서(시즌 경계 엔드포인트 없음) 결국 고정 판수로 타협.)
  - `lib/riot.js`: `RECENT_GAMES_COUNT` 7→10(전체 큐, "최근 기록"용), 신규 `RANKED_QUEUE_GAMES_COUNT=20`(솔로/자유 큐별 챔피언 집계 전용) 추가·export. `routes/players.js`도 `?queue=` 유무에 따라 두 상수 중 하나를 선택하도록 수정.
  - `public/app.js`: 같은 상수 프론트에도 복제(백엔드와 자동 동기화 안 되니 값 바꿀 땐 항상 둘 다 고칠 것 — 주석으로도 남겨둠), 솔로/자유 카드 토글 버튼 라벨에 "최근 20판 챔피언별 성적"처럼 실제 판수를 노출.
  - 검증: 로컬에서 실계정(싱슝샹슝#KR1) 등록 후 `/recent-stats`(큐 없음) → totalGames 10, `?queue=solo`/`?queue=flex` → 각각 totalGames 20 확인. Playwright로 솔로 토글 라벨이 "최근 20판 챔피언별 성적"으로 뜨는지, "최근 기록" 섹션엔 10행이 뜨는지, 콘솔 에러 없는지까지 확인 후 배포.
- **2026-08-20**: 사용자가 라이브에서 429(레이트리밋) 에러가 원문 그대로("Riot API 오류 429: ...") 노출되는 걸 발견 → 이해하기 어려운 원문 대신 친절한 문구로 바꿔달라는 요청. `lib/riot.js`의 `riotFetch()`(모든 Riot API 호출이 거치는 단일 지점) 한 곳에서 429만 따로 잡아 `요청이 몰려서 라이엇 서버가 잠시 응답을 제한하고 있어요. n초 후 다시 시도해주세요.`로 치환 — Riot이 내려주는 `Retry-After` 헤더가 있으면 그 초를 그대로 문구에 넣고, 없으면 "잠시"로 폴백. 참가자 등록/새로고침/최근전적(전체·솔로·자유) 등 Riot API를 부르는 모든 경로가 이 함수 하나를 거치므로 추가 수정 없이 전부 적용됨. `global.fetch`를 모킹해 429+`Retry-After:17` 응답을 강제로 재현, 의도한 문구로 바뀌는 것 확인 후 배포. (참고: 이 키는 여전히 기본 티어라 429가 실제로 자주 뜰 수 있음 — 위 "match-v5 확장 시 API 호출량" 로그 참고.)
- **2026-08-20**: 사용자가 전적 기록 탭의 날짜 입력이 "다크 테마에서 가시성이 안 좋고, 방식 자체가 맞는지도 모르겠다"고 지적, "보통 그날 바로 기록하니 기본값을 오늘로 두는 게 맞지 않냐"는 아이디어 제시. 원인 확인 결과 `<input type="date">` 방식 자체는 문제없었고(표준적이고 모바일 친화적), 실제 문제는 **다크 테마 CSS를 안 걸어둬서 브라우저가 기본(라이트) 기준으로 달력 아이콘/팝업을 그려서** 어두운 카드 위에서 아이콘이 안 보이거나 팝업만 하얗게 튀는 것이었음. 두 가지로 해결:
  1. `:root`에 `color-scheme: dark` 한 줄 추가 — 별도 커스텀 달력 위젯 없이 브라우저 네이티브 date picker(팝업+아이콘)를 다크로 렌더링하는 표준 CSS 방법.
  2. `resetMatchDateToToday()`(`public/app.js`)를 `init()`(페이지 최초 로드)과 시리즈 생성 성공 직후 둘 다에서 호출해 날짜 입력 기본값을 항상 오늘로 채워둠. `toISOString()`은 UTC라 자정 근처에 하루 밀릴 수 있어 `getFullYear/getMonth/getDate`로 로컬 타임존 기준으로 직접 조합.
  Playwright로 페이지 로드 시 입력값이 오늘 날짜와 정확히 일치하는지, `getComputedStyle(document.documentElement).colorScheme === 'dark'`인지 확인 + 스크린샷으로 달력 아이콘이 실제로 잘 보이는지 육안 확인 후 배포.
  (배포 중 실수 기록: 로컬 검증용으로 띄운 `node server.js`를 정리하며 `pkill -f "node server.js"`를 썼는데, 이 서버(호스트)가 k3s 파드와 PID 네임스페이스를 공유해서 **운영 중인 파드의 프로세스까지 같이 죽임** — k8s Deployment가 즉시 재시작해서 실제 장애나 데이터 손실은 없었음(SQLite는 PVC에 있어 컨테이너 재시작과 무관하게 유지됨)이지만, 이 서버에서 로컬 dev 서버를 정리할 땐 `pkill -f "node server.js"`처럼 광범위한 패턴 대신 **직접 띄울 때 받은 PID로만 kill**할 것.)
- **2026-08-20**: 사용자 요청으로 라이브 DB에 테스트 데이터 생성 — 사용자가 직접 등록해둔 실제 로스터(A: INDEON/eomti/조몰랑이/오희승/날 보고 웃어줘, B: 우주3/동그란넛뗙/파란호박고구마/싱슝샹슝/쿨이에몽, 라인은 사용자가 실제로 기록한 세트와 동일하게 고정)를 그대로 써서, 2026-08-13~08-19 매일 Bo3 시리즈 1개씩(id 20~26) 생성. Riot API를 거치지 않고 앱 자체 API(`POST /api/series`, `POST /api/series/:id/sets`)만 스크립트로 반복 호출하는 방식이라 피어리스/라인 중복 등 검증 로직을 실제로 통과한 데이터임(DB에 SQL로 직접 꽂은 게 아님). 챔피언은 세트마다 전체 챔피언 풀(173종)에서 20개(밴5+5, 픽5+5)를 무작위로 뽑아 배정, 승자도 50/50 무작위. **이 7개 시리즈는 실제 경기 기록이 아닌 통계/레이아웃 테스트용 더미 데이터** — 나중에 실제 데이터와 섞여서 혼란을 주면 `DELETE /api/series/:id`(id 20~26)로 정리할 것.
- **2026-08-20**: 참가자 관리 화면 레이아웃 피드백 3건 반영 —
  1. 전체가 중앙 정렬돼 있던 문제(`main { margin: 24px auto }`가 헤더의 왼쪽 시작 위치와 안 맞았음) → `margin: 24px 0 24px 24px`로 왼쪽 고정, 헤더 제목과 정확히 같은 x좌표(24px)에서 시작하도록 맞춤. 참가자 관리 탭만이 아니라 `main`을 쓰는 모든 탭에 공통 적용됨(의도적 — 탭마다 정렬 기준이 다르면 더 어색해짐).
  2. 표시 이름 입력창이 브라우저 기본 폭이라 placeholder가 잘리던 문제 → `#displayNameInput { min-width: 220px }`로 확장.
  3. "유저가 늘어나면 카드 배열이 중구난방으로 보일 것 같다"는 우려에 대해, 원인은 `#playerList`의 그리드 트랙이 `minmax(220px, 1fr)`이라 카드 개수에 따라 1fr(가변)로 늘었다 줄었다 하던 것이었음 → `minmax(220px, 220px)`로 **폭 고정**. 그리드는 남는 공간을 늘리지 않고 기본값(`justify-content: start`)대로 왼쪽부터 고정폭 카드를 채우다 줄이 꽉 차면 다음 줄로 넘어가므로, 인원이 몇 명이 되든(지금 11명이든 나중에 50명이든) 항상 균일한 격자로 정렬됨 — 유저 수가 늘어나는 상황을 고려한 선택.
  로컬에서 더미 유저 15명을 DB에 직접 꽂아(Riot API 호출 없이 시각적 레이아웃 검증 목적) Playwright로 `main`과 헤더 제목의 왼쪽 좌표가 정확히 24px로 일치하는지, 카드가 고정폭으로 줄바꿈되는지 스크린샷으로 확인 후 테스트 유저 삭제하고 배포.
