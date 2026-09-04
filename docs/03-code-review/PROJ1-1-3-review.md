# PROJ1-1-3 검증 — parcelId를 고유키로 오용

작성일: 2026-09-04
대상: `src/lib/spatialUtils.ts`

## 1. 티켓의 시나리오는 성립하지 않는다 (더 큰 문제가 따로 있다)

티켓은 "**다른 리**의 동명 지번이 방문 처리되어 누락된다"고 진단했다.
호출 경로를 따라가 보면 그 경로는 발동하지 않는다.

```
extractParcels
  └ extractWithDensityOrShuffle(riParcels, …)   ← 리 단위 pool
      └ extractWithDensity(pool, …)
          └ clusterParcelsInRi(withCoords, …)   ← 이미 리 하나
          └ calculateDensity(p, withCoords, …)  ← 이미 리 하나
```

`clusterParcelsInRi`는 항상 **리 하나**를 받는다. 게다가 BFS의 이웃 조건에
`p.ri === current.ri`가 이미 들어 있다. 따라서 리 경계를 넘는 오염은 없다.

**그러나 같은 리 안에서 지번이 중복된다.** 실데이터(2027 원본+원본2, 39,859건):

| | |
| --- | --- |
| 같은 리 안 중복 지번 | **4,774종** |
| 초과 행 | **6,772건** |
| 한 지번 최대 | **12행** (현동리 `1683-1`, 동면리 `1949-3`) |

원인은 공유 필지(여러 농가가 한 필지 경작), 작물별 분리 등록 등이다.
지번은 애초에 고유키가 아니다.

## 2. 실제 피해 규모 — 추정하지 말고 측정한다

처음에는 "초과 행 6,772건이 그대로 누락된다"고 생각했다. **틀렸다.**
수정 전 코드를 실제로 돌려 리별 클러스터 원소 합계를 셌다.

| | 좌표 보유 필지 | 클러스터 원소 합계 | 누락 |
| --- | --- | --- | --- |
| 수정 전 | 39,859 | 39,808 | **51건** (12개 리) |
| 수정 후 | 39,859 | 39,859 | **0건** |

누락 상위: 현동리 31, 창평리 4, 내성리 3, 학산리 2, 가곡리 2.

초과 행 수(6,772)와 실제 누락(51)이 크게 다른 이유는 BFS 구조 때문이다.
첫 시드의 탐색이 반경 안의 필지를 한 클러스터로 빨아들이면 각 지번이 그 안에서
한 번씩 소비되므로, 빠지는 것은 **클러스터 경계에서 겹친 것**에 한정된다.

> ⚠️ 위 51건은 **PNU 기반 의사좌표**로 측정한 값이다. 실제 VWorld 폴리곤 중심점은
> 분포가 달라 클러스터 구조가 바뀌므로 누락 규모도 달라진다. 수정의 정당성은
> "지번은 고유키가 아니다"라는 사실에 있지 이 숫자에 있지 않다.

`calculateDensity`도 같은 이유로 왜곡됐다. `p.parcelId !== parcel.parcelId`는
자기 자신뿐 아니라 **같은 지번을 가진 다른 필지 전부**를 이웃에서 뺐다.

## 3. 조치 — 복합키 대신 참조 비교

티켓은 `${ri}__${farmerId}__${parcelId}` 복합키를 제안했다. 그러나 같은 농가가
같은 지번을 여러 행으로 등록하는 경우(작물별)가 실제로 있어 이 키도 충돌한다.

**필지 객체 참조를 그대로 키로 쓰면 충돌이 원천적으로 불가능하다.**

```ts
// clusterParcelsInRi
const visited = new Set<Parcel>();   // 이전: Set<string>(parcelId)
if (visited.has(parcel)) continue;

// calculateDensity
(p) => p.coords != null && p !== parcel   // 이전: p.parcelId !== parcel.parcelId
```

키 생성 비용도 없고, 어떤 컬럼이 고유한지 따질 필요도 없다.

## 4. 검증

### 티켓의 종료 조건

> "리별 클러스터 원소 수 합계가 좌표 보유 필지 수와 일치하는지 확인"

39,859 = 39,859. **충족.**

### 변이 검증

`git checkout HEAD --`로 되돌려 같은 시나리오를 돌렸다. 51건 → 0건으로 갈렸다.
이 지표가 없었다면 "고쳤다"고 말할 근거가 없었다.

### 빌드·린트

`npm run build` exit 0, `spatialUtils.ts` 린트 지적 0건.

## 5. 같은 뿌리의 MAJOR 2건이 더 있었다

code-reviewer가 `spatialUtils.ts`를 APPROVE하면서, **정확히 같은 뿌리의 결함이
`extractionAlgorithm.ts`에 남아 있다**고 지적했다. 클러스터에서 살아난 필지가
보충 단계에서 다시 탈락하면 이번 수정의 효과가 반감되므로 함께 고쳤다.

### MAJOR 1 — 미달 보충에서 같은 지번의 미선택 행이 탈락 (`:427-428`)

```ts
const selectedKeySet = new Set(selected.map(p => `${p.farmerId}_${p.parcelId}`));
const remaining = candidates.filter(p => !selectedKeySet.has(`${p.farmerId}_${p.parcelId}`));
```

