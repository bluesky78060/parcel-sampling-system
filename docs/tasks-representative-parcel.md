# 대표필지 기능 추가 - 태스크 목록

> 작성일: 2026-02-25
> 기반 계획서: `docs/plan-representative-parcel.md`
> 대상 시스템: 농업환경변동조사 필지 추출 시스템 (봉화군)

---

## 요약

### 전체 태스크 현황

| 항목 | 내용 |
|------|------|
| 총 태스크 수 | 15개 |
| 예상 소요 노력 | S×4 + M×8 + L×3 |

### 페이즈별 태스크 수

| 페이즈 | 이름 | 태스크 수 | 규모 |
|--------|------|-----------|------|
| Phase 1 | 기반 (Foundation) | 4개 | T-01 ~ T-04 |
| Phase 2 | 파일 입력 (File Input) | 2개 | T-05 ~ T-06 |
| Phase 3 | 분석/추출 (Analysis & Extraction) | 2개 | T-07 ~ T-08 |
| Phase 4 | 지도/검토 UI (Map & Review) | 4개 | T-09 ~ T-12 |
| Phase 5 | 내보내기 (Export) | 2개 | T-13 ~ T-14 |
| Phase 6 | 검증 (Verification) | 1개 | T-15 |

### 의존성 그래프 (단순화)

```
T-01 (타입)
 ├── T-02 (excelParser)
 │    └── T-07 (AnalyzePage 파싱)
 ├── T-03 (parcelStore)
 │    ├── T-04 (extractionStore) ──── T-08 (ExtractPage UI)
 │    └── T-07 (AnalyzePage 파싱)
 ├── T-05 (UploadPage)
 │    └── T-06 (MappingPage)
 ├── T-09 (KakaoMap 색상)
 │    └── T-10 (MapLegend)
 │         └── T-12 (ReviewPage 상세)
 └── T-11 (ResultTable)
      └── T-12 (ReviewPage 상세)
T-13 (excelExporter)
 └── T-14 (ExportPage)
T-01 ~ T-14 → T-15 (통합 테스트)
```

### 태스크별 예상 노력

| 태스크 | 제목 | 규모 |
|--------|------|------|
| T-01 | Parcel 타입에 parcelCategory 필드 추가 | S |
| T-02 | excelParser에 카테고리 파라미터 추가 | S |
| T-03 | parcelStore에 대표필지 상태 추가 | S |
| T-04 | extractionStore에 effectiveTarget 계산 및 병합 로직 추가 | M |
| T-05 | UploadPage에 대표필지 파일 슬롯 추가 | M |
| T-06 | MappingPage에서 대표필지 파일 매핑 지원 | S |
| T-07 | AnalyzePage에서 대표필지 파싱 및 저장 | M |
| T-08 | ExtractPage에 대표필지 정보 및 유효 목표 표시 | M |
| T-09 | KakaoMap 마커 색상에 대표필지 분기 추가 | M |
| T-10 | MapLegend에 대표필지 항목 추가 | S |
| T-11 | ResultTable에 카테고리 배지 컬럼 추가 | M |
| T-12 | ReviewPage 상세 패널 및 범례 counts 업데이트 | M |
| T-13 | excelExporter에 대표필지 별도 시트 추가 | L |
| T-14 | ExportPage에서 대표필지 데이터 전달 | S |
| T-15 | 전체 흐름 통합 테스트 | L |

> 규모 기준: S = 30분 이내, M = 30분~2시간, L = 2시간 이상

---

## Phase 1: 기반 (Foundation)

### T-01: Parcel 타입에 parcelCategory 필드 추가
- **파일**: `src/types/index.ts`
- **의존**: 없음
- **규모**: S
- **설명**: `Parcel` 인터페이스에 `parcelCategory: 'public-payment' | 'representative'` 필드 추가. `FileConfig.role`에 `'representative'` 값 추가. `Statistics` 인터페이스에 `representativeParcels: number` 필드 추가. 기존 `Parcel` 객체와의 하위 호환을 위해 `parcelCategory ?? 'public-payment'` 기본값 처리 패턴을 코드 전반에 적용할 준비.
- **완료 조건**: TypeScript 컴파일 에러 없음. `parcelCategory`, `FileConfig.role: 'representative'`, `Statistics.representativeParcels` 세 가지 변경이 모두 반영됨.
- [ ] 체크박스

---

### T-02: excelParser에 카테고리 파라미터 추가
- **파일**: `src/lib/excelParser.ts`
- **의존**: T-01
- **규모**: S
- **설명**: `applyColumnMapping()` 함수 시그니처에 선택적 `category: 'public-payment' | 'representative'` 파라미터 추가. 파라미터 미전달 시 기본값 `'public-payment'`. 함수 내부에서 반환되는 `Parcel[]`의 각 항목에 `parcelCategory` 값을 주입. 기존 호출부는 파라미터 없이도 동작하도록 하위 호환 유지.
- **완료 조건**: 기존 호출부에서 파라미터 없이 호출 시 `parcelCategory === 'public-payment'`로 설정됨. `category: 'representative'` 전달 시 `parcelCategory === 'representative'`로 설정됨.
- [ ] 체크박스

