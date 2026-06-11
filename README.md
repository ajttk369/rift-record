# Rift Record

Riot Games API 기반 League of Legends 전적 검색 및 최근 15경기 분석 포트폴리오입니다.

- 배포: https://rift-record.vercel.app/
- Riot ID 검색 공유: `/?riotId=Hide%20on%20bush&tag=KR1`
- Demo Mode: `/?demo=true`

## 주요 기능

- Riot ID 기반 PUUID, 솔로 랭크, 최근 MATCH-V5 기록, 챔피언 숙련도 조회
- KDA, 킬 관여율, CS/분, 피해량, 시야 점수 기반 플레이스타일 분석
- Summary Dashboard, Match Highlights, Position/Champion Performance
- 최근 성과 기반 Recommended Picks
- 최근 경기 상세 펼치기와 분석 코멘트
- 분석 기준 accordion
- 최근 검색과 즐겨찾기 Riot ID를 LocalStorage에 최대 5개 저장
- 검색 결과 공유 URL과 새로고침 시 자동 검색
- 프로필, 요약, 플레이스타일, 최근 경기 Loading Skeleton
- Supabase participant 데이터 기반 라인별 자체 Champion Tier
- API/DB 없이 전체 UI를 확인하는 Demo Mode

Champion Tier는 Riot Games 공식 티어가 아닙니다. Rift Record가 수집한 제한된 솔로 랭크
match participant 데이터로 계산한 참고 지표이며, 10경기 미만 표본은 `Low Sample`로 표시합니다.

## 기술 구성

- Frontend: Vanilla JavaScript, HTML, CSS
- Backend: Node.js, Vercel Serverless Functions
- Database: Supabase PostgreSQL
- APIs: ACCOUNT-V1, MATCH-V5, LEAGUE-V4, CHAMPION-MASTERY-V4, Data Dragon

`RIOT_API_KEY`, `TFT_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`는 서버 환경변수에서만 읽습니다. 브라우저 코드나
API 응답에 키를 포함하지 않으며 `.env`, `.env.local`, `data/*.json`은 Git에서 제외합니다.

## Supabase 저장 구조

- `matches`: matchId와 Riot 원본 match JSON
- `participants`: 챔피언 티어 계산에 필요한 참가자 지표
- `champion_stats_cache`: 패치 및 포지션별 계산 결과

Vercel Serverless의 로컬 파일 시스템은 영속 저장소가 아닙니다. 따라서 배포 환경에서는 JSON
파일 대신 Supabase를 사용해 검색으로 수집한 match와 participant를 유지합니다. 동일한
`match_id`는 DB에서 먼저 조회해 Riot API 중복 호출을 줄입니다.

RLS는 활성화하지만 공개 정책은 만들지 않습니다. Service Role Key는 RLS를 우회하므로 백엔드
함수에서만 사용해야 하며 클라이언트에 절대 노출하면 안 됩니다.

## Supabase 설정

1. Supabase 프로젝트를 생성합니다.
2. SQL Editor에서 [`supabase/schema.sql`](supabase/schema.sql)을 실행합니다.
3. Project Settings에서 Project URL과 Service Role Key를 확인합니다.
4. 로컬 `.env`와 Vercel Environment Variables에 아래 값을 추가합니다.
5. Vercel을 Redeploy합니다.
6. `/api/health`에서 `hasRiotApiKey`, `hasTftApiKey`, `hasSupabaseConfig`를 확인합니다.

```env
RIOT_API_KEY=
TFT_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
NODE_ENV=development
```

`NEXT_PUBLIC_SUPABASE_ANON_KEY`는 사용하지 않습니다. 이 프로젝트는 브라우저에서 Supabase를
직접 호출하지 않습니다.

## 로컬 실행

Node.js 18 이상이 필요합니다.

```bash
npm install
npm run dev
```

기본 주소는 `http://127.0.0.1:4173`입니다. Supabase 설정이 없으면 로컬 개발에서는 기존
`data/matches.json` fallback을 사용합니다. Demo Mode는 Riot/Supabase 설정 없이 작동합니다.

## Vercel 배포

1. GitHub 저장소를 Vercel에 Import합니다.
2. `RIOT_API_KEY`, `TFT_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`를 Production 환경변수로 등록합니다.
3. 설정 변경 후 반드시 Redeploy합니다.
4. `/api/health` 응답을 확인합니다.
5. Riot ID 검색 후 Supabase의 `matches`, `participants` 행이 증가하는지 확인합니다.
6. `/api/champion-stats?position=MID`가 DB 기반 통계를 반환하는지 확인합니다.

Development API Key는 약 24시간 후 만료됩니다. 포트폴리오를 지속 공개하려면 Riot Developer
Portal에서 Personal API Key를 신청해야 합니다. 신청 초안은
[`docs/riot-api-key-application.md`](docs/riot-api-key-application.md)에 있습니다.

## Champion Tier 계산

```text
tierScore =
normalizedWinRate * 0.55
+ normalizedPickRate * 0.25
+ normalizedKDA * 0.10
+ sampleConfidence * 0.10
```

라인 안에서 점수 순으로 S/A/B/C/D를 부여합니다. S는 상위 10%, A는 10~30%, B는 30~60%,
C는 60~85%, D는 하위 15%입니다.

## 채용 검토 방법

1. 배포 URL에서 `데모 데이터 보기`를 눌러 전체 분석 UI를 확인합니다.
2. 유효한 Riot ID로 실제 최근 15경기 검색과 공유 URL을 확인합니다.
3. `/champions`에서 수집 데이터 기반 라인별 자체 티어를 확인합니다.
4. `What I Built`에서 API, 분석, 보안, DB 설계를 확인합니다.

## Riot Games 고지

This product is not endorsed by Riot Games and does not reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties.
