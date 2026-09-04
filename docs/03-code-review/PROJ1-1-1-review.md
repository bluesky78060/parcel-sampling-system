# PROJ1-1-1 코드 리뷰 — P0 수정 diff

- 대상: `git diff HEAD -- src .github .env.example` (8파일 / +112 −45)
- 브랜치: `bluesky78060/codebase-analysis`
- 리뷰 레인 3중 (CLAUDE.md P0 3중 검증 규칙)
  1. `code-reviewer` (Claude Opus) — 전체 diff 정독 + 호출처 전수 추적 + lint/build 실측
  2. `codex` (다른 계열 모델) — 독립 diff 리뷰
  3. 적대적 검증 — 리뷰어에게 7개 항목 반증 지시

## 실측 증거

| 항목 | 수정 전 | 수정 후 |
|---|---|---|
| `npm run lint` | error 18 (`rules-of-hooks` 6) | **error 12, `rules-of-hooks` 0** |
| 잔여 error | — | 전부 이번 diff 범위 밖 (`useKakaoMap.ts` any 5, 지도 훅 ref 4, setState-in-effect 2, 미사용 변수 1) |
| `npm run build` | 통과 | **통과** (tsc -b + vite, 106 modules) |

## 1차 판정: REQUEST CHANGES → 2건 수정 후 재검증

`code-reviewer` 최종 판정은 **REQUEST CHANGES**였다. CRITICAL·보안 결함은 0건이고
P0-1(훅 규칙)·P0-3(지오코딩 판정)은 승인 품질이나, **P0-2가 새로 만든 사용자 대면
불일치 2건**이 머지를 막았다.

### MAJOR-1 (수정 완료) — 세 화면이 서로 다른 총계를 표시
레인 B가 `ExtractPage`만 고유 필지 기준으로 바꿔, 수정 전에는 일관됐던 세 화면이 어긋났다.
**이번 diff가 만든 회귀다.**

| 화면 | 1차 리뷰 시점 | 수정 후 |
|---|---|---|
| `ExtractPage:252` | `resultSummary.unique` (고유) | 동일 |
| `ReviewPage:188` | `selectedParcels.length` (원본) | `countUniqueSelected(selectedParcels)` |
| `ExportPage:45` | `selectedParcels.length` (원본) | `countUniqueSelected(selectedParcels)` |

재현: 마스터·대표필지 양쪽에 적격 필지 A가 있으면 추출 화면 709 → 검토 화면 710 →
내보내기 화면 710. 같은 데이터에 세 숫자.
부수: `ExportPage:47`의 `avgPerRi` 분모도 중복 포함 건수를 쓰고 있었으나 함께 해소.

### MAJOR-2 (수정 완료) — 한 화면에 모집단이 다른 두 "중복" 숫자
**키 공식은 세 곳 모두 일치**함이 확인됐다 (`extractionStore.ts:7`,
`excelExporter.ts:121-123`, `ExportPage.tsx:24,30` — 전부 `p.pnu || address__parcelId`).
문제는 키가 아니라 **모집단**이었다.

| 지표 | 모집단 | 의미 |
|---|---|---|
| `duplicates.count` (ExtractPage:212) | `allParcels` ∩ `representativeParcels` **전체** | 선택 여부 무관, 엑셀 '중복여부' O 기준 |
| `resultSummary.dupCount` (ExtractPage:255, 신규) | `result.selectedParcels` 내부 | 결과에 두 번 실린 건수, **적격 대표필지만** |

재현: 대표필지 파일 행의 **면적 칸이 비어 있기만 해도** `getParcelArea`가 그 행 자신의
값을 보므로 `excludedRepReasons`로 빠진다 → `dupCount = 0`인데 `duplicates.count = 1`,
엑셀에는 `중복여부 = O`. 같은 화면 위아래가 모순된 주장을 하고, 배너 본문의
"양쪽 모두 그대로 포함되며"는 이 경우 **사실이 아니다**.

조치(라벨 분리 — 엑셀 산출물 불변 유지):
- 배너 제목 → `원본 파일 간 동일 필지 N건`
- 배너 본문 → `(엑셀 '중복여부' 컬럼 O 표시 기준). 이 중 적격 조건(기채취 미중복·제외 리 아님·면적 500㎡ 이상)을 통과한 대표필지만 양쪽 시트에 포함되며`
- 결과 요약 → `겹침 N건` → `결과에 두 번 실림 N건`

### MINOR-1 (후속 이관) — `countUniqueSelected` 키에 `farmerId` 없음
`matchKey`는 경영체를 구분하지 않는다. 동일 PNU를 경영체 X·Y가 각각 신청해 2행으로
존재하면 `unique`가 1건 과소 집계되고 "결과에 두 번 실림"으로 오분류된다.
신뢰도 MEDIUM(실데이터에 동일 PNU 다중 경영체가 있는지 미확인).
→ **PROJ1-1-3**(parcelId 전역 고유키 오용)과 같은 성격이므로 그쪽에서 함께 처리.

