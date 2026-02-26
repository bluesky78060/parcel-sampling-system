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
    () => new Set(selectedParcels.map((p) => parcelKey(p))),
    [selectedParcels],
  );

  // 1. Initialize Leaflet map with VWORLD tile layers + ResizeObserver
  const mapRef = useMapInit(containerRef);

  // 2. Marker layer (must come before polygon layer so markerByKeyRef is available)
  const { outOfRangeCount, markerCounts, markerByKeyRef } = useMarkerLayer({
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
      {/* 미선택 필지 토글 */}
      <div className="absolute top-2 right-14 z-[1000] bg-white border border-gray-300 rounded-md px-3 py-1.5 text-xs shadow-sm">
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showUnselected}
            onChange={(e) => setShowUnselected(e.target.checked)}
            className="rounded"
          />
          <span className="text-gray-700">미선택 필지 표시</span>
        </label>
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
            좌표 없는 필지 {noCoordsCount.toLocaleString()}건 (데이터 분석에서 좌표 변환 실행 필요)
          </div>
        )}
      </div>
      {markerCounts.total === 0 && parcels.length > 0 && (
        <div className="absolute inset-0 flex items-center justify-center z-[999] pointer-events-none">
          <div className="bg-white/90 backdrop-blur border border-gray-300 rounded-lg px-6 py-4 text-center shadow-lg pointer-events-auto">
            <p className="text-sm font-semibold text-gray-700 mb-1">표시할 마커가 없습니다</p>
            <p className="text-xs text-gray-500">
              {noCoordsCount > 0
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
