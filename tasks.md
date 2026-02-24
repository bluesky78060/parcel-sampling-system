# 농업환경변동조사 필지 추출 시스템 - 구현 작업 목록

## 현재 완료된 작업

- [x] Phase 1: 프로젝트 초기화 (Vite + React + TS + Tailwind + 라우팅)
- [x] Phase 2: 핵심 라이브러리 (excelParser, addressParser, duplicateDetector, extractionAlgorithm, excelExporter)
- [x] Phase 3: 파일 업로드 페이지 (SCR-001) - 드래그&드롭, 시트 선택, 파일 카드
- [x] Phase 4: 컬럼 매핑 페이지 (SCR-002) - 자동 매칭, 리 파싱, 미리보기
- [x] 공통 컴포넌트: AppLayout, Stepper, StatsDashboard, RiDistributionChart, PreviewTable
- [x] 상태관리: fileStore, parcelStore, extractionStore (Zustand)
- [x] 타입 정의: Parcel, FileConfig, ExtractionConfig, ExtractionResult 등

---

## 남은 구현 작업

### Task 1: Geocoding + 공간 유틸리티 라이브러리
> Geocoding이 추출 알고리즘의 선행 조건이므로 먼저 구현

- [x] `src/lib/kakaoGeocoder.ts` - 주소→좌표 변환 + 캐시 (sessionStorage)
- [x] `src/lib/batchGeocoder.ts` - 배치 변환 (동시 5건, 100ms 간격, 진행률 콜백)
- [x] `src/lib/spatialUtils.ts` - Haversine 거리, 중심점, 밀집도, 먼 리 감지, 클러스터링
- [x] `src/hooks/useGeocoding.ts` - 배치 Geocoding 상태 관리 훅
- [x] `src/types/index.ts` 수정 - SpatialConfig 타입 추가

### Task 2: 거리 기반 추출 알고리즘 확장
> 기존 extractionAlgorithm에 공간 필터링 로직 추가

- [x] `src/lib/extractionAlgorithm.ts` 수정 - 밀집도 기반 가중 추출, 1km 거리 제한, 먼 리 자동 제외
- [x] `src/store/extractionStore.ts` 수정 - SpatialConfig 기본값 추가
- [x] 검증 규칙 추가: 1km 초과 필지 쌍 경고

### Task 3: AnalyzePage (SCR-003) - 데이터 분석 + Geocoding
> fileStore → applyColumnMapping → markEligibility → Geocoding → parcelStore

- [x] `src/pages/AnalyzePage.tsx` 재작성
- [x] `src/components/Analysis/GeocodingProgress.tsx` 신규 - 변환 진행률 바
- [x] 기존 StatsDashboard, RiDistributionChart 연결
- [x] 먼 거리 리 자동 감지 경고 표시
- [x] 이전/다음 단계 네비게이션

### Task 4: ExtractPage (SCR-004) - 추출 설정
> 추출 파라미터 + 공간 필터 설정 + 실행

- [x] `src/pages/ExtractPage.tsx` 재작성
- [x] `src/components/Extraction/ExtractionSettings.tsx` 신규 - 기본 파라미터 폼
- [x] `src/components/Extraction/SpatialSettings.tsx` 신규 - 공간 필터 설정 UI
- [x] `src/components/Extraction/RiTargetTable.tsx` 신규 - 리별 목표 테이블
- [x] 추출 실행 → 결과 요약 카드 표시

### Task 5: ReviewPage (SCR-005) - 결과 검토
> TanStack Table + 검증 패널 + 탭(테이블/지도)

- [x] `src/pages/ReviewPage.tsx` 재작성
- [x] `src/components/Review/ResultTable.tsx` 신규 - TanStack Table 가상화
- [x] `src/components/Review/ValidationPanel.tsx` 신규 - 에러/경고 표시
- [x] 행 선택/해제, 정렬, 필터, 검색
- [x] 거리 관련 검증 경고

### Task 6: ExportPage (SCR-006) - 결과 다운로드
> 요약 + 엑셀 내보내기

- [x] `src/pages/ExportPage.tsx` 재작성
- [x] 추출 결과 요약 카드, 검증 상태, 공간 필터 요약
- [x] 다중 시트 엑셀 다운로드 버튼
- [x] 초기화 버튼

### Task 7: 카카오맵 지도 시각화 (SCR-005M)
> 카카오맵 SDK + 마커 + 인포윈도우 + 1km 반경

- [x] `index.html` 수정 - 카카오맵 SDK 스크립트
- [x] `.env.example` 신규 - 환경변수 템플릿
- [x] `src/hooks/useKakaoMap.ts` 신규 - 지도 초기화 훅
- [x] `src/components/Map/KakaoMap.tsx` 신규 - 지도 컨테이너
- [x] `src/components/Map/ParcelMarker.tsx` 신규 - 색상별 마커
- [x] `src/components/Map/MarkerInfoWindow.tsx` 신규 - 클릭 인포윈도우
- [x] `src/components/Map/MapLegend.tsx` 신규 - 범례
- [x] `src/components/Map/DistanceCircle.tsx` 신규 - 1km 반경 원
- [x] `src/components/Map/GeocodingProgress.tsx` 신규 - 진행률 바
- [x] ReviewPage에 [지도 뷰] 탭 연결

### Task 8: 빌드 검증 및 최종 마무리

- [x] `tsc --noEmit` 타입 검증 통과
- [x] `npm run build` 빌드 성공
- [x] Stepper 진행 상태 검증 (데이터 없으면 다음 단계 차단)
- [x] Geocoding 없이도 기본 추출 동작 (폴백)
- [x] 에러 바운더리 추가