---

### T-03: parcelStore에 대표필지 상태 추가
- **파일**: `src/store/parcelStore.ts`
- **의존**: T-01
- **규모**: S
- **설명**: 스토어에 `representativeParcels: Parcel[]` 상태 추가 (초기값 `[]`). `setRepresentativeParcels(parcels: Parcel[])` 액션 추가. `calculateStatistics()` 함수에 `representativeParcels.length`를 `statistics.representativeParcels`에 반영하도록 수정. `reset()` 액션에 `representativeParcels: []` 초기화 추가.
- **완료 조건**: 스토어에서 대표필지 CRUD 가능. `calculateStatistics()` 호출 후 `statistics.representativeParcels`가 정확한 수를 반환함. `reset()` 후 `representativeParcels`가 빈 배열로 초기화됨.
- [ ] 체크박스

---

### T-04: extractionStore에 effectiveTarget 계산 및 병합 로직 추가
- **파일**: `src/store/extractionStore.ts`
- **의존**: T-01, T-03
- **규모**: M
- **설명**: `runExtraction()` 실행 시 `parcelStore.representativeParcels.length`를 `config.totalTarget`에서 차감한 `effectiveTarget`을 계산. 이 `effectiveTarget`으로 공익직불제 추출 알고리즘을 실행. 추출 결과 `selectedParcels`에 대표필지를 앞에 배치하여 병합: `finalSelected = [...representativeParcels, ...extractionResult.selectedParcels]`. `representativeParcels.length > totalTarget`인 경우 경고 메시지 설정. `effectiveTarget`이 0 이하인 경우 공익직불제 추출 단계를 건너뜀.
- **완료 조건**: `selectedParcels = [...representativeParcels, ...extractedPublicPayment]` 순서 유지. 총 선택 수가 `totalTarget` 이하. 대표필지 50개, 총 목표 700 설정 시 공익직불제 650개 추출 실행됨.
- [ ] 체크박스

---

## Phase 2: 파일 입력 (File Input)

### T-05: UploadPage에 대표필지 파일 슬롯 추가
- **파일**: `src/pages/UploadPage.tsx`
- **의존**: T-01
- **규모**: M
- **설명**: SLOTS 배열(또는 동등한 구조)에 대표필지 슬롯 추가: `{ slotId: 'representative', label: '대표필지 파일 (선택사항)', required: false, defaultYear: 2026, defaultRole: 'representative' }`. 기존 필수 3개 파일(master-2026, sampled-2024, sampled-2025) 아래에 구분선 또는 섹션 헤더를 두어 시각적으로 분리. 슬롯 설명: "3개년 전 데이터에서 지정된 대표필지. 마스터 파일 매칭 없이 그대로 포함됩니다." 선택 배지(초록색 "선택" 표시). 다음 단계 이동 조건은 필수 3개 파일 완료만으로 충족 (대표필지 파일 유무 무관).
- **완료 조건**: 대표필지 파일 업로드한 경우와 미업로드한 경우 모두 다음 단계(매핑 페이지)로 이동 가능. 파일 업로드 시 `role: 'representative'`로 `FileConfig` 생성됨.
- [ ] 체크박스

---

### T-06: MappingPage에서 대표필지 파일 매핑 지원
- **파일**: `src/pages/MappingPage.tsx`
- **의존**: T-05
- **규모**: S
- **설명**: `role === 'representative'` 파일도 매핑 UI 목록에 표시. 해당 파일의 매핑 안내 문구를 "마스터 파일과 매칭하지 않습니다. 필지주소, 농가번호, 필지번호 등 기본 필드를 매핑하세요."로 표시. 필수 매핑 필드: `farmerId` (경영체번호), `parcelId` (필지번호), `address` (필지주소). 나머지 필드는 선택 사항으로 표시. 매핑 완료 후 `status: 'mapped'`로 업데이트.
- **완료 조건**: 대표필지 파일의 컬럼 매핑 UI가 표시되고 저장됨. 대표필지 파일 없을 때 기존 3개 파일 매핑 UI 정상 동작.
- [ ] 체크박스

---

## Phase 3: 분석/추출 (Analysis & Extraction)

