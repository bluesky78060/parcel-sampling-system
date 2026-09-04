# PROJ1-1-1 실행 플랜 — P0 결함 3건 수정

작성일 2026-09-04 · 선행 문서 `docs/00-discovery/PROJ1-1-1-direction.md`

## 실행 구조

서브에이전트 3개를 **파일 배타 분할**로 동시 투입한다. 교집합이 없으므로 병합 충돌이 없다.

| 레인 | 담당 결함 | 배타 소유 파일 |
|---|---|---|
| A | P0-1 Hooks 규칙 위반 | `src/pages/ReviewPage.tsx`, `src/pages/ExportPage.tsx` |
| B | P0-2 대표필지 중복 | `src/store/extractionStore.ts` |
| C | P0-3 프로덕션 지오코딩 | `.github/workflows/deploy.yml`, `src/lib/kakaoGeocoder.ts` |

빌드 검증은 3개 레인이 모두 끝난 뒤 오케스트레이터가 1회 수행한다(동시 빌드 금지).

---

## 레인 A — React Hooks 규칙 위반

### 현상
`src/pages/ExportPage.tsx:21`, `src/pages/ReviewPage.tsx:81`에서 `if (!result) return null;`
뒤에 `useMemo`가 온다. ExportPage는 1개(`duplicateKeys`), ReviewPage는 5개
(`allParcelsWithRep`, `tableParcels`, `mapSelectedParcels`, `riList`, `mapLegendCounts`).

### 재현
ExportPage "처음부터 다시" → `resetExtraction()`이 `result`를 null로 설정 →
ExportPage가 아직 마운트된 채 재렌더 → early return이 먼저 걸려 훅 호출 수가 줄어듦 →
React가 `Rendered fewer hooks than expected` 로 throw → ErrorBoundary 화면.

### 조치
1. 두 파일에서 `if (!result) return null;`을 **모든 훅 호출 뒤**로 이동.
2. 이동에 따라 early return 이후에서 구조분해하던 값(`result.selectedParcels` 등)을
   훅 안/위에서 안전하게 접근하도록 옵셔널 처리. 예: `const selectedParcels = result?.selectedParcels ?? EMPTY`.
   빈 배열 리터럴을 매 렌더 새로 만들면 useMemo 의존성이 매번 바뀌므로 모듈 스코프
   상수(`const EMPTY_PARCELS: Parcel[] = []`)를 쓴다.
3. 렌더 트리 자체는 바꾸지 않는다. 반환되는 JSX와 조건은 그대로 유지.

### 검증
- 두 파일에서 훅 호출이 전부 early return 위에 있음
- `result`가 null인 렌더와 non-null인 렌더의 훅 호출 순서·개수가 동일
- 기존 리다이렉트 `useEffect`는 그대로 동작

---

## 레인 B — 대표필지 결과 중복

### 현상
`src/store/extractionStore.ts:263-333`
```
const repNotInPublic = enrichedEligibleRep.filter(...)   // 계산 후 로그에만 사용
const repDirect      = enrichedEligibleRep.map(...)      // 전량 재추가
finalParcels = [...taggedPublic, ...repDirect, ...repSupplements]
```
공익직불제 추출에서 이미 선택된 대표필지가 `repDirect`로 다시 들어가, 최종 배열에
같은 필지가 2회 존재한다. `excelExporter`는 `parcelCategory`로만 시트를 나누므로
'2026_필지선정'과 '대표필지' 양쪽에 동일 필지가 출력되고 총 건수가 부풀려진다.

### 조치
1. `repDirect`의 소스를 `enrichedEligibleRep` → `repNotInPublic`으로 교체.
2. `repNotInPublic` 선언을 `repDirect`보다 위로 유지하고, 로그 문구를
   "적격 N건 = 공익직불제 중복 X건(공익직불제 시트 유지) + 대표필지 시트 신규 Y건"으로 정정.
   현재 "적격 N건 전부 포함"은 중복 재추가를 전제한 문구라 사실과 어긋나게 된다.