### SUGGESTION-1 (미조치, 무해) — ReviewPage에서 `result === null` 시 memo 4개 헛돔
가드가 아래로 내려가면서 null 렌더에서도 `allParcels` 전체 O(n) 순회 2회가 발생한다.
**정확성 영향 없음**(결과가 렌더되지 않고 `EMPTY_PARCELS`가 참조 안정적). 이득 대비
복잡도가 낮아 그대로 둠.

## 적대적 검증 7개 항목 — 판정

| # | 항목 | 판정 |
|---|---|---|
| 1 | `taggedPublic` 별칭화가 `finalParcels`를 바꾸는가 | **안전** — 사용처 전수(`selectedKeySet`/`repInPublicCount`/`allUsedKeys` 모두 읽기, `finalParcels`는 스프레드 복사) + 저장소 전역 인플레이스 변이 grep 0건 |
| 2 | `matchKey` 모듈 스코프 승격 | **안전** — 캡처 자유변수 없는 순수 함수, `getParcelKey`와 문자 단위 동일 |
| 3 | `EMPTY_PARCELS` 공유 가변 배열 | **안전** — `ResultTable`이 TanStack `data`로만 사용(유일한 `.sort()`는 `[...years]` 복사본), `src` 전체에 변이 패턴 0건 |
| 4 | `publicSelected = length - repSelected` 등식 | **항상 성립** — 정의상 항등식 |
| 5 | 신규 안내 배너 중복/오표시 | **없음** — `AnalyzePage:504` vs `:528`, `ReviewPage:227` vs `:275` 모두 상호 배타 |
| 6 | `isGeocodingAvailable()` 파급 | **dev 회귀 없음, prod 정정 정확** — 5개 조합 전수 대조. prod+Kakao만 있을 때 `true`(거짓 양성) → `false`가 유일한 변화 |
| 7 | `.env.example` / `deploy.yml` 사실성 | **정확** — 커밋된 `.env`가 없어 빈 문자열이 기존 값을 덮을 위험 없음, vite 프록시 존재 확인 |

`codex`(독립 레인)도 위 1~4·6·7에 대해 동일하게 "새로 만든 문제 없음"으로 판정.

## P0-3 완료 조건에 대한 정정

이 diff는 "프로덕션 지오코딩 복구"를 **완료하지 않는다.** `gh secret list` 실측 결과
`VITE_VWORLD_KEY`가 저장소에 **미등록**이다(등록된 것은 `VITE_KAKAO_JS_KEY`,
`VITE_KAKAO_REST_KEY` 둘뿐). 따라서 배포본은 여전히 지오코딩·지적도·배경지도가 죽어
있고, 달라진 것은 **거짓 양성 버튼 대신 정직한 안내 배너를 보여준다**는 점이다.

실제 복구는 다음 실행 시점에 일어난다:
```
gh secret set VITE_VWORLD_KEY --repo bluesky78060/parcel-sampling-system
```
→ 이 명령은 키 값을 모르므로 실행하지 않았다. 사용자 조치 필요 사항으로 남긴다.

## 잘된 점 (리뷰어 지적)
- P0-1 완결: 두 파일 모두 가드 아래 훅 0개 (ExportPage 가드 `:36` / 최종 훅 `:22`, ReviewPage 가드 `:148` / 최종 훅 `:114`)
- `EMPTY_PARCELS` 모듈 상수 도입이 정확 — 인라인 `?? []`였다면 5개 memo가 매 렌더 무효화
- 죽은 삼항 제거 + `KAKAO_REST_USABLE` 단일 판정점: 3곳에 분산됐던 오해를 한 상수로 모으고 이유(CORS + 상대경로 404)를 주석에 남김
- `.env.example` 주석이 실패 모드와 복구 명령을 함께 기술

## 최종 상태
MAJOR 2건 수정 후 `npm run build` 통과, `rules-of-hooks` 0, lint error 12(불변).
수정본은 별도 레인(`codex`)에서 재리뷰.

---

# 2라운드 — 수정본 재리뷰 (codex, 독립 레인)

CLAUDE.md 규칙: "찾은 쪽과 고친 쪽이 다르면 수정본을 다시 리뷰에 넣으십시오.
수정본은 아무도 검토하지 않은 새 코드다."

1라운드 MAJOR 2건을 오케스트레이터가 수정한 뒤 `codex`에 재투입했고, **그 수정 자체에서
MAJOR 3건이 추가로 나왔다.** 1라운드와 같은 패턴이 반복된 셈이다.