### T-07: AnalyzePage에서 대표필지 파싱 및 저장
- **파일**: `src/pages/AnalyzePage.tsx`
- **의존**: T-02, T-03
- **규모**: M
- **설명**: 분석 실행(`runAnalysis()`) 시 대표필지 파일이 존재하면 `applyColumnMapping(rawData, mapping, filename, undefined, 'representative')`로 파싱. 파싱 결과 각 항목에 `isEligible: true, isSelected: true` 설정. `parcelStore.setRepresentativeParcels()` 호출하여 저장. Geocoding 단계에서 대표필지도 포함 (대표필지를 `eligibleParcels` 배열에 합산하여 단일 Geocoding 요청 수행). 통계 카드에 "대표필지 N개" 항목 표시. 대표필지 파일 없을 때 기존 흐름 유지.
- **완료 조건**: 대표필지 파일 업로드 후 분석 실행 시 `parcelStore.representativeParcels`에 파싱 결과가 저장됨. 통계에 대표필지 수가 반영됨. 대표필지 파일 없을 때 기존 동작과 동일.
- [ ] 체크박스

---

### T-08: ExtractPage에 대표필지 정보 및 유효 목표 표시
- **파일**: `src/pages/ExtractPage.tsx`
- **의존**: T-04
- **규모**: M
- **설명**: 추출 설정 패널에 대표필지 정보 표시 영역 추가. 대표필지가 있을 때: "대표필지: N개 (고정)", "공익직불제 추출 목표: M개 (= 700 - N)", "총 목표: 700개" 형태로 표시. 대표필지가 0개일 때 기존 UI와 동일하게 표시 (추가 UI 요소 숨김). `parcelStore.representativeParcels.length`와 `extractionStore`의 설정을 연동하여 유효 목표가 자동 계산됨을 시각적으로 확인 가능하게 함.
- **완료 조건**: 대표필지 50개 설정 시 "공익직불제 추출: 650개 = 700 - 50" 표시. 대표필지 0개 시 기존 UI 유지.
- [ ] 체크박스

---

## Phase 4: 지도/검토 UI (Map & Review)

### T-09: KakaoMap 마커 색상에 대표필지 분기 추가
- **파일**: `src/components/Map/KakaoMap.tsx`
- **의존**: T-01
- **규모**: M
- **설명**: `getMarkerColor()` 함수에 대표필지 조건 추가: `parcel.parcelCategory === 'representative' && isSelected`이면 `#059669` (emerald-600) 반환. 이 조건을 기존 공익직불제 로직보다 먼저 평가. 마커 팝업(`createPopupContent()` 또는 동등한 함수)에 카테고리 배지 표시: 대표필지면 초록 배지 "대표필지", 공익직불제면 파란 배지 "공익직불제". `parcelCategory`가 없는 기존 객체는 `parcelCategory ?? 'public-payment'`로 처리.
- **완료 조건**: 대표필지 마커가 초록색(`#059669`)으로 표시됨. 공익직불제 마커는 기존 파란색(`#2563eb`) 유지. 마커 팝업에 카테고리 배지 표시.
- [ ] 체크박스

---

### T-10: MapLegend에 대표필지 항목 추가
- **파일**: `src/components/Map/MapLegend.tsx`
- **의존**: T-09
- **규모**: S
- **설명**: `counts` props 타입에 `representative: number` 필드 추가. 범례 항목 배열 첫 번째 위치에 `{ color: '#059669', label: '대표필지 (고정)', count: counts.representative }` 추가. 기존 '2026 추출 선택' 라벨을 '공익직불제 추출 선택'으로 변경. 총 범례 항목이 6개가 됨: 대표필지(고정), 공익직불제 추출 선택, 추출 후보 미선택, 2024 채취 제외, 2025 채취 제외, 좌표 미변환.
- **완료 조건**: 범례에 6개 항목 표시됨. 대표필지 항목이 첫 번째 위치. `representative` count가 0이어도 표시됨 (또는 0일 때 숨김 - 구현 판단에 따름).
- [ ] 체크박스

---

### T-11: ResultTable에 카테고리 배지 컬럼 추가
- **파일**: `src/components/Review/ResultTable.tsx`
- **의존**: T-01
- **규모**: M
- **설명**: 결과 테이블에 '구분' 컬럼 추가 (첫 번째 또는 두 번째 컬럼 위치). 공익직불제 행: 파란 배지 (`bg-blue-100 text-blue-700`) "공익직불제" 표시. 대표필지 행: 초록 배지 (`bg-emerald-100 text-emerald-700`) "대표필지" 표시. 대표필지 행의 선택/해제 체크박스 비활성화 (`disabled` 처리). 대표필지 행의 "제거" 버튼도 비활성화 또는 숨김 처리.
- **완료 조건**: 테이블에서 공익직불제/대표필지 카테고리 배지로 시각적 구분 가능. 대표필지 행 체크박스 비활성화됨.
- [ ] 체크박스

---

