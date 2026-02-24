import { useState, useMemo } from 'react';
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
  const { allParcels, getRiList } = useParcelStore();
  const { result, toggleParcelSelection, addParcel, removeParcel } = useExtractionStore();
  const [activeTab, setActiveTab] = useState<TabId>('table');
  const [filterRi, setFilterRi] = useState<string>('');
  const [selectedMarkerParcel, setSelectedMarkerParcel] = useState<Parcel | null>(null);
  const [showDistanceCircle, setShowDistanceCircle] = useState(false);

  // result가 없으면 extract로 리다이렉트
  if (!result) {
    navigate('/extract');
    return null;
  }

  const { selectedParcels, validation } = result;

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

  const riList = useMemo(() => getRiList(), [getRiList]);

  const mapLegendCounts = useMemo(() => {
    const selectedKeys = new Set(selectedParcels.map((p) => `${p.farmerId}__${p.parcelId}`));
    let selected = 0;
    let unselected = 0;
    let sampled2024 = 0;
    let sampled2025 = 0;
    let noCoords = 0;

    for (const p of allParcels) {
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

    return { selected, unselected, sampled2024, sampled2025, noCoords };
  }, [allParcels, selectedParcels]);

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
        <span className="text-sm text-gray-600 mb-2">
          선택:{' '}
          <span className="font-semibold text-blue-600">{selectedParcels.length}</span>
          <span className="text-gray-400"> / 700</span>
        </span>
      </div>

      {/* 검증 패널 */}
      <ValidationPanel
        validation={validation}
        selectedCount={selectedParcels.length}
        targetCount={700}
      />

      {/* 탭 콘텐츠 */}
      {activeTab === 'table' ? (
        <ResultTable
          parcels={tableParcels}
          selectedParcels={selectedParcels}
          onToggleSelection={toggleParcelSelection}
          onAddParcel={addParcel}
          onRemoveParcel={removeParcel}
        />
      ) : (
        <div className="flex gap-4" style={{ minHeight: '600px' }}>
          {/* 좌측: 지도 (2/3) */}
          <div className="flex-1" style={{ flexBasis: '66.67%' }}>
            <KakaoMap
              parcels={allParcels}
              selectedParcels={selectedParcels}
              onMarkerClick={(parcel) => setSelectedMarkerParcel(parcel)}
              filterRi={filterRi || undefined}
              showDistanceCircle={showDistanceCircle}
              className="h-full"
            />
          </div>

          {/* 우측: 필터 + 상세 + 범례 (1/3) */}
          <div className="flex flex-col gap-4" style={{ flexBasis: '33.33%', minWidth: '260px' }}>
            {/* 리 필터 */}
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">리 필터</label>
              <select
                value={filterRi}
                onChange={(e) => setFilterRi(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">전체 리 표시</option>
                {riList.map((ri) => (
                  <option key={ri} value={ri}>
                    {ri}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 mt-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showDistanceCircle}
                  onChange={(e) => setShowDistanceCircle(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm text-gray-600">클릭 시 1km 반경 표시</span>
              </label>
            </div>

            {/* 선택된 마커 상세 */}
            {selectedMarkerParcel ? (
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-gray-700">선택 필지 상세</h4>
                  <button
                    onClick={() => setSelectedMarkerParcel(null)}
                    className="text-gray-400 hover:text-gray-600 text-xs"
                  >
                    닫기
                  </button>
                </div>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">농업인</span>
                    <span className="font-medium">{selectedMarkerParcel.farmerName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">필지번호</span>
                    <span className="font-mono text-xs">{selectedMarkerParcel.parcelId}</span>
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
                    <span
                      className={`font-semibold ${
                        selectedMarkerParcel.isSelected ? 'text-blue-600' : 'text-gray-400'
                      }`}
                    >
                      {selectedMarkerParcel.isSelected ? '추출 선택' : '미선택'}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-gray-50 rounded-lg border border-dashed border-gray-200 p-4 text-center">
                <p className="text-gray-400 text-xs">마커를 클릭하면 상세 정보가 표시됩니다</p>
              </div>
            )}

            {/* 범례 */}
            <MapLegend counts={mapLegendCounts} />
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