농가 A가 지번 `1683-1`을 사과·배 두 행으로 등록했을 때, 사과 행이 선택되면
**한 번도 선택된 적 없는 배 행이 `remaining`에서 빠진다.** `underfillPolicy:
'supplement'`가 기본값이라 **기본 경로에서 발동**한다.

### MAJOR 2 — 지목 비율 필터가 초과분을 못 지우고 보충 후보를 막음 (`:676-734`)

`keptKeys`가 유지 대상의 **키만** 담아서, 같은 키를 가진 다른 행이 초과분이면
`if (!keptKeys.has(key))`가 false가 되어 제거되지 않는다. 보충 루프도 같은 이유로
별개 행을 후보에서 뺀다.

### 조치

세 지점 모두 참조 Set으로 전환했다. `new Set(selected)` / `!selectedSet.has(p)` /
`kept: Set<Parcel>`. 이 시점의 `selected`는 아직 원본 참조다(복사는 `:483`에서 발생).

### 변이 검증

같은 농가가 같은 지번을 작물별로 3행 등록한 합성 데이터(360행 = 지번 120종 × 3작물)로
수정 전/후를 비교했다.

**MAJOR 1** (`enableLandCategoryFilter: false`, 목표 330)

| | 선택 |
| --- | --- |
| 수정 전 | **312건 (18건 미달)** |
| 수정 후 | **330건** |

**MAJOR 2** (`landCategoryRatios: {전 50, 답 30, 과수원 20}`, 목표 300)

| | 선택 | 지목 최대 편차 |
| --- | --- | --- |
| 수정 전 | 296건 | **16.2%p** (전 33.8%) |
| 수정 후 | 270건 | **5.6%p** (전 44.4%) |

수정 후 건수가 준 것은 합성 데이터에 '전'이 120행뿐이라 50%(150건)를 물리적으로
채울 수 없기 때문이다. **있는 만큼만 쓰고 비율을 지키는 것이 올바른 동작**이고,
수정 전은 초과분을 못 지워 건수를 억지로 채우며 비율을 16.2%p 어긋나게 만들었다.

### 재리뷰가 요청한 확인 — 가설이 아니라 사실이었다

재리뷰가 "270건 결과의 `validation.errors`에 `FARMER_OVER_LIMIT`이 있었는지 확인하라"고
요청했다. 실측했다.

```
--- maxPerFarmer = 1000 ---
선택 270건 / errors: TOTAL_MISMATCH
농가별 선택 수: F0=101 F1=98 F2=71

--- maxPerFarmer = 2 (실제 기본값) ---
선택 270건 / errors: TOTAL_MISMATCH, FARMER_OVER_LIMIT
농가별 선택 수: F0=98 F1=87 F2=85
```

제한이 2인데 농가 하나가 98건 선택된다. Step 5 지목 보충 루프에 `maxPerFarmer`
검사가 아예 없다(Step 3 `:291`, Step 4 `:464`에는 있다).

이 결함 자체는 이번 수정이 만든 것이 아니지만, **노출 폭은 넓혔다.** 예전에는
`keptKeys`가 키 기준이라 같은 농가·같은 지번의 여러 작물 행 중 하나만 들어갔는데,
참조 기반이 된 지금은 전부 들어간다.

농가 제한과 지목 비율은 서로 경쟁하므로 어느 쪽을 우선할지는 업무 결정이다.
검증된 변경에 미검증 정책 변경을 섞지 않기 위해 **PROJ1-1-23**으로 분리했다.

## 6. 남은 것

- **성능은 손대지 않았다.** `clusterParcelsInRi`의 BFS가 매 단계 `coordParcels`
  전체를 `filter`하고(`O(n²)`), `calculateDensity`도 필지마다 전체를 두 번 훑는다.
  리 단위라 n이 최대 1,575(현동리)여서 현재는 감당되지만, 공간 그리드 인덱스는
  별건으로 남긴다.
- **`extractionStore`의 결과표 조작도 같은 뿌리다.** `removeParcel`이
  `p.farmerId === farmerId && p.parcelId === parcelId` 값 비교라, 한 행을 지우면
  같은 지번의 다른 행까지 사라진다. `ResultTable`의 React key도 같은 문자열이라
  중복 key 경고가 따라온다. PROJ1-1-6 범위.
- **`maxPerFarmer` 미검사** — PROJ1-1-23 (업무 규칙 결정 선행)
- 이 수정을 못 박는 테스트가 없다. 이 두 수정은 성격상 조용히 되돌아가기 쉽다 —
  누군가 `Set<Parcel>`을 `Set<string>`으로 되돌려도 tsc·eslint·빌드가 전부 통과한다.
  실제로 이번에 `spatialUtils`만 고치고 `extractionAlgorithm`에 같은 뿌리가 남았던 것이
  그 취약함을 보여준다. Vitest 도입(PROJ1-1-9) 후 다음을 회귀 테스트로 고정할 것.
  1. 클러스터 원소 합계 == 입력 수 (중복 지번 12행 포함)
  2. `calculateDensity` 분모가 `N-1` 상수
  3. 같은 지번 다중 행 상황에서 보충이 목표를 채움
  4. 지목 비율 필터가 초과분을 실제로 제거함
