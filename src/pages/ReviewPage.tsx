import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useParcelStore } from '../store/parcelStore';
import { useExtractionStore } from '../store/extractionStore';
import { ResultTable } from '../components/Review/ResultTable';
import { ValidationPanel } from '../components/Review/ValidationPanel';
import { KakaoMap } from '../components/Map/KakaoMap';
import { MapLegend } from '../components/Map/MapLegend';
import type { Parcel } from '../types';

type TabId = 'table' | 'map';

export function ReviewPage() {
  const navigate = useNavigate();
  const { allParcels, representativeParcels, getRiList } = useParcelStore();
  const { result, toggleParcelSelection, addParcel, removeParcel, config: extractionConfig } = useExtractionStore();
  const [activeTab, setActiveTab] = useState<TabId>('table');
  const [filterRi, setFilterRi] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'public-payment' | 'representative'>('all');
  const [selectedMarkerParcel, setSelectedMarkerParcel] = useState<Parcel | null>(null);
  const [showDistanceCircle, setShowDistanceCircle] = useState(false);
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [isMapFullscreen, setIsMapFullscreen] = useState(false);
  const [showPolygons, setShowPolygons] = useState(true);

  // ESC키로 전체화면 종료
  useEffect(() => {
    if (!isMapFullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMapFullscreen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isMapFullscreen]);

  // result가 없으면 extract로 리다이렉트
  useEffect(() => {
    if (!result) navigate('/extract');
  }, [result, navigate]);

  if (!result) return null;

  const { selectedParcels, validation } = result;

  // allParcels + representativeParcels 합쳐서 지도에 전달 (중복 제거)
  const allParcelsWithRep = useMemo(() => {
    if (representativeParcels.length === 0) return allParcels;
    const existingKeys = new Set(allParcels.map((p) => `${p.farmerId}__${p.parcelId}`));
    const newReps = representativeParcels.filter((p) => !existingKeys.has(`${p.farmerId}__${p.parcelId}`));
    return [...allParcels, ...newReps];
  }, [allParcels, representativeParcels]);

  // allParcels 중 선택된 것 + 아직 미선택 후보 모두 표시
  // isEligible이지만 미선택된 것도 포함
  const tableParcels = useMemo(() => {
    if (allParcels.length === 0) return selectedParcels;

    // 선택된 필지 + 미선택 eligible 필지
    const eligible = allParcels.filter((p) => p.isEligible);
    // 중복 없이 병합: 선택된 것을 앞으로
    const selectedKeys = new Set(selectedParcels.map((p) => `${p.farmerId}__${p.parcelId}`));
    const unselected = eligible.filter((p) => !selectedKeys.has(`${p.farmerId}__${p.parcelId}`));
    return [...selectedParcels, ...unselected];
  }, [allParcels, selectedParcels]);

  // 추출 선택만 표시: 합쳐진 배열에서 좌표 포함된 데이터로 필터링
  const mapSelectedParcels = useMemo(() => {
    const keys = new Set(selectedParcels.map((p) => `${p.farmerId}__${p.parcelId}`));
    return allParcelsWithRep.filter((p) => keys.has(`${p.farmerId}__${p.parcelId}`));
  }, [allParcelsWithRep, selectedParcels]);

  const riList = useMemo(() => getRiList(), [getRiList]);

  const mapLegendCounts = useMemo(() => {
    const selectedKeys = new Set(selectedParcels.map((p) => `${p.farmerId}__${p.parcelId}`));
    const repKeys = new Set(representativeParcels.map((p) => `${p.farmerId}__${p.parcelId}`));
    let selected = 0;
    let representative = 0;
    let unselected = 0;
    let sampled2024 = 0;
    let sampled2025 = 0;
    let noCoords = 0;

    // 대표필지 수 (좌표 있는 것만)
    for (const p of representativeParcels) {
      if (p.coords) representative++;
      else noCoords++;
    }

    for (const p of allParcels) {
      if (repKeys.has(`${p.farmerId}__${p.parcelId}`)) continue; // 대표필지는 위에서 처리
      if (!p.coords) {
        noCoords++;
      } else if (selectedKeys.has(`${p.farmerId}__${p.parcelId}`)) {
        selected++;
      } else if (p.sampledYears.includes(2024)) {
        sampled2024++;
      } else if (p.sampledYears.includes(2025)) {
        sampled2025++;
      } else if (p.isEligible) {
        unselected++;
      }
    }

    return { selected, representative, unselected, sampled2024, sampled2025, noCoords };
  }, [allParcels, selectedParcels, representativeParcels]);

  const tabs: { id: TabId; label: string }[] = [
    { id: 'table', label: '테이블 뷰' },
    { id: 'map', label: '지도 뷰' },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* 페이지 헤더 */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">결과 검토</h2>
        <p className="text-gray-500 mt-1">추출 결과를 검토하고 수동으로 조정하세요.</p>
      </div>

      {/* 탭 헤더 */}
      <div className="flex items-center justify-between border-b border-gray-200">
        <div className="flex gap-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
              {tab.id === 'table' && (
                <span className="ml-1.5 text-xs text-blue-500 font-semibold">★</span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-sm text-gray-600 mb-2">
          <span>
            선택:{' '}
            <span className="font-semibold text-blue-600">{selectedParcels.length}</span>
            <span className="text-gray-400"> / {extractionConfig.totalTarget}</span>
          </span>
          <div className="h-4 w-px bg-gray-200" />
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            공익 <span className="font-semibold">{selectedParcels.filter(p => (p.parcelCategory ?? 'public-payment') === 'public-payment').length}</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            대표 <span className="font-semibold">{representativeParcels.length}</span>
          </span>
        </div>
      </div>

      {/* 검증 패널 */}
      <ValidationPanel
        validation={validation}
        selectedCount={selectedParcels.length}
        targetCount={extractionConfig.totalTarget}
      />

      {/* 탭 콘텐츠 */}
      {activeTab === 'table' ? (
        <ResultTable
          parcels={tableParcels}
          selectedParcels={selectedParcels}
          onToggleSelection={toggleParcelSelection}
          onAddParcel={addParcel}
          onRemoveParcel={removeParcel}
          targetCount={extractionConfig.totalTarget}
        />
      ) : (
        <div className={
          isMapFullscreen
            ? 'fixed inset-0 z-[9999] bg-white flex flex-col'
            : 'flex flex-col gap-3'
        }>
          {/* 상단: 필터 바 */}
          <div className={`flex items-center gap-4 bg-white border border-gray-200 px-4 py-2.5 ${isMapFullscreen ? 'border-b shrink-0' : 'rounded-lg'}`}>
            <label className="text-sm font-medium text-gray-700 flex-shrink-0">리 필터</label>
            <select
              value={filterRi}
              onChange={(e) => setFilterRi(e.target.value)}
              className="text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[160px]"
            >
              <option value="">전체 리 표시</option>
              {riList.map((ri) => (
                <option key={ri} value={ri}>
                  {ri}
                </option>
              ))}
            </select>
            <div className="h-5 w-px bg-gray-200" />
            <div className="flex items-center gap-1">
              <span className="text-sm font-medium text-gray-700 mr-1">구분</span>
              {([
                { value: 'all', label: '전체', color: 'gray' },
                { value: 'public-payment', label: '공익직불', color: 'blue' },
                { value: 'representative', label: '대표필지', color: 'emerald' },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setCategoryFilter(opt.value)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-full transition-colors ${
                    categoryFilter === opt.value
                      ? opt.color === 'blue'
                        ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-300'
                        : opt.color === 'emerald'
                        ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300'
                        : 'bg-gray-200 text-gray-700 ring-1 ring-gray-300'
                      : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="h-5 w-px bg-gray-200" />
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={showSelectedOnly}
                onChange={(e) => setShowSelectedOnly(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm text-gray-600">추출 선택만</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={showDistanceCircle}
                onChange={(e) => setShowDistanceCircle(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm text-gray-600">1km 반경</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={showPolygons}
                onChange={(e) => setShowPolygons(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm text-gray-600">필지 영역</span>
            </label>
            <div className="ml-auto flex-shrink-0">
              <button
                onClick={() => setIsMapFullscreen(!isMapFullscreen)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
              >
                {isMapFullscreen ? (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5M15 15l5.25 5.25" />
                    </svg>
                    축소 (ESC)
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                    </svg>
                    전체화면
                  </>
                )}
              </button>
            </div>
          </div>

          {/* 중앙: 지도 */}
          <div
            className={`relative ${isMapFullscreen ? 'flex-1' : ''}`}
            style={isMapFullscreen ? undefined : { height: 'calc(100vh - 340px)', minHeight: '500px' }}
          >
            <KakaoMap
              parcels={showSelectedOnly ? mapSelectedParcels : allParcelsWithRep}
              selectedParcels={selectedParcels}
              onMarkerClick={(parcel) => setSelectedMarkerParcel(parcel)}
              filterRi={filterRi || undefined}
              categoryFilter={categoryFilter}
              showDistanceCircle={showDistanceCircle}
              showPolygons={showPolygons}
              className="h-full"
            />

            {/* 마커 클릭 시 상세 패널 (지도 위 오버레이) */}
            {selectedMarkerParcel && (
              <div className="absolute top-3 right-3 z-[1000] w-64 bg-white/95 backdrop-blur rounded-lg border border-gray-200 shadow-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold text-gray-700">선택 필지 상세</h4>
                  <button
                    onClick={() => setSelectedMarkerParcel(null)}
                    className="text-gray-400 hover:text-gray-600 text-xs leading-none"
                  >
                    ✕
                  </button>
                </div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500">구분</span>
                    {(selectedMarkerParcel.parcelCategory ?? 'public-payment') === 'representative' ? (
                      <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-emerald-100 text-emerald-700">대표필지</span>
                    ) : (
                      <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-blue-100 text-blue-700">공익직불제</span>
                    )}
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">농업인</span>
                    <span className="font-medium">{selectedMarkerParcel.farmerName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">필지번호</span>
                    <span className="font-mono">{selectedMarkerParcel.parcelId}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">주소</span>
                    <p className="mt-0.5 break-all">{selectedMarkerParcel.address}</p>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">리</span>
                    <span>{selectedMarkerParcel.ri}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">면적</span>
                    <span>
                      {selectedMarkerParcel.area
                        ? selectedMarkerParcel.area.toLocaleString() + ' m²'
                        : '-'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">채취이력</span>
                    <span>
                      {selectedMarkerParcel.sampledYears.length
                        ? selectedMarkerParcel.sampledYears.join(', ') + '년'
                        : '없음'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">2026 선택</span>
                    {(selectedMarkerParcel.parcelCategory ?? 'public-payment') === 'representative' ? (
                      <span className="font-semibold text-emerald-600">고정 선택</span>
                    ) : (
                      <span
                        className={`font-semibold ${
                          selectedParcels.some((p) => p.farmerId === selectedMarkerParcel.farmerId && p.parcelId === selectedMarkerParcel.parcelId)
                            ? 'text-blue-600'
                            : 'text-gray-400'
                        }`}
                      >
                        {selectedParcels.some((p) => p.farmerId === selectedMarkerParcel.farmerId && p.parcelId === selectedMarkerParcel.parcelId)
                          ? '추출 선택'
                          : '미선택'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 하단: 범례 (가로 배치) */}
          <div className={isMapFullscreen ? 'shrink-0' : ''}>
            <MapLegend counts={mapLegendCounts} horizontal />
          </div>
        </div>
      )}

      {/* 하단 네비게이션 */}
      <div className="flex items-center justify-between pt-4 border-t border-gray-200">
        <button
          onClick={() => navigate('/extract')}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          이전: 추출 설정
        </button>
        <button
          onClick={() => navigate('/export')}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
        >
          다음: 다운로드
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