3. `allUsedKeys`(대체 후보 제외용)는 `taggedPublic` + `repDirect` 기준인데, repDirect가
   줄어들면 공익직불제에 있는 대표필지 키가 빠질 수 있다. `taggedPublic`이 이미 그 키를
   포함하므로 실제 누락은 없으나, 이 점을 코드 주석 대신 **키 집합 산출식으로 명시**한다.
4. `repInPublicCount`를 세기만 하는 no-op `map`은 `filter().length` 또는 카운트 루프로 정리
   (동작 변경 없음, 오해 소지 제거).

### 비목표
- 대표필지 대체 복사(`repSupplements`) 로직은 이번에 건드리지 않는다.
- `toggleParcelSelection` 결함은 P1이므로 제외.

### 검증
- 최종 `selectedParcels`에서 `matchKey` 중복이 0
- 적격 대표필지의 **커버리지는 불변**: 공익직불제 시트 + 대표필지 시트 합집합이 수정 전과 동일
- `repSupplements` 건수 산출식 불변

---

## 레인 C — 프로덕션 지오코딩 불능

### 현상 1 — 배포 빌드에 VWorld 키 미주입
`.github/workflows/deploy.yml`의 `npm run build` env에 `VITE_KAKAO_JS_KEY`,
`VITE_KAKAO_REST_KEY`만 있고 `VITE_VWORLD_KEY`가 없다. `isGeocodingAvailable()`,
`geocodeAddress()`, `prefetchRegionalPolygons()`, `useMapInit`의 VWORLD 타일이 전부 무력화된다.

### 현상 2 — Kakao 경로가 프로덕션에서 404
`src/lib/kakaoGeocoder.ts:38-46`
```
const KAKAO_ADDRESS_URL = isDev ? '/api/kakao/...' : '/api/kakao/...';   // 양쪽 동일
```
`/api/kakao`는 `vite.config.ts`의 dev 서버 프록시 전용이다. GitHub Pages에서는
자기 도메인 상대경로가 되어 404(HTML)를 받고, `res.ok === false`로 조용히 실패한다.

### 조치
1. `deploy.yml` build step env에 `VITE_VWORLD_KEY: ${{ secrets.VITE_VWORLD_KEY }}` 추가.
2. `kakaoGeocoder.ts`의 의미 없는 삼항을 제거하고, Kakao REST가 **dev에서만 사용 가능**함을
   한 곳에서 판정하는 상수(예: `const KAKAO_REST_USABLE = isDev && !!import.meta.env.VITE_KAKAO_REST_KEY`)로 정리.
3. `isGeocodingAvailable()` / `getGeocodingProvider()`가 프로덕션에서 Kakao 단독 키만 있을 때
   `true` / `'kakao'`를 반환하지 않도록 수정. 지금은 "가용"이라고 답한 뒤 전량 실패해
   사용자에게 원인 불명의 0건 결과를 보여준다.
4. `geocodeAddress()`의 Kakao 폴백도 같은 상수로 가드.
5. 프로덕션에서 Kakao REST를 쓰려면 서버 프록시가 필요하다는 점을 `.env.example`에 한 줄 명시
   (이미 유사 문구가 있으므로 중복 없이 보강).

### 비목표
- 서버리스 프록시 실제 구축은 P2. 이번에는 하지 않는다.
- `useMapInit`의 타일 URL 키 노출(P2)은 건드리지 않는다.

### 검증
- deploy.yml diff에 VWORLD 키 1줄
- 프로덕션 조건에서 Kakao 단독 키만 있을 때 `isGeocodingAvailable() === false`
- dev 조건에서는 기존 동작 불변(VWorld 우선 → Kakao 폴백)

---

## 통합 검증 (오케스트레이터 수행)
1. `npm run build` — tsc -b + vite build 통과
2. `npm run lint` — 신규 경고 없음
3. `git diff` 전량 정독 후 `code-reviewer`(Opus) 리뷰
4. `codex exec` 로 다른 계열 모델 독립 diff 리뷰 (CLAUDE.md 3중 검증 규칙)
5. 적대적 검증: 수정 지점을 되돌렸을 때 결함이 되살아나는지 논리 확인

## 롤백
세 레인 모두 단일 커밋 이전으로 되돌리면 원상복구된다. 스키마/영속 데이터 변경 없음.
