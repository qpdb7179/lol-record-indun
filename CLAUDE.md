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
- `lib/riot.js` — Riot 공식 API 클라이언트. Account-v1(`asia` 라우팅)으로 riotId→PUUID, League-v4/Champion-Mastery-v4(`kr` 라우팅, 둘 다 **by-puuid**)로 티어·숙련도 상위 3개 조회. `RIOT_API_KEY` 환경변수 필요(없으면 참가자 등록/새로고침 API가 에러 반환).
  - **2026-08-20 버그 수정**: 원래 `summoner-v4`로 암호화된 summonerId를 받아 `league-v4`(`by-summoner`)를 호출했는데, Riot API가 `summoner-v4` 응답에서 `id` 필드를 더 이상 내려주지 않게 바뀌어서 `by-summoner/undefined` 호출이 되며 403이 발생했음. `league-v4`가 이제 `by-puuid`도 지원해서 summoner-v4 호출 자체를 없애고 puuid로 직접 조회하도록 변경(`players.summoner_id` 컬럼도 함께 제거).
- `lib/dataDragon.js` — Riot Data Dragon(`ddragon.leagueoflegends.com`)에서 최신 패치의 챔피언 목록(한글명+이미지 URL)을 가져와 6시간 캐싱. API 키 불필요.
- `lib/fearless.js` — `getUsedChampionIds(seriesId, beforeSetNumber)`: 같은 시리즈의 이전 세트들에서 밴/픽으로 쓰인 챔피언 id 집합을 반환. 피어리스 드래프트(이번 시즌 LCK 방식 — 한 시리즈 내에서 이미 쓴 챔피언은 이후 세트에서 밴/픽 불가) 검증에 사용.
- `routes/players.js` — 참가자 등록(Riot API 조회 후 upsert)/목록/새로고침/삭제. op.gg 링크는 `https://op.gg/lol/summoners/kr/{gameName}-{tagLine}` 형태로 생성만 하고 스크래핑은 하지 않음(ToS 이슈 회피).
- `routes/series.js` — 시리즈(Bo3/Bo5) 생성 및 세트 기록의 핵심 로직:
  - **로스터 A/B 개념**: 시리즈 내 두 팀은 색(블루/레드)이 세트마다 바뀌므로, 1세트에서 블루였던 5명을 로스터 A, 레드였던 5명을 로스터 B로 `series_rosters`에 고정 저장. 이후 세트는 제출된 10명이 정확히 로스터 A/B와 일치해야 하며, 직전 세트와 같은 진영(블루 로스터)이면 400 에러(매 세트 진영 스왑 강제).
  - **피어리스 검증**: `lib/fearless.js`로 이전 세트 사용 챔피언 집합을 구해 새 세트의 밴+픽 전체와 교집합 있으면 400.
  - **시리즈 자동 종료**: 세트 저장 후 로스터별 승수를 집계해 Bo3=2승/Bo5=3승 도달 시 `series.status='completed'`.
- `routes/stats.js` — 챔피언별 픽률/승률/밴률, 플레이어별 승률·선호 라인. 승패 판정은 `set.team(blue/red)`가 `sets.blue_roster/red_roster` 중 `winner_roster`와 일치하는지로 계산(로스터 A/B ↔ 그날의 블루/레드 매핑이 세트마다 바뀌므로 매번 join해서 판정).
- `public/app.js` — 프론트 전체 로직. 3탭(참가자 관리/전적 기록/통계) 전환. 전적 기록 탭은 2세트부터 직전 세트의 로스터 정보(`series.rosters`)를 이용해 블루/레드 선수 select를 자동으로 채우고 잠금(진영만 스왑, 선수는 고정) — 서버의 로스터 검증 로직과 반드시 짝이 맞아야 함.

### 데이터 모델 요약
`players`(riot 계정+티어+숙련도 캐시) → `series`(날짜+포맷+상태) → `series_rosters`(시리즈별 로스터 A/B 고정) → `sets`(세트별 블루/레드 로스터+승자) → `set_participants`(세트별 선수-라인-챔프) / `set_bans`(세트별 밴 목록).

## 배포 환경 (코드만 봐서는 알 수 없는 실제 운영 정보)

- **서버**: 이 저장소는 indun.cloud와 같은 AWS EC2(Amazon Linux 2023)에서 개발됨. 실제 운영은 이 서버의 **k3s 클러스터**(별도 인프라 랩 프로젝트로 구축) 위에서 돎 — 기존 indun처럼 systemd가 아님.
- **컨테이너**: `Dockerfile`(node:18-alpine, better-sqlite3 소스 빌드를 위해 python3/make/g++ 설치). 이미지는 **GitHub Actions**(`.github/workflows/build.yml`)가 main 브랜치 push마다 빌드해서 `ghcr.io/qpdb7179/lol-record-indun`(`:latest`, `:<sha>`)로 푸시. 이 서버엔 docker가 없어서(containerd만 있음) 로컬 빌드 대신 이 방식을 씀.
- **k8s 매니페스트**: 앱 코드는 이 repo, k8s 리소스(Deployment/Service/PVC/ArgoCD Application)는 별도 GitOps repo `k3s-lab`(`/root/k3s-lab`, `github.com/qpdb7179/k3s-lab`)의 `manifests/lol-record-indun/`에 있음. ArgoCD가 그 repo를 보고 자동 동기화.
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