## R2-MAJOR-1 (수정 완료) — MAJOR-1 수정이 ReviewPage 내부에서 불완전
상단 요약만 고유 기준으로 바꿔, **같은 화면 안에서** 어긋났다.

| 위치 | 수정 직후 | 재수정 후 |
|---|---|---|
| `ReviewPage:190` 상단 요약 | 고유 | 고유 |
| `ReviewPage:208` → `ValidationPanel.selectedCount` | `selectedParcels.length` (행 수) | `uniqueSelectedCount` |
| `ResultTable:235` 내부 "선택: N / 목표" | `selectedParcels.length` (행 수) | `selectedCount ?? …` prop |

재현: 공익 700행 + 대표필지 겹침 10행 → 상단 `선택: 700`, 검증 패널·테이블 `선택: 710`.
조치: `uniqueSelectedCount`를 한 번 계산해 세 지점에 전달. `ResultTable`에는 선택적
`selectedCount` prop 신설(미전달 시 기존 동작 유지).

## R2-MAJOR-2 (수정 완료) — **1라운드 리뷰의 재현 시나리오 자체가 틀렸다**
1라운드 `code-reviewer`는 MAJOR-2의 재현을 이렇게 기술했다:

> "대표필지 파일 행의 **면적 칸이 비어 있기만 해도** `getParcelArea`가 그 행 자신의
> 값을 보므로 `excludedRepReasons`로 빠진다"

**사실이 아니다.** `extractionStore.ts:147`의 실제 조건은
```ts
if (area !== null && area < MIN_AREA) { /* 제외 */ }
```
즉 **면적 정보가 없으면(null) 통과**한다. `extractionAlgorithm.ts:314`의 일반 추출
필터도 `if (area === null) return true;`로 동일하다.

이 잘못된 전제를 그대로 믿고 쓴 배너 문구
`적격 조건(… 면적 500㎡ 이상)` → `적격 조건(… 면적 정보가 있으면 500㎡ 이상)`으로 정정.

MAJOR-2의 **결론(모집단이 다른 두 지표가 같은 단어로 표시됨)은 여전히 유효**하다.
다만 발생 경로는 "면적 빈 칸"이 아니라 **기채취 중복 / 제외 리 / 면적이 있고 500㎡ 미만**
셋이다.

> 교훈: 리뷰어의 재현 시나리오도 액면가로 믿지 말 것. 조건문의 부호 하나가
> 재현 가능성을 뒤집는다.

## R2-MAJOR-3 (후속 이관) — `countUniqueSelected` 키가 추출 로직의 매칭 키와 불일치
`matchKey`는 `pnu || 주소__필지번호`만 쓰지만, 추출 로직은 그 키가 안 맞을 때
`farmerId_parcelId`로도 대표필지를 매칭한다(`extractionStore.ts:256`,
`extractionAlgorithm.ts:238`).

재현: 마스터에 PNU 없음(`F1`/`10`), 대표필지에 PNU 있음(`F1`/`10`) → 추출 로직은 같은
필지로 보지만 `countUniqueSelected`는 2건으로 센다. 엑셀 '중복여부'도 같은 공식이라
동일 문제.

→ 키 체계 통일은 `excelExporter`·추출 알고리즘까지 걸쳐 있어 이번 티켓 범위를 넘는다.
**PROJ1-1-3**(parcelId 전역 고유키 오용)에서 함께 처리.
1라운드 MINOR-1(`farmerId` 미포함으로 동일 PNU 다중 경영체 오분류)도 같은 티켓으로 이관.

## R2-MINOR (수정 완료) — `avgPerRi`의 분자·분모 기준 불일치
`ExportPage`에서 분자 `totalSelected`는 고유 수인데 분모 `uniqueRiCount`는 **원본 행
배열**에서 계산했다. 겹친 두 행의 `ri`가 다르면 평균이 왜곡된다.
조치: `dedupeSelected()` 헬퍼를 신설해 분자·분모를 **같은 배열**에서 뽑도록 변경.

## R2-SUGGESTION (미조치) — `countUniqueSelected` 렌더 중 직접 호출
`Set` 기반 O(n)이라 현 규모에서 성능 문제 없음. `result`가 불변 배열로 갱신되므로
정확성도 영향 없음. codex 판정 그대로 둠.

## 2라운드 후 최종 검증
```
npm run build   → 통과 (tsc -b && vite build)
npm run lint    → error 12, warning 4 (기준선 18 → 12), rules-of-hooks 0
```
'선택' 수를 표시하는 전 지점(ExtractPage / ReviewPage 상단 / ValidationPanel /
ResultTable / ExportPage)이 모두 동일한 고유 필지 기준을 사용함을 grep으로 확인.
  - 이번 티켓 범위 밖(후속): R2-MAJOR-3, MINOR-1 → PROJ1-1-3
