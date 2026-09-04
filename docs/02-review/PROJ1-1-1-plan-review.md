# PROJ1-1-1 플랜 독립 리뷰 (critic, Opus, read-only 레인)

- 대상: `docs/00-discovery/PROJ1-1-1-direction.md`, `docs/01-plan/PROJ1-1-1-plan.md`
- 리뷰일: 2026-09-04 · 모드: ADVERSARIAL (MAJOR 3건 초과로 승격)
- 검증: 지목 파일 전량 정독 + `npm run build` 실행 + `npm run lint` 실행 +
  `node_modules/react-router` 구현 확인. 범위 밖 파일(`excelExporter.ts`,
  `useGeocoding.ts`, `AnalyzePage.tsx`, `batchGeocoder.ts`, `ValidationPanel.tsx`,
  `App.tsx`)까지 확장 조사.

## 판정: 조건부 승인 (반려 사유 없음)

세 레인의 결함 진단은 전부 사실로 확인. 문제는 진단이 아니라 **검증 게이트**에 있음.

## 리뷰어가 반증하려다 실패한 것 — 레인 A 재현은 진짜다

`App.tsx:16`이 `HashRouter`(data router 아님)이고 React 19 automatic batching이 있으므로
`handleReset`의 `resetExtraction()` + `navigate()`가 한 배치로 묶여 ExportPage가
`result=null`로 재렌더되지 않을 것이라 예상했으나 **틀렸다**.

`node_modules/react-router/dist/development/chunk-LFPYN7LY.mjs:9956-9965`:
```js
let setState = React10.useCallback((newState) => {
  if (unstable_useTransitions === false) { setStateImpl(newState); }
  else { React10.startTransition(() => setStateImpl(newState)); }   // 기본 경로
}, [unstable_useTransitions]);
```
`App.tsx`가 `unstable_useTransitions`를 넘기지 않으므로 `undefined !== false` →
라우터 location 갱신은 **transition 레인(저우선)**, zustand `reset()`은
`useSyncExternalStore` 경유 **sync 레인(고우선)**. sync가 먼저 커밋되므로
ExportPage는 `/export`에 마운트된 채 `result === null`로 재렌더 → early return →
`useMemo` 미호출 → `Rendered fewer hooks than expected`.

→ 레인 A 정당. 단 react-router 7.13.1 기본 동작 의존이므로 라우터 업그레이드 시 재현 조건 변동.

## 체크리스트

| # | 항목 | 판정 |
|---|---|---|
| 1 | 목표 명확성 | 통과 |
| 2 | 범위 적절성 | 통과 — 누락된 P0 없음 |
| 3 | 리스크 식별 | 조건부 — 부작용 3건 미식별 |
| 4 | 산출물 구체성 | 조건부 — 레인 A 지시 부족 (M-4) |
| 5 | 방향성 일치도 | 통과 — 단 Discovery §6이 제품 결정을 자문자답 |
| 6 | 기술 검증 | 조건부 — 플랜 사실 주장 중 **거짓 2건** |
| 7 | 테스트 전략 | **반려** — 제시 게이트가 전부 무신호 |

### 플랜 사실 주장 대조 (거짓 항목만)

| 플랜 주장 | 실측 | |
|---|---|---|
| "`taggedPublic`이 그 키를 이미 포함하므로 누락 없음" | 거짓 (M-2) | ❌ |
| "`.env.example`에 이미 유사 문구 존재" | 거짓 — 프록시 문구 전무 | ❌ |
| `kakaoGeocoder.ts:38-46` | 실제 41-46 | 드리프트 |
| `extractionStore.ts:263-333` | 실제 263-335 | 드리프트 |

나머지 9개 주장(early return 위치, 훅 개수/행번호, repNotInPublic 미사용,
repDirect 전량 재추가, finalParcels 구성, excelExporter의 parcelCategory 분리,
deploy.yml VWORLD 누락, Kakao 삼항 동일)은 **전부 사실로 확인**.