### T-12: ReviewPage 상세 패널 및 범례 counts 업데이트
- **파일**: `src/pages/ReviewPage.tsx`
- **의존**: T-09, T-10, T-11
- **규모**: M
- **설명**: 마커 클릭 시 표시되는 상세 패널에 '구분' 항목 추가: 카테고리에 따라 초록/파란 배지로 "대표필지" 또는 "공익직불제" 표시. `MapLegend`에 전달하는 `mapLegendCounts`에 `representative` 카운트 추가 (`selectedParcels.filter(p => p.parcelCategory === 'representative').length`). 선택 카운트 표시 영역을 "공익직불제 N + 대표필지 M = 총 N+M" 형태로 업데이트.
- **완료 조건**: 마커 클릭 상세 패널에 '구분' 배지 표시. 범례 `representative` count가 정확히 계산됨. 선택 카운트 합산 표시 정확.
- [ ] 체크박스

---

## Phase 5: 내보내기 (Export)

### T-13: excelExporter에 대표필지 별도 시트 추가
- **파일**: `src/lib/excelExporter.ts`
- **의존**: T-01
- **규모**: L
- **설명**: 엑셀 출력 구조를 다음과 같이 변경.
  - **기존 `2026_필지선정` 시트**: 공익직불제 필지만 포함 (기존 19컬럼 형식 그대로 유지)
  - **신규 `대표필지` 시트**: 대표필지만 포함 (동일한 19컬럼 형식)
  - **`전체필지` 시트**: 기존 전체 필지 데이터에 '구분' 컬럼 추가 (공익직불제/대표필지 구분)
  - **시트 순서**: `2026_필지선정` → `대표필지` → `리별_통계` → `농가별_통계` → `제외필지` → `전체필지`
  - `ExportData` 인터페이스에 `representativeParcels: Parcel[]` 필드 추가
  - 대표필지 시트 생성 함수(`createRepresentativeSheet()` 등) 추가 또는 기존 시트 생성 함수 재사용
- **완료 조건**: 공익직불제 필지와 대표필지가 각각 별도 시트(`2026_필지선정`, `대표필지`)로 출력됨. `전체필지` 시트에 '구분' 컬럼 포함. 시트 순서 명세대로.
- [ ] 체크박스

---

### T-14: ExportPage에서 대표필지 데이터 전달
- **파일**: `src/pages/ExportPage.tsx`
- **의존**: T-13
- **규모**: S
- **설명**: `exportToExcel()` 호출 시 `parcelStore.representativeParcels` 데이터를 `ExportData.representativeParcels`로 전달. 다운로드 UI(버튼 또는 미리보기 영역)에 대표필지 수 표시 ("대표필지 N개 포함" 등). `selectedParcels`에서 공익직불제만 필터링하여 `2026_필지선정` 시트 데이터로 전달 (`selectedParcels.filter(p => p.parcelCategory !== 'representative')`).
- **완료 조건**: 내보내기 실행 시 `2026_필지선정` 시트(공익직불제)와 `대표필지` 시트가 모두 포함된 엑셀 파일 생성됨.
- [ ] 체크박스

---

## Phase 6: 검증 (Verification)

### T-15: 전체 흐름 통합 테스트
- **파일**: 전체
- **의존**: T-01 ~ T-14
- **규모**: L
- **설명**: 두 가지 시나리오에서 전체 워크플로우(업로드 → 매핑 → 분석 → 추출 → 검토 → 내보내기) 동작 확인.
  - **시나리오 A (대표필지 파일 포함)**: 대표필지 파일 업로드 → 매핑 → 분석 시 parcelStore에 저장됨 확인 → 추출 시 effectiveTarget 자동 계산 확인 → 지도에서 초록 마커 확인 → 범례 6항목 확인 → 테이블 배지 확인 → 엑셀 출력 2개 시트 확인.
  - **시나리오 B (대표필지 파일 미포함)**: 기존 3개 파일만으로 전체 흐름이 에러 없이 정상 동작하는지 확인. 기존 동작과 완전히 동일해야 함.
  - TypeScript 컴파일 에러 없음 (`tsc --noEmit` 또는 빌드 성공).
  - 지도 마커 색상, 범례, 상세 패널 카테고리 표시 정확성 확인.
  - 엑셀 출력 시트 구조 및 데이터 정확성 확인.
- **완료 조건**: 두 시나리오 모두 에러 없이 정상 동작. TypeScript 컴파일 에러 없음. 엑셀 파일에 공익직불제/대표필지 별도 시트 포함됨.
- [ ] 체크박스

---

*본 태스크 문서는 `docs/plan-representative-parcel.md` 계획서를 기반으로 작성되었습니다.*
*사용자 수정사항: F-04 - 총 목표 700개에 대표필지 포함하여 공익직불제 추출 목표 차감 방식. F-09 - 공익직불제/대표필지를 별도 시트로 분리 출력.*
