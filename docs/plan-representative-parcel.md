# 대표필지 기능 추가 구현 계획

> 작성일: 2026-02-25
> 대상 시스템: 농업환경변동조사 필지 추출 시스템 (봉화군)
> 기능명: 대표필지(Representative Parcel) 추가

---

## 1. 개요

현재 시스템은 **공익직불제** 필지를 마스터 파일(master-2026)과 기채취 파일(sampled-2024, sampled-2025)을 기반으로 추출 알고리즘을 거쳐 700개 필지를 선정한다.

**대표필지**는 이 추출 과정과 별개로, 3개년 전(과거) 데이터에서 별도로 지정된 필지를 그대로 포함시키는 유형이다. 대표필지는 마스터 파일과의 매칭 없이 자체 엑셀 파일에서 직접 가져오며, 700개 총 추출 목표에 포함된다.

### 핵심 설계 원칙

- **카테고리 구분**: `parcelCategory: 'public-payment' | 'representative'` 필드로 두 유형을 명확히 분리
- **사전 선택**: 대표필지는 업로드 즉시 `isSelected=true, isEligible=true`로 설정되며 추출 알고리즘을 거치지 않음
- **총 목표 차감**: 대표필지 수만큼 공익직불제 추출 목표에서 차감 (예: 대표필지 50개 → 공익직불제 650개 추출)
- **UI 전 영역 구분 표시**: 업로드, 매핑, 분석, 추출, 검토, 내보내기 모든 단계에서 유형 배지 표시

---

## 2. 요구사항

### 2.1 기능 요구사항