---

## CRITICAL

### C-1. 제시된 검증 게이트 3개가 모두 무신호 — 고장난 수정본도 통과한다

실측:
```
$ npm run build   → ✓ built in 1.10s          (수정 전 이미 통과)
$ npm run lint    → ✖ 22 problems (18 errors) (수정 전 이미 실패)
```
- `npm run build` 통과는 오늘 이미 참. 세 결함의 수정 여부에 대해 정보 0.
- "신규 경고 없음"은 error 18건이 이미 있으므로 **레인 A의 rules-of-hooks 6건이
  하나도 안 고쳐져도 만족**된다. `eslint-plugin-react-hooks@^7.0.1`이 이미 설치되어
  레인 A를 기계 판정할 수 있는 유일한 게이트를 무신호 기준으로 낭비.
- Discovery §7의 "테스트 프레임워크가 없다"는 전제가 lint 게이트의 존재를 가림.

교체할 게이트:
```
1. npm run lint | grep -c "rules-of-hooks"  →  6 → 0        [레인 A 하드 게이트]
2. npm run lint 총 error 수                 → 18 → 12        [신규 회귀 없음]
3. npm run build 통과                        → 타입 회귀 방어
4. 레인 B: runExtraction 로그의 M(대표필지 건수)이
   repNotInPublic.length + repSupplements.length 와 일치
5. 레인 C: 시크릿 존재 확인 절차 (M-1)
```

## MAJOR

### M-1. 레인 C 조치 1은 시크릿 부재 시 no-op이며 플랜 검증은 그것을 감지 못한다
GitHub Actions는 없는 시크릿을 **오류 없이 빈 문자열로 치환**한다. 시크릿 미등록이면
`kakaoGeocoder.ts:75,82,177,268,367,596`, `useMapInit.ts:23`, `usePolygonLayer.ts:53`이
수정 전과 동일하게 무력화되는데, 플랜 검증은 "diff 1줄"만 보므로 **통과 판정**한다.
→ `gh secret list`로 확인하거나, 레인 C를 "코드 준비 완료 / 배포 검증 미완"으로
분리하고 done 조건에서 뺄 것.

### M-2. 레인 B 조치 3의 "누락 없음" 증명이 성립하지 않는다
`extractionStore.ts:263-265`의 제외 조건은 **OR**:
```ts
!selectedKeySet.has(matchKey(p)) && !selectedFarmerKeySet.has(`${p.farmerId}_${p.parcelId}`)
```
`matchKey(p) ∉ selectedKeySet` 이지만 `farmerId_parcelId ∈ selectedFarmerKeySet` 인 경우,
`matchKey(p)`는 `taggedPublic` 어디에도 없다. 이때 `allUsedKeys`가 실제로 줄어
`masterCandidates`(`:292`) 통과 후보가 늘고, 수정 전에는 될 수 없던 필지가
`repSupplements`로 선택된다. (건수 상한은 불변이나 **선택되는 필지가 바뀐다**.)
이 데이터 불일치가 실재함은 `:170-213`의 3단 폴백 enrichment가 증명한다.

→ 조치 3을 아래로 교체. `repDirect` 교체는 `finalParcels`에만 적용:
```ts
const allUsedKeys = new Set([
  ...taggedPublic.map(matchKey),
  ...enrichedEligibleRep.map(matchKey),   // repDirect 아님 — 원본 기준 고정
]);
```

### M-3. '대표필지' 시트가 실제로 축소된다 — 기술 결정이 아니라 제품 결정
`excelExporter.ts:31-43`이 `parcelCategory`로만 시트를 나누고 `taggedPublic`은
`extractionStore.ts:256-260`에서 카테고리를 바꾸지 않는다(`return p; // 공익직불제 유지`).
따라서 '대표필지' 시트 행수가 정확히 `repInPublicCount`만큼 줄고 `ExportPage.tsx:47-49`의
`repCount` 표시도 함께 줄어든다. 플랜의 "합집합 동일"은 참이지만 담당자가 실제로 여는
시트가 얇아지는 것을 가린다.

