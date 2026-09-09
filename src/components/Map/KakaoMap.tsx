import { useRef, useMemo, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Parcel } from '../../types';
import { useMapInit } from '../../hooks/useMapInit';
import { usePolygonLayer } from '../../hooks/usePolygonLayer';
import { useMarkerLayer } from '../../hooks/useMarkerLayer';
import { parcelKey } from './mapUtils';

interface KakaoMapProps {
  parcels: Parcel[];
  selectedParcels: Parcel[];
  onMarkerClick?: (parcel: Parcel) => void;
  filterRi?: string;
  categoryFilter?: 'all' | 'public-payment' | 'representative';
  showDistanceCircle?: boolean;
  showPolygons?: boolean;
  className?: string;
}

export function KakaoMap({
  parcels,
  selectedParcels,
  onMarkerClick,
  filterRi,
  categoryFilter,
  showDistanceCircle = false,
  showPolygons = false,
  className = '',
}: KakaoMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [showUnselected, setShowUnselected] = useState(false);
  // Shared ref for polygon centroid cache — created here and passed to both hooks
  const polygonCentroidCacheRef = useRef<Map<string, L.LatLngTuple>>(new Map());

  // Memoize selectedKeys so it only recalculates when selectedParcels changes
  const selectedKeys = useMemo(
    // 식별 불가능한 필지는 키를 만들 수 없다. 넣으면 그런 필지가 서로 "선택됨"으로
    // 오인되므로 제외한다 — 조회하는 쪽도 null이면 false로 본다.
    () =>
      new Set(
        selectedParcels.map((p) => parcelKey(p)).filter((k): k is string => k !== null),
      ),
    [selectedParcels],
  );

  // 1. Initialize Leaflet map with VWORLD tile layers + ResizeObserver
  const mapRef = useMapInit(containerRef);

  // 2. Marker layer (must come before polygon layer so markerByKeyRef is available)
  const { outOfRangeCount, markerCounts, markerByKeyRef, fitToMarkers } = useMarkerLayer({
    mapRef,
    parcels,
    selectedKeys,
    filterRi,
    categoryFilter,
    showDistanceCircle,
    showUnselected,
    onMarkerClick,
    polygonCentroidCacheRef,
  });

  // "미선택 필지 표시"가 드러낼 것이 남아 있는가.
  //
  // `markerCounts.unselected`는 **숨김 여부와 무관하게** 센다(마커를 안 만들 때도
  // 세고 넘어간다). 그래서 이 값이 0이면 체크박스를 켜도 아무 일이 없다는 뜻이다.
  //
  // 이미 켜 둔 상태에서는 잠그지 않는다 — 잠그면 사용자가 다시 끌 수 없다.
  const noUnselectedToShow = markerCounts.unselected === 0 && !showUnselected;

  // 좌표 없는 필지 수 계산
  const noCoordsCount = useMemo(
    () => parcels.filter((p) => !p.coords).length,
    [parcels],
  );

  // 3. Polygon layer (VWORLD cadastral feature API)
  const { polygonZoomWarning } = usePolygonLayer({
    mapRef,
    parcels,
    selectedKeys,
    showPolygons,
    polygonCentroidCacheRef,
    markerByKeyRef,
  });

  return (
    <div className={`relative ${className}`}>
      <div
        ref={containerRef}
        className="w-full h-full rounded-lg"
        style={{ minHeight: '500px' }}
      />
      {/* 마커 카운트 배지 */}
      <div className="absolute top-2 left-12 z-[1000] bg-white/95 backdrop-blur border border-gray-200 rounded-lg px-3 py-2 text-xs shadow-sm">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-gray-700">마커 {markerCounts.total.toLocaleString()}</span>
          <div className="h-3.5 w-px bg-gray-200" />
          {markerCounts.representative > 0 && (
            <span className="flex items-center gap-1">
              <svg className="w-2.5 h-2.5" viewBox="0 0 12 12" fill="#059669">
                <polygon points="6,0 7.5,4.2 12,4.5 8.5,7.5 9.5,12 6,9.5 2.5,12 3.5,7.5 0,4.5 4.5,4.2" />
              </svg>
              <span className="text-emerald-700 font-medium">{markerCounts.representative}</span>
            </span>
          )}
          {markerCounts.selected > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              <span className="text-blue-700 font-medium">{markerCounts.selected}</span>
            </span>
          )}
          {markerCounts.unselected > 0 && showUnselected && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-gray-400" />
              <span className="text-gray-500 font-medium">{markerCounts.unselected.toLocaleString()}</span>
            </span>
          )}
        </div>
      </div>
      {/* 전체 보기 + 미선택 필지 토글 */}
      <div className="absolute top-2 right-14 z-[1000] flex items-center gap-2">
        {/* 화면은 필터를 바꿀 때만 자동으로 맞춰진다(사용자가 옮겨 둔 위치를 지키기 위해).
            그래서 되돌릴 수단이 필요하다 — 이 버튼이 그 역할이다. */}
        <button
          type="button"
          onClick={fitToMarkers}
          disabled={markerCounts.total === 0}
          title="지도에 있는 마커가 모두 보이도록 화면을 맞춥니다 (표시 대상은 바뀌지 않습니다)"
          className="bg-white border border-gray-300 rounded-md px-3 py-1.5 text-xs shadow-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          화면 맞춤
        </button>
        {/* 드러낼 미선택 필지가 없으면 눌러도 아무 일이 없다 — 그때는 잠근다.
            ReviewPage의 "추출 선택만"이 켜져 있으면 넘어오는 데이터에 미선택이
            아예 없어서, 서로 다른 두 곳의 두 컨트롤이 겹쳐 보였다.

            원인을 `showSelectedOnly`로 받지 않고 **데이터에서** 판정한다. 리 필터나
            분류 필터로 미선택이 0이 되는 경우도 같은 상황이고, 그때도 맞다.

            이미 켜 둔 상태에서는 잠그지 않는다 — 잠그면 되돌릴 수 없다. */}
        <div className="bg-white border border-gray-300 rounded-md px-3 py-1.5 text-xs shadow-sm">
          <label
            className={`flex items-center gap-1.5 select-none ${
              noUnselectedToShow ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
            }`}
            title={
              noUnselectedToShow
                ? '표시할 미선택 필지가 없습니다. 결과 검토 상단의 "추출 선택만"을 끄거나 필터를 넓히세요.'
                : undefined
            }
          >
            <input
              type="checkbox"
              checked={showUnselected}
              disabled={noUnselectedToShow}
              onChange={(e) => setShowUnselected(e.target.checked)}
              className="rounded"
            />
            <span className="text-gray-700">미선택 필지 표시</span>
          </label>
        </div>
      </div>
      {/* 경고 배지 (top-12 위치에 세로 배치) */}
      <div className="absolute top-12 left-12 z-[1000] flex flex-col gap-1">
        {outOfRangeCount > 0 && (
          <div className="bg-amber-50 border border-amber-300 rounded-md px-3 py-1.5 text-xs text-amber-700 shadow-sm">
            봉화군 범위 밖 좌표 {outOfRangeCount.toLocaleString()}건 제외됨
          </div>
        )}
        {noCoordsCount > 0 && (
          <div className="bg-orange-50 border border-orange-300 rounded-md px-3 py-1.5 text-xs text-orange-700 shadow-sm">
            {/* 이 숫자는 **지도에 올린 집합** 기준이다. 페이지 상단 배너는 전체 필지
                기준이라 값이 다르다 — 기준을 밝히지 않으면 두 숫자가 모순으로 보인다. */}
            지도 대상 중 좌표 없음 {noCoordsCount.toLocaleString()}건 (데이터 분석에서 좌표 변환 실행 필요)
          </div>
        )}
      </div>
      {markerCounts.total === 0 && parcels.length > 0 && (
        <div className="absolute inset-0 flex items-center justify-center z-[999] pointer-events-none">
          <div className="bg-white/90 backdrop-blur border border-gray-300 rounded-lg px-6 py-4 text-center shadow-lg pointer-events-auto">
            <p className="text-sm font-semibold text-gray-700 mb-1">표시할 마커가 없습니다</p>
            <p className="text-xs text-gray-500">
              {/* 미선택이 숨겨진 것이 원인일 때 엉뚱한 안내를 하지 않는다 —
                  좌표를 다시 변환하라고 하면 사용자가 4만 건을 또 돌린다 */}
              {markerCounts.unselected > 0 && !showUnselected
                ? `미선택 필지 ${markerCounts.unselected.toLocaleString()}건이 숨겨져 있습니다. 위의 "미선택 필지 표시"를 켜세요.`
                : noCoordsCount > 0
                  ? '데이터 분석 페이지에서 "좌표 변환" 버튼을 클릭하여 좌표를 생성하세요.'
                  : '필지 좌표가 봉화군 범위 밖이거나 필터 조건에 맞는 필지가 없습니다.'}
            </p>
          </div>
        </div>
      )}
      {polygonZoomWarning && showPolygons && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[1000] bg-blue-50 border border-blue-300 rounded-md px-3 py-1.5 text-xs text-blue-700 shadow-sm">
          필지 영역을 보려면 줌 레벨 15 이상으로 확대하세요
        </div>
      )}
    </div>
  );
}
