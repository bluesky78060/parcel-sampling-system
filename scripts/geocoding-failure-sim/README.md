# 지오코딩 장애 시뮬레이터

VWorld API가 죽었을 때 앱이 어떻게 행동하는지 **실제 소스를 그대로 실행해** 확인한다.
로직을 재현하지 않는다 — `src/lib/jsonp.ts`, `src/lib/kakaoGeocoder.ts`,
`src/lib/batchGeocoder.ts`를 esbuild로 번들해 node에서 돌리고,
`document.createElement('script')`의 로드만 가로채 장애를 흉내낸다.

## 왜 있는가

2026-09-06 VWorld 502 장애에서 앱이 4만 건을 끝까지 시도했다(PROJ1-1-25).
"고쳤다"는 주장을 코드를 읽어 확인하는 것으로는 부족해서 만들었다.
조기 중단은 **오탐이 나면 정상 변환을 막는** 기능이라, 장애 감지만이 아니라
정상 경로가 그대로인지도 매번 함께 봐야 한다.

## 실행

```bash
# 현재 워킹트리
node scripts/geocoding-failure-sim/build.mjs "$PWD" /tmp/sim-current.mjs
node scripts/geocoding-failure-sim/scenarios.mjs /tmp/sim-current.mjs "현재"

# 비교 대상(예: HEAD)을 별도 트리로 꺼내 같은 하네스로 돌린다
mkdir -p /tmp/sim-head && git archive HEAD | tar -x -C /tmp/sim-head
ln -sfn "$PWD/node_modules" /tmp/sim-head/node_modules
node scripts/geocoding-failure-sim/build.mjs /tmp/sim-head /tmp/sim-head.mjs
node scripts/geocoding-failure-sim/scenarios.mjs /tmp/sim-head.mjs "HEAD"
```

`HARNESS_DIR` 환경변수로 스텁 위치를 옮길 수 있다(기본값은 이 디렉터리).

## 시나리오

리 5개 × 100필지 = 500필지 기준. **각 시나리오에 기대값(serviceDown / failureKind / 좌표확보 /
요청 상한)이 붙어 있고, 어긋나면 종료 코드 1로 끝난다.**

| # | 시나리오 | 기대 |
|---|---|---|
| 0 | 전면 장애 (헬스체크 포함) | 헬스체크에서 즉시 차단 |
| 1 | 헬스체크 통과 후 전면 장애 | Phase 0·1 가드가 수십 건 안에 중단 |
| 2 | 정상 서버 | 500건 확보, 중단 없음 |
| 3 | 리 1개만 실패 | 500건 확보(주소 폴백), 중단 없음 |
| 4 | 재개 — 신규 스냅 0건 + 리 2개 오류 | **오탐 없음**. 빈 응답도 생존 신호 |
| 5 | 잘못된 주소 다수 + 일부 네트워크 오류 | **오탐 없음**. "결과 없음"은 생존 신호 |
| 6 | 첫 청크에 실패 리 2 + 성공 리 1 | **오탐 없음**. 판정은 청크 경계에서 |
| 7 | 도중 장애 (앞부분 성공 후 사망) | 중단됨. 누적 성공은 생존의 증거가 아니다 |
| 8 | 캐시 500건 보유 + 전면 장애 | 네트워크 0회로 500건 회수 |
| 9 | 헬스체크만 인증 오류, 서버는 정상 | **차단하지 않음**. VWorld는 과부하에도 인증 문구를 준다 |
| 10 | 주소 캐시 100건 + 주소 API 사망 | 캐시는 회수하되 **중단**. 캐시 적중은 생존 신호가 아니다 |
| 11 | 지오코딩 API만 `INVALID_KEY` | 중단, `failureKind='auth'`. API별로 키가 따로 등록된다 |
| 12 | 지오코딩 호출 한도 소진 | 중단, `failureKind='quota'`. 한도는 오늘 회복되지 않는다 |
| 13 | 인증 거부 (`error.code` 없음, text만) | 중단, `auth`. 판정 기준이 code뿐이면 놓친다 |
| 14 | 인증오류 1회 후 정상 결과없음 | **오탐 없음**. 성공한 재시도가 앞선 판정을 전부 거둔다 |
| 15 | 항목 단위 혼합 (미응답 → 한도) | 실패 내역 합계 = 시도 실패. 이중 계상 금지 |
| 16 | 한도 1건 + 미응답 다수 | 사유는 지배적 원인(`unreachable`) |
| 17 | 캐시 25건 블록 교대 + 주소 API 사망 | 캐시 250건은 **네트워크 전에** 회수하고, 죽은 배치 2개 뒤 중단 |
| 18 | Phase 1 도중 취소 | 취소 뒤 발행 요청 0, 취소 뒤 진행 보고 0 |

4~18번은 각각 리뷰에서 지적된 결함을 고정한 것이다. 조건을 되돌리면 해당 시나리오가 실패한다.

## 훅 → 화면 검증 (`ui-states.mjs`)

`scenarios.mjs`는 `batchGeocode`의 반환값까지만 본다. 5·6라운드의 결함은 둘 다 그 바깥,
라이브러리와 UI 사이의 이음매에 있었다. 그래서 실제 `useGeocoding`(react 훅 4개만
`react-hook-shim.js`로 대체)과 실제 `GeocodingProgress`(진짜 react-dom/server)를 끝까지 돌려
각 상태(실행 중 / 취소 / 예외 / 완료 / 장애 중단)의 **화면 문구**를 검사한다.

```bash
node scripts/geocoding-failure-sim/ui-states.mjs "$PWD"
```

기대 문구가 없거나 금지 문구가 있거나 빈 `<ul>`이 그려지면 종료 코드 1이다.

## 한계

- `ui-states.mjs`의 훅 shim은 setState 갱신 함수를 즉시 적용한다. React의 배치·재렌더
  타이밍은 재현하지 않으므로, 렌더 횟수나 중간 프레임에 의존하는 결함은 잡지 못한다.

- `document`/`window` 스텁이라 **실제 VWorld의 응답 지연은 측정하지 못한다.**
  헬스체크 타임아웃 예산(8초)의 타당성은 이 하네스로 검증되지 않는다.
- IndexedDB는 `idb-stub.js`로 대체된다. 실제 TTL·용량 동작은 확인하지 않는다.