완화 요인(리뷰어가 코드로 확인): `excelExporter.ts:41`이 '대표필지' 시트에도 `dupKeys`를
넘기고 `:139`가 `중복여부` 컬럼을 채운다. `duplicateKeys`(`ExportPage.tsx:52-64`)는
`extractionStore.ts:124`의 `matchKey`와 **동일한 키 공식**이므로 공익직불제로 흡수된
대표필지 행은 `중복여부='O'`로 정확히 식별된다. → 질문에 대한 답: **예, 중복여부 컬럼이
그 역할을 한다.** 이 때문에 CRITICAL이 아니라 MAJOR.

남는 문제: (1) 플랜이 이 완화 요인을 모른 채 작성됨, (2) 수정 후 `중복여부` 컬럼명이
거짓이 됨("중복 출력됨" → "이 행은 대표필지이기도 함"), (3) Discovery §6이 이 유일한
제품 결정을 스스로 제기하고 스스로 기각했으며 사용자 확인 기록이 없음.

### M-4. 레인 A 지시가 코드에 부족하고 더 안전한 대안을 검토하지 않음
- **4-a** early return을 내리면 `ExportPage.tsx:23-49`(`riStats`/`validation` 구조분해,
  `topRiStats`, `warningCount`, `hasErrors`)와 `ReviewPage.tsx:83`이 전부 TypeError.
- **4-b** `ValidationPanel.tsx:4`는 `validation: ValidationResult`로 **non-nullable**.
  `result?.validation`은 `ReviewPage.tsx:201`에서 `tsc -b` 오류. `?? EMPTY` 패턴은
  배열에만 통하고 `validation`에는 안 통한다. 실행자가 여기서 즉흥 판단하게 된다.
- **4-c** **더 나은 대안 미검토**: `ExportPage.tsx:52-64`의 `duplicateKeys`는 의존성이
  `[allParcels, representativeParcels]`뿐이고 **`result`를 전혀 참조하지 않는다.**
  early return **위로 올리기만 하면 끝** — null 가드 0줄, 렌더 트리 변경 0.
  ReviewPage도 5개 중 2개(`:86` `allParcelsWithRep`, `:112` `riList`)가 `result` 미참조.

→ 레인 A를 파일별로 분리 기술:
```
ExportPage.tsx : :52-64 useMemo 블록을 :21 위로 hoist. 끝. :23-49 불변.
ReviewPage.tsx : 모듈 스코프 const EMPTY_PARCELS: Parcel[] = []
                 :81 early return을 :146 아래로 이동
                 :83 → const selectedParcels = result?.selectedParcels ?? EMPTY_PARCELS;
                 validation은 EMPTY 기본값 금지. early return 뒤에
                   const { validation } = result;   ← 여기서 non-null로 좁혀짐
                 :86, :112는 result 미참조이므로 그대로 둔다.
```

## MINOR
1. 레인 C 조치 3의 `getGeocodingProvider()`는 **호출처 0건**(전 소스 grep). 무해하나
   여기 쓸 시간을 M-1에 써야 한다.
2. `.env.example`에 프록시 문구 전무. 유사 문구는 `kakaoGeocoder.ts:36,40`. 실행자가
   "이미 있으니 스킵"으로 오판 가능.
3. `.env.example`이 배타 파일 표에 없다(조치 5가 세 번째 파일을 건드림).
4. 행번호 드리프트 2건.
5. 레인 A 검증이 육안 확인 — eslint가 기계 판정 가능.

## 결여 사항
1. 레인 B 후 '대표필지' 시트 **예상 행수의 사전 수치 기록**이 없다.
2. **'전체필지' 시트(`excelExporter.ts:59-60`)는 레인 B와 무관하게 계속 중복 집계**된다
   (`[...allParcels, ...representativeParcels]` 무조건 연결). Discovery §1의 "엑셀 중복 행"
   목표가 시트 1·2에서만 달성되고 시트 6에는 남는다. 의도면 "시트 6은 범위 밖" 한 줄 명시.
