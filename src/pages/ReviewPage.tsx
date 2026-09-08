import { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useParcelStore } from '../store/parcelStore';
import { useExtractionStore, countUniqueSelected } from '../store/extractionStore';
import { ResultTable } from '../components/Review/ResultTable';
import { ValidationPanel } from '../components/Review/ValidationPanel';
import { KakaoMap } from '../components/Map/KakaoMap';
import { MapLegend } from '../components/Map/MapLegend';
import { useGeocoding } from '../hooks/useGeocoding';
import type { Parcel } from '../types';
import { isRepresentative, isPublicPayment } from '../lib/parcelCategory';
import {
  buildMapSelectedParcels,
  buildTableParcels,
  countMapLegend,
  isParcelSelected,
  mergeWithRepresentatives,
} from '../lib/reviewSelectors';
import { useSurveyStore, sampledYearsOf } from '../store/surveyStore';

type TabId = 'table' | 'map';

const EMPTY_PARCELS: Parcel[] = [];

export function ReviewPage() {
  const surveyYear = useSurveyStore((st) => st.surveyYear);
  const navigate = useNavigate();
  const { allParcels, representativeParcels, getRiList } = useParcelStore();
  const { result, toggleParcelSelection, addParcel, removeParcel, config: extractionConfig } = useExtractionStore();
  const [activeTab, setActiveTab] = useState<TabId>('table');
  const [filterRi, setFilterRi] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'public-payment' | 'representative'>('all');
  const [selectedMarkerParcel, setSelectedMarkerParcel] = useState<Parcel | null>(null);
  const [showDistanceCircle, setShowDistanceCircle] = useState(false);
  // 지도에는 추출된 필지만 올린다. 전량(마스터 4만 건)을 올리면 마커를 그것만큼
  // 만드느라 탭 진입이 수 초 걸린다 — 정작 검토 대상은 선정된 700건이다.
  // 전체를 보려면 "추출 선택만" 체크를 끈다.
  const [showSelectedOnly, setShowSelectedOnly] = useState(true);
  const [isMapFullscreen, setIsMapFullscreen] = useState(false);
  // 필지 영역(VWorld 폴리곤)은 팬할 때마다 다시 조회·매칭하므로 기본은 끈다.
  // 줌 15 이상에서만 그려지기도 해서, 켜 두면 초기 화면에서는 비용만 들고 안 보인다.
  const [showPolygons, setShowPolygons] = useState(false);

  // 좌표 변환 (지도 탭에서 좌표 없을 때 사용)
  const geocoding = useGeocoding();
  const parcelStore = useParcelStore();

  const noCoordsCount = useMemo(
    () => allParcels.filter((p) => !p.coords).length,
    [allParcels],
  );

  const runGeocodingInReview = useCallback(async () => {
    const eligibleParcels = allParcels.filter((p) => p.isEligible);
    const allForGeocoding = [...eligibleParcels, ...representativeParcels];
    if (allForGeocoding.length === 0) return;

    const geocodedParcels = await geocoding.startGeocoding(allForGeocoding);

    const geocodedMap = new Map<string, Parcel>();
    for (const gp of geocodedParcels) {
      const key = `${gp.farmerId}_${gp.parcelId}_${gp.address}`;
      geocodedMap.set(key, gp);
    }

    const updatedParcels = allParcels.map((p) => {
      const key = `${p.farmerId}_${p.parcelId}_${p.address}`;
      const geocoded = geocodedMap.get(key);
      return geocoded ? { ...p, coords: geocoded.coords } : p;
    });
    parcelStore.updateParcels(updatedParcels);

    if (representativeParcels.length > 0) {
      const updatedRep = representativeParcels.map((p) => {
        const key = `${p.farmerId}_${p.parcelId}_${p.address}`;
        const geocoded = geocodedMap.get(key);
        return geocoded ? { ...p, coords: geocoded.coords } : p;
      });
      parcelStore.setRepresentativeParcels(updatedRep);
    }
  }, [allParcels, representativeParcels, geocoding, parcelStore]);

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

  const selectedParcels = result?.selectedParcels ?? EMPTY_PARCELS;

  // 아래 파생 계산은 `lib/reviewSelectors`에 있다. React가 필요한 것이 아니라
  // 여기서 쓰기 때문에 `useMemo` 안에 있었고, 그래서 DOM 없이는 테스트할 수 없었다.
  const allParcelsWithRep = useMemo(
    () => mergeWithRepresentatives(allParcels, representativeParcels),
    [allParcels, representativeParcels],
  );

  const tableParcels = useMemo(
    () => buildTableParcels(allParcels, selectedParcels),
    [allParcels, selectedParcels],
  );

  const mapSelectedParcels = useMemo(
    () => buildMapSelectedParcels(allParcelsWithRep, selectedParcels),
    [allParcelsWithRep, selectedParcels],
  );

  const isMarkerParcelSelected = useMemo(
    () => (selectedMarkerParcel ? isParcelSelected(selectedMarkerParcel, selectedParcels) : false),
    [selectedMarkerParcel, selectedParcels],
  );

  const riList = useMemo(() => getRiList(), [getRiList]);

  const mapLegendCounts = useMemo(
    () =>
      countMapLegend(allParcels, representativeParcels, selectedParcels, sampledYearsOf(surveyYear)),
    [allParcels, selectedParcels, representativeParcels, surveyYear],
  );

  if (!result) return null;

  const { validation } = result;
  // 화면 전체에서 '선택' 수의 기준을 하나로 (겹치는 필지를 1건으로 계산)
  const uniqueSelectedCount = countUniqueSelected(selectedParcels);

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
            <span className="font-semibold text-blue-600">{uniqueSelectedCount}</span>
            <span className="text-gray-400"> / {extractionConfig.totalTarget}</span>
          </span>
          <div className="h-4 w-px bg-gray-200" />
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            공익 <span className="font-semibold">{selectedParcels.filter(p => isPublicPayment(p)).length}</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            {/* 업로드 건수가 아니라 결과에 실린 수. 상한(representativeTarget)이 걸리면 둘이 다르다 */}
            대표 <span className="font-semibold">{selectedParcels.filter(p => isRepresentative(p)).length}</span>
          </span>
        </div>
      </div>

      {/* 검증 패널 */}
      <ValidationPanel
        validation={validation}
        selectedCount={uniqueSelectedCount}
        targetCount={extractionConfig.totalTarget}
      />

      {/* 탭 콘텐츠 */}
      {activeTab === 'table' ? (
        <ResultTable
          parcels={tableParcels}
          selectedParcels={selectedParcels}
          selectedCount={uniqueSelectedCount}
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
          {/* 좌표 변환 안내 (좌표 없을 때) */}
          {noCoordsCount > 0 && geocoding.isAvailable && !isMapFullscreen && (
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-orange-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-orange-800">
                      좌표 없는 필지 {noCoordsCount.toLocaleString()}건
                    </p>
                    <p className="text-xs text-orange-600">
                      좌표 변환을 실행해야 지도에 마커가 표시됩니다.
                    </p>
                  </div>
                </div>
                {!geocoding.state.isRunning && !geocoding.state.isComplete && !geocoding.state.serviceDown && (
                  <button
                    onClick={runGeocodingInReview}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-white text-sm font-medium rounded-lg hover:bg-orange-700 transition-colors flex-shrink-0 ml-4"
                  >
                    좌표 변환 시작
                  </button>
                )}
                {geocoding.state.isRunning && (
                  <div className="flex items-center gap-3 ml-4">
                    <div className="text-sm text-orange-700 font-medium">
                      {geocoding.state.progress.done}/{geocoding.state.progress.total}건
                    </div>
                    <button
                      onClick={geocoding.cancelGeocoding}
                      className="px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
                    >
                      취소
                    </button>
                  </div>
                )}
                {geocoding.state.isComplete && geocoding.state.summary && (
                  <span className="text-sm text-green-700 font-medium ml-4">
                    변환 완료 ({geocoding.state.summary.resolved.toLocaleString()}건 성공)
                  </span>
                )}
                {/* 서버 장애는 "완료"가 아니다. 원인과 다음 행동을 같이 보여준다. */}
                {geocoding.state.serviceDown && !geocoding.state.isRunning && (
                  <div className="ml-4 flex items-center gap-3 flex-shrink-0">
                    <span className="text-sm text-red-700 font-medium">
                      서버 응답 없음 — 중단됨
                    </span>
                    <button
                      onClick={runGeocodingInReview}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-orange-600 rounded-md hover:bg-orange-700"
                    >
                      다시 시도
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 좌표 변환 불가 안내 */}
          {noCoordsCount > 0 && !geocoding.isAvailable && !isMapFullscreen && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="text-sm font-medium text-gray-700">
                좌표 없는 필지 {noCoordsCount.toLocaleString()}건
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                이 환경에서는 좌표 변환을 사용할 수 없습니다. 지오코딩 API 키 설정이 필요합니다.
              </p>
            </div>
          )}

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
                    {isRepresentative(selectedMarkerParcel) ? (
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
                    <span className="text-gray-500">{surveyYear} 선택</span>
                    {isRepresentative(selectedMarkerParcel) ? (
                      <span className="font-semibold text-emerald-600">고정 선택</span>
                    ) : (
                      <span
                        className={`font-semibold ${
                          isMarkerParcelSelected ? 'text-blue-600' : 'text-gray-400'
                        }`}
                      >
                        {isMarkerParcelSelected ? '추출 선택' : '미선택'}
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