| 번호 | 요구사항 | 우선순위 |
|------|----------|----------|
| F-01 | 대표필지 엑셀 파일을 별도 업로드 슬롯에서 등록 | 필수 |
| F-02 | 대표필지 파일에 컬럼 매핑 적용 가능 | 필수 |
| F-03 | 대표필지는 마스터 파일과 매칭 불필요 | 필수 |
| F-04 | 대표필지 수를 총 700 목표에서 차감하여 공익직불제 추출 목표 자동 계산 | 필수 |
| F-05 | 결과 테이블에서 공익직불제/대표필지 구분 배지 표시 | 필수 |
| F-06 | 지도에서 대표필지 마커를 초록색(#059669)으로 표시 | 필수 |
| F-07 | 지도 범례에 대표필지 항목 추가 | 필수 |
| F-08 | 마커 클릭 상세 패널에 카테고리 표시 | 필수 |
| F-09 | 엑셀 내보내기 시 '구분' 컬럼 추가 (공익직불제/대표필지) | 필수 |
| F-10 | 대표필지 파일 미등록 시에도 기존 기능 정상 동작 (선택 사항 파일) | 필수 |

### 2.2 비기능 요구사항

- 대표필지 파일은 선택 사항이며, 미등록 시 기존 공익직불제 추출 흐름 그대로 유지
- 대표필지는 추출 알고리즘(리당 목표, 공간 클러스터링 등)의 대상이 아님
- 대표필지의 좌표 변환(Geocoding)은 공익직불제와 동일하게 선택적으로 수행
- 기존 19개 컬럼 엑셀 출력 형식 유지 (단, 첫 번째 컬럼으로 '구분' 추가)

---

## 3. 영향 범위

### 3.1 수정이 필요한 파일

| 파일 | 변경 유형 | 변경 내용 요약 |
|------|-----------|----------------|
| `src/types/index.ts` | 수정 | `Parcel`에 `parcelCategory` 필드 추가, `FileConfig.role`에 `'representative'` 추가 |
| `src/store/fileStore.ts` | 확인/수정 | 대표필지 파일 역할 처리 여부 확인 |
| `src/store/parcelStore.ts` | 수정 | `representativeParcels` 상태 추가, `Statistics` 업데이트 |
| `src/store/extractionStore.ts` | 수정 | `effectiveTarget` 계산 로직(totalTarget - 대표필지 수), 결과에 대표필지 병합 |
| `src/pages/UploadPage.tsx` | 수정 | 대표필지 파일 업로드 슬롯 추가 |
| `src/pages/MappingPage.tsx` | 수정 | 대표필지 파일 매핑 UI 포함 |
| `src/pages/AnalyzePage.tsx` | 수정 | 대표필지 파싱 및 parcelStore 저장 로직 추가 |
| `src/pages/ExtractPage.tsx` | 수정 | 대표필지 수 표시, 유효 목표 수 표시 |
| `src/pages/ReviewPage.tsx` | 수정 | 테이블/지도에 카테고리 구분 표시, 범례 업데이트 |
| `src/pages/ExportPage.tsx` | 수정 | 내보내기 데이터에 대표필지 포함 |
| `src/components/Review/ResultTable.tsx` | 수정 | 카테고리 배지 컬럼 추가 |
| `src/components/Map/KakaoMap.tsx` | 수정 | `getMarkerColor()` 대표필지 색상 분기 추가 |
| `src/components/Map/MapLegend.tsx` | 수정 | 대표필지 범례 항목 추가, props 타입 업데이트 |
| `src/lib/excelParser.ts` | 수정 | `applyColumnMapping()` 대표필지 카테고리 설정 지원 |
| `src/lib/excelExporter.ts` | 수정 | `createSelectedSheet()`에 '구분' 컬럼 추가 |

### 3.2 신규 파일

없음 (기존 파일 수정으로 구현 가능)

---

## 4. 구현 계획

### 4.1 Layer 1 - 타입 레이어 (`src/types/index.ts`)

#### 변경 내용

**Parcel 인터페이스에 카테고리 필드 추가:**

```typescript
export interface Parcel {
  // ... 기존 필드 ...
  parcelCategory: 'public-payment' | 'representative';  // 신규 추가
}
```

`string literal union` 방식을 사용하여 향후 카테고리 확장에 대비한다. `boolean` 플래그 대신 명시적 카테고리를 사용하여 가독성과 확장성을 높인다.

**FileConfig.role 타입 확장:**

```typescript
export interface FileConfig {
  // ...
  role: 'sampled' | 'master' | 'representative';  // 'representative' 추가
  // ...
}
```

**Statistics 인터페이스 업데이트:**

```typescript
export interface Statistics {
  totalParcels: number;
  sampled2024: number;
  sampled2025: number;
  eligibleParcels: number;
  uniqueRis: number;
  canMeetTarget: boolean;
  representativeParcels: number;  // 신규 추가
}
```

---

### 4.2 Layer 2 - 파일 업로드 레이어 (`src/pages/UploadPage.tsx`)

#### 변경 내용

업로드 페이지에 기존 3개 필수 슬롯(master-2026, sampled-2024, sampled-2025) 외에 **대표필지 파일 슬롯**을 선택 사항으로 추가한다.

**슬롯 구성:**

```
[필수] master-2026       → role: 'master',        year: 2026
[필수] sampled-2024      → role: 'sampled',       year: 2024
[필수] sampled-2025      → role: 'sampled',       year: 2025
[선택] 대표필지 파일     → role: 'representative', year: 2026 (또는 무관)
```

**UI 디자인:**
- 기존 필수 파일 3개 슬롯 아래에 구분선 또는 섹션 헤더를 두어 시각적 분리
- 슬롯 레이블: "대표필지 파일 (선택사항)"
- 슬롯 설명: "3개년 전 데이터에서 지정된 대표필지. 마스터 파일 매칭 없이 그대로 포함됩니다."
- 선택 배지(초록색): "선택"으로 표시하여 필수가 아님을 명시
- 파일 등록 후에도 다음 단계로 이동 가능 (이미 필수 3파일 완료 기준)

**파일 등록 시 FileConfig 생성:**

```typescript
{
  id: 'representative',
  filename: file.name,
  year: 2026,  // 또는 별도 연도 선택 UI
  role: 'representative',
  columnMapping: {} as ColumnMapping,  // 초기 빈 매핑
  rowCount: parsedData.rows.length,
  status: 'pending',
  rawData: parsedData.rows,
  headers: parsedData.headers,
}
```

---

### 4.3 Layer 3 - 스토어 레이어 (`src/store/parcelStore.ts`)

#### 변경 내용

`parcelStore`에 대표필지 전용 상태와 액션을 추가한다.

```typescript
interface ParcelStore {
  // ... 기존 상태 ...
  representativeParcels: Parcel[];  // 신규 추가

  // ... 기존 액션 ...
  setRepresentativeParcels: (parcels: Parcel[]) => void;  // 신규 추가
}
```

**`calculateStatistics()` 업데이트:**

```typescript
calculateStatistics: () => {
  const { allParcels, representativeParcels } = get();
  // ... 기존 계산 ...
  set({
    statistics: {
      // ... 기존 필드 ...
      representativeParcels: representativeParcels.length,  // 신규
    },
  });
},
```

**`reset()` 업데이트:**

```typescript
reset: () => set({
  allParcels: [],
  sampled2024: [],
  sampled2025: [],
  representativeParcels: [],  // 신규
  duplicateResult: null,
  statistics: null,
}),
```

---

### 4.4 Layer 4 - 컬럼 매핑 레이어 (`src/pages/MappingPage.tsx`)

#### 변경 내용

매핑 페이지에서 `role === 'representative'` 파일을 인식하여 매핑 UI를 표시한다.

**핵심 차이점:**
- 공익직불제 파일과 동일한 `ColumnMapping` 인터페이스를 재사용
- 단, `farmerAddress`, `sido`, `sigungu`, `eubmyeondong` 등 일부 필드는 선택 사항으로 표시
- 매핑 완료 후 `status: 'mapped'`로 업데이트

**매핑 설명 텍스트 변경:**
- 공익직불제: "기존 안내 문구"
- 대표필지: "마스터 파일과 매칭하지 않습니다. 필지주소, 농가번호, 필지번호 등 기본 필드를 매핑하세요."

---

### 4.5 Layer 5 - 분석/병합 레이어 (`src/pages/AnalyzePage.tsx`)

#### 변경 내용

`runAnalysis()` 함수에서 대표필지 파일을 별도 파싱하여 `parcelStore`에 저장한다.

**파이프라인 변경:**

```
기존: masterFile → applyColumnMapping → markEligibility → allParcels
신규: masterFile → applyColumnMapping → markEligibility → allParcels (공익직불제)
      representativeFile → applyColumnMapping → setRepresentativeParcels (대표필지)
```

**`applyColumnMapping()` 호출 시 카테고리 주입:**

```typescript
// 공익직불제 (기존)
const masterParcels = applyColumnMapping(
  masterFile.rawData,
  masterFile.columnMapping,
  masterFile.filename,
  undefined,
  'public-payment'  // 카테고리 인자 추가
);

// 대표필지 (신규)
const repParcels = representativeFile?.rawData
  ? applyColumnMapping(
      representativeFile.rawData,
      representativeFile.columnMapping,
      representativeFile.filename,
      undefined,
      'representative'  // 카테고리 인자
    ).map(p => ({
      ...p,
      isEligible: true,    // 추출 대상으로 마킹
      isSelected: true,    // 사전 선택 상태
    }))
  : [];

parcelStore.setRepresentativeParcels(repParcels);
```

**대표필지의 Geocoding 처리:**

- 대표필지도 `isEligible === true`이므로 기존 `eligibleParcels` 배열에 포함시켜 동일하게 좌표 변환 수행
- 또는 별도 Geocoding 단계를 추가 (구현 편의에 따라 결정)
- 권장: 기존 `eligibleParcels`에 대표필지를 합쳐 한 번에 Geocoding

**통계 표시 업데이트:**

- 분석 결과 통계 카드에 "대표필지 N개" 항목 추가 표시
- "총 목표 700 = 공익직불제 (700 - N)개 + 대표필지 N개" 형태로 안내

---

### 4.6 Layer 6 - 추출 레이어 (`src/store/extractionStore.ts`, `src/pages/ExtractPage.tsx`)

#### 변경 내용

**추출 목표 자동 차감:**

추출 알고리즘 실행 전에 대표필지 수를 `totalTarget`에서 차감한 `effectiveTarget`을 계산한다.

```typescript
// extractionStore 또는 ExtractPage 내부
const representativeCount = parcelStore.representativeParcels.length;
const effectiveTarget = config.totalTarget - representativeCount;
// effectiveTarget을 실제 공익직불제 추출 알고리즘에 전달
```

**추출 결과에 대표필지 병합:**

추출 알고리즘 완료 후, 결과 `selectedParcels`에 대표필지를 추가한다.

```typescript
const publicPaymentResult = runExtraction(eligibleParcels, {
  ...config,
  totalTarget: effectiveTarget,  // 차감된 목표
});

const finalSelectedParcels = [
  ...representativeParcels,           // 대표필지 먼저
  ...publicPaymentResult.selectedParcels,  // 공익직불제 추출 결과
];

set({ result: { ...publicPaymentResult, selectedParcels: finalSelectedParcels } });
```

**ExtractPage UI 업데이트:**

- 추출 설정 패널에 대표필지 정보 표시:
  ```
  대표필지: 50개 (고정)
  공익직불제 추출 목표: 650개 (= 700 - 50)
  총 목표: 700개
  ```
- 대표필지가 0개일 때는 기존 UI와 동일하게 표시

---

### 4.7 Layer 7 - 검토 레이어 (Review)

#### 4.7.1 결과 테이블 (`src/components/Review/ResultTable.tsx`)

**카테고리 배지 컬럼 추가:**

- 테이블 첫 번째 또는 두 번째 컬럼에 "구분" 컬럼 추가
- 공익직불제: 파란색 배지 `공익직불제`
- 대표필지: 초록색 배지 `대표필지`

```tsx
// 배지 컴포넌트 예시
const CategoryBadge = ({ category }: { category: 'public-payment' | 'representative' }) => (
  category === 'representative'
    ? <span className="px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700 rounded-full">대표필지</span>
    : <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">공익직불제</span>
);
```

- 대표필지 행은 체크박스 선택/해제 불가 (또는 시각적으로 고정됨을 표시)
- 대표필지 행은 "제거" 버튼 비활성화 또는 별도 안내 툴팁 표시

#### 4.7.2 지도 마커 색상 (`src/components/Map/KakaoMap.tsx`)

**`getMarkerColor()` 함수 업데이트:**

```typescript
function getMarkerColor(parcel: Parcel, isSelected: boolean): string {
  // 대표필지: 카테고리 확인 후 초록색
  if (parcel.parcelCategory === 'representative' && isSelected) {
    return '#059669';  // emerald-600 (대표필지 선택)
  }
  // 기존 공익직불제 로직
  if (isSelected) return '#2563eb';           // blue-600 (공익직불제 선택)
  if (parcel.sampledYears.includes(2024)) return '#dc2626';   // red-600
  if (parcel.sampledYears.includes(2025)) return '#ea580c';   // orange-600
  if (parcel.isEligible) return '#6b7280';    // gray-500
  return '#9ca3af';                           // gray-400
}
```

**마커 팝업(`createPopupContent()`) 업데이트:**

```typescript
function createPopupContent(parcel: Parcel, isSelected: boolean): string {
  const categoryLabel = parcel.parcelCategory === 'representative' ? '대표필지' : '공익직불제';
  const categoryColor = parcel.parcelCategory === 'representative' ? '#059669' : '#2563eb';

  return `<div style="min-width:200px; font-family:sans-serif;">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
      <strong>${parcel.farmerName}</strong>
      <span style="font-size:11px;padding:2px 6px;border-radius:999px;
        background:${parcel.parcelCategory === 'representative' ? '#d1fae5' : '#dbeafe'};
        color:${categoryColor};font-weight:600;">${categoryLabel}</span>
    </div>
    <hr style="margin:6px 0; border-color:#eee;">
    <table style="font-size:12px;">
      <!-- 기존 행들 -->
    </table>
  </div>`;
}
```

#### 4.7.3 지도 범례 (`src/components/Map/MapLegend.tsx`)

**props 업데이트:**

```typescript
interface MapLegendProps {
  counts: {
    selected: number;           // 공익직불제 선택
    representative: number;     // 대표필지 (신규)
    unselected: number;
    sampled2024: number;
    sampled2025: number;
    noCoords: number;
  };
  horizontal?: boolean;
}
```

**범례 항목 추가:**

```typescript
const items: LegendItem[] = [
  { color: '#059669', label: '대표필지 (고정)', count: counts.representative },  // 신규 (첫 번째)
  { color: '#2563eb', label: '공익직불제 추출 선택', count: counts.selected },   // 기존 (두 번째)
  { color: '#6b7280', label: '추출 후보 미선택', count: counts.unselected },
  { color: '#dc2626', label: '2024 채취 제외', count: counts.sampled2024 },
  { color: '#ea580c', label: '2025 채취 제외', count: counts.sampled2025 },
  { color: '#fbbf24', label: '좌표 미변환', count: counts.noCoords, borderColor: '#d97706' },
];
```

#### 4.7.4 마커 클릭 상세 패널 (`src/pages/ReviewPage.tsx`)

상세 패널에 카테고리 항목 추가:

```tsx
<div className="flex justify-between">
  <span className="text-gray-500">구분</span>
  <span className={`font-semibold text-xs px-2 py-0.5 rounded-full ${
    selectedMarkerParcel.parcelCategory === 'representative'
      ? 'bg-emerald-100 text-emerald-700'
      : 'bg-blue-100 text-blue-700'
  }`}>
    {selectedMarkerParcel.parcelCategory === 'representative' ? '대표필지' : '공익직불제'}
  </span>
</div>
```

---

### 4.8 Layer 8 - 내보내기 레이어 (`src/lib/excelExporter.ts`)

#### 변경 내용

**`createSelectedSheet()` 함수에 '구분' 컬럼 추가:**

```typescript
function createSelectedSheet(parcels: Parcel[]): XLSX.WorkSheet {
  const headers = [
    '구분',              // 신규 추가 (A 컬럼)
    '경영체번호',        // 기존 A → B
    '경영체명',          // ...
    // ... 나머지 기존 컬럼 순서 유지
    '위도',
    '경도',
  ];

  const dataRows = parcels.map(p => [
    p.parcelCategory === 'representative' ? '대표필지' : '공익직불제',  // 신규 A
    p.farmerId,          // B
    p.farmerName,        // C
    // ... 기존 데이터 그대로
  ]);
  // ...
}
```

**열 너비 추가:**

```typescript
ws['!cols'] = [
  { wch: 8 },     // A: 구분 (신규)
  { wch: 11.66 }, // B: 경영체번호
  // ... 기존 나머지
];
```

**파일명 유지:** `2026공익직불제(필지선정)_{date}.xlsx` (변경 없음)

**`createAllParcelsSheet()` 업데이트:**

전체 필지 시트에도 '구분' 컬럼 추가:

```typescript
const rows = parcels.map(p => ({
  '구분': p.parcelCategory === 'representative' ? '대표필지' : '공익직불제',  // 신규
  '경영체번호': p.farmerId,
  // ... 기존
}));
```

**ExportData 인터페이스 업데이트:**

```typescript
interface ExportData {
  selectedParcels: Parcel[];   // 공익직불제 + 대표필지 통합
  excludedParcels: Parcel[];
  allParcels: Parcel[];        // 공익직불제 전체
  representativeParcels: Parcel[];  // 신규: 대표필지 (참조용)
  riStats: RiStat[];
  farmerStats: FarmerStat[];
}
```

---

## 5. 마커 색상 체계

| 상태 | 색상 코드 | 색상명 | 설명 |
|------|-----------|--------|------|
| 대표필지 (선택) | `#059669` | emerald-600 | 대표필지 - 사전 고정 선택 |
| 공익직불제 (선택) | `#2563eb` | blue-600 | 공익직불제 - 2026 추출 선택 |
| 추출 후보 미선택 | `#6b7280` | gray-500 | 추출 가능하나 미선택 |
| 2024 채취 제외 | `#dc2626` | red-600 | 2024년 채취로 제외 |
| 2025 채취 제외 | `#ea580c` | orange-600 | 2025년 채취로 제외 |
| 좌표 미변환 | `#fbbf24` | amber-400 | Geocoding 실패 |

---

## 6. 데이터 흐름

### 6.1 기존 흐름

```
UploadPage          MappingPage        AnalyzePage              ExtractPage            ReviewPage
[master-2026]  →  [columnMapping] → applyColumnMapping   →  runExtraction(700)  → selectedParcels(700)
[sampled-2024]     [columnMapping]    markEligibility
[sampled-2025]     [columnMapping]    parcelStore.allParcels
```

### 6.2 신규 흐름 (대표필지 추가 후)

```
UploadPage               MappingPage         AnalyzePage                          ExtractPage
[master-2026]       →  [columnMapping]  →  applyColumnMapping(category='public-payment')
[sampled-2024]         [columnMapping]     markEligibility
[sampled-2025]         [columnMapping]     parcelStore.allParcels (공익직불제, isEligible 마킹)
[대표필지 파일] (선)  →  [columnMapping]  →  applyColumnMapping(category='representative')
                                             → {isEligible:true, isSelected:true}
                                             parcelStore.representativeParcels

                                             effectiveTarget = 700 - representativeParcels.length
                                             ↓
                                          runExtraction(eligibleParcels, effectiveTarget)
                                             ↓
                                          finalSelected = [...representativeParcels, ...extractionResult]
                                             ↓
ReviewPage: 테이블(카테고리 배지) + 지도(색상 분리) + 범례(6항목) + 상세패널(카테고리)
ExportPage: selectedSheet에 '구분' 컬럼 포함하여 내보내기
```

---

## 7. 제약사항 및 고려사항

### 7.1 대표필지 파일 구조

- 대표필지 엑셀 파일의 컬럼 구조는 사전에 정해진 포맷이 없을 수 있음
- 따라서 컬럼 매핑 UI를 통해 유연하게 매핑하도록 설계
- 최소 필수 매핑 필드: `farmerId` (경영체번호), `parcelId` (필지번호), `address` (필지주소)

### 7.2 마스터 파일 매칭 제외

- 대표필지는 `markEligibility()` 함수를 거치지 않음
- 단, 2024/2025 채취 이력과의 중복 체크도 수행하지 않음 (업무 요구사항 기준)
- 만약 중복 체크가 필요하다면 별도 요구사항으로 확인 필요

### 7.3 totalTarget 유효성 검사

- `representativeParcels.length > totalTarget` 인 경우 경고 표시
- `effectiveTarget`이 0 이하인 경우 공익직불제 추출 단계를 건너뜀

### 7.4 대표필지 수동 조정 제한

- 검토 페이지(ReviewPage)에서 대표필지는 `isSelected` 토글을 비활성화하거나 제한할 것을 권장
- 단, 실수로 잘못된 파일을 올린 경우를 위해 "대표필지 제거" 기능을 고려할 수 있음 (2차 개발 검토)

### 7.5 Geocoding 처리

- 대표필지의 Geocoding은 공익직불제와 동일한 로직(PNU 코드 기반)으로 처리
- 대표필지를 `eligibleParcels` 배열에 합산하여 단일 Geocoding 요청 수행 권장
- Geocoding 불가 필지의 경우 `coords: null`로 처리 (기존과 동일)

### 7.6 통계 대시보드

- 분석 페이지 `StatsDashboard` 컴포넌트에 대표필지 수 카드 추가 필요
- `Statistics` 인터페이스에 `representativeParcels` 필드 추가 후 반영

### 7.7 기존 데이터 하위 호환성

- `parcelCategory`가 없는 기존 `Parcel` 객체를 처리하기 위해 `parcelCategory ?? 'public-payment'`로 기본값 처리 권장
- 또는 `applyColumnMapping()` 함수에서 항상 카테고리를 주입하여 undefined 상황 방지

---

## 8. 구현 순서 (권장)

1. `src/types/index.ts` - 타입 변경 (모든 후속 작업의 기반)
2. `src/lib/excelParser.ts` - `applyColumnMapping()` 카테고리 파라미터 추가
3. `src/store/parcelStore.ts` - `representativeParcels` 상태 추가
4. `src/store/extractionStore.ts` - `effectiveTarget` 계산 및 결과 병합 로직
5. `src/pages/UploadPage.tsx` - 대표필지 파일 슬롯 UI 추가
6. `src/pages/MappingPage.tsx` - 대표필지 파일 매핑 지원
7. `src/pages/AnalyzePage.tsx` - 대표필지 파싱 및 저장 로직
8. `src/pages/ExtractPage.tsx` - 유효 목표 표시 UI
9. `src/components/Map/KakaoMap.tsx` - 마커 색상 및 팝업 업데이트
10. `src/components/Map/MapLegend.tsx` - 범례 항목 추가
11. `src/components/Review/ResultTable.tsx` - 카테고리 배지 컬럼
12. `src/pages/ReviewPage.tsx` - 상세 패널 카테고리, 범례 counts 업데이트
13. `src/lib/excelExporter.ts` - '구분' 컬럼 추가
14. `src/pages/ExportPage.tsx` - 내보내기 데이터에 대표필지 포함

---

*본 계획서는 구현 시작 전 검토 및 확정이 필요합니다.*