3. **레인 C 이후 프로덕션 사용자가 보는 것이 정의되지 않음.** 실측:
   `AnalyzePage.tsx:504`가 `{geocoding.isAvailable && ...}`로 좌표변환 카드 전체를,
   `ReviewPage.tsx:223`이 `{noCoordsCount > 0 && geocoding.isAvailable && ...}`로
   안내 배너 전체를 조건부 렌더. `batchGeocoder.ts:39-42`는 console.warn 후 조용히 반환.
   → **"키가 없다"는 잘못된 메시지는 안 나온다. 아무 메시지도 안 나온다.** 버튼과 안내가
   통째로 사라지고 지도만 빈다. 대체 안내 렌더가 필요하나 `ReviewPage.tsx`는 레인 A 소유 →
   순차 단계 또는 후속 티켓으로 분리할 것.
4. 롤백 **발동 기준**이 없다(방법만 있음). 레인 B는 엑셀을 열어야 발견되어 늦다.
5. 통합검증 5의 적대적 검증에 **증거 형태**가 없다 → 레인 A는 `git stash` 후 lint
   재실행으로 실제 변이 검증 가능하니 명시할 것.
6. 레인 A·B의 의미적 결합 미명시: `ExportPage.tsx:47-49`의 `repCount`는 레인 A 파일이지만
   값은 레인 B가 바꾼다 → 리뷰 시 오진 가능.

## 모호성 리스크
- 레인 A 조치 1: "early return을 내린다"(해석 A) vs "훅을 올린다"(해석 B).
  해석 A를 ExportPage에 적용하면 불필요한 null 가드가 붙어 회귀 판정 면적이 커지고
  Discovery §4 "최소 변경"과 충돌 → M-4 파일별 지시로 해소.
- 레인 B 조치 3: `allUsedKeys` 축소(A) vs 유지(B) → **B로 못박을 것**.
- 레인 C 조치 1·3의 종속 관계 미기술: 조치 1이 성공하면 조치 3은 무효과.
  조치 3은 오직 조치 1 실패 시에만 의미를 가지며, 플랜의 검증 조건은
  실제 프로덕션에서 재현 불가.

## 승인(무조건)으로 올리기 위한 6개 조건
1. **[C-1]** 게이트를 `rules-of-hooks 6→0`, `총 error 18→12`로 수치화 + 레인 B 로그 판정 절차
2. **[M-1]** 레인 C에 `gh secret list` 확인 추가, 또는 배포 검증 분리 후 done 조건에서 제외
3. **[M-2]** `allUsedKeys`는 `enrichedEligibleRep` 기준 유지로 못박고 거짓 증명 문구 삭제
4. **[M-3]** 대표필지 시트 예상 행수 수치화 + `중복여부` 컬럼 역할 기록 + **사용자 확인**
5. **[M-4]** 레인 A를 ExportPage(훅 hoist만) / ReviewPage(early return 이동 + validation 재선언)로 분리 기술
6. **[결여 3]** `isAvailable === false` 시 사용자에게 보여줄 것을 결정 + 레인 A 파일 충돌 회피

## 미채점 열린 질문
- 레인 A 크래시 재현은 코드/라우터 구현으로만 확인했고 브라우저 실행은 안 함.
  착수 전 `npm run dev`에서 "처음부터 다시" 1회 클릭으로 기준선 확보 권장.
- `xlsx@0.18.5` prototype pollution / ReDoS — 후속 티켓 우선순위 재검토 대상.
- `toggleParcelSelection`(`:358-362`)은 제거한 필지를 다시 선택 불가. P1이나 성격이 P0-2에 가까움.
- `deploy.yml`의 `404.html` 복사는 `HashRouter`라 불필요(무해, 범위 밖).
