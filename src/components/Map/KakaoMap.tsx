import { useEffect, useRef } from 'react';
import type { Parcel } from '../../types';
import { useKakaoMap } from '../../hooks/useKakaoMap';
import { createInfoWindowContent } from './MarkerInfoWindow';

interface KakaoMapProps {
  parcels: Parcel[];
  selectedParcels: Parcel[];
  onMarkerClick?: (parcel: Parcel) => void;
  filterRi?: string;
  showDistanceCircle?: boolean;
  className?: string;
}

function createMarkerImage(color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="35" viewBox="0 0 24 35">
    <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 23 12 23s12-14 12-23C24 5.4 18.6 0 12 0z" fill="${color}"/>
    <circle cx="12" cy="12" r="5" fill="white"/>
  </svg>`;
  const kakao = (window as any).kakao;
  return new kakao.maps.MarkerImage(
    'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg),
    new kakao.maps.Size(24, 35)
  );
}

function getMarkerColor(parcel: Parcel, isSelected: boolean): string {
  if (isSelected) return '#2563eb'; // 파랑 - 선택됨
  if (parcel.sampledYears.includes(2024)) return '#dc2626'; // 빨강 - 2024 채취
  if (parcel.sampledYears.includes(2025)) return '#ea580c'; // 주황 - 2025 채취
  if (parcel.isEligible) return '#6b7280'; // 회색 - 미선택 후보
  return '#9ca3af'; // 연회색 - 기타
}

export function KakaoMap({
  parcels,
  selectedParcels,
  onMarkerClick,
  filterRi,
  showDistanceCircle = false,
  className = '',
}: KakaoMapProps) {
  const { mapRef, map, isLoaded, error } = useKakaoMap({ level: 10 });

  const markersRef = useRef<any[]>([]);
  const infoWindowRef = useRef<any | null>(null);
  const circleRef = useRef<any | null>(null);

  const selectedKeys = new Set(selectedParcels.map((p) => `${p.farmerId}__${p.parcelId}`));

  // 마커 정리 함수
  function clearMarkers() {
    for (const marker of markersRef.current) {
      marker.setMap(null);
    }
    markersRef.current = [];
  }

  // 인포윈도우 정리 함수
  function closeInfoWindow() {
    if (infoWindowRef.current) {
      infoWindowRef.current.close();
    }
  }

  // 반경 원 정리
  function clearCircle() {
    if (circleRef.current) {
      circleRef.current.setMap(null);
      circleRef.current = null;
    }
  }

  useEffect(() => {
    if (!isLoaded || !map) return;

    const kakao = (window as any).kakao;

    clearMarkers();
    closeInfoWindow();
    clearCircle();

    // filterRi 적용
    const displayParcels = filterRi
      ? parcels.filter((p) => p.ri === filterRi)
      : parcels;

    // 좌표 있는 필지만 마커 생성
    const parcelsWithCoords = displayParcels.filter((p) => p.coords);

    const bounds = new kakao.maps.LatLngBounds();
    let hasAnyCoords = false;

    for (const parcel of parcelsWithCoords) {
      if (!parcel.coords) continue;

      const isSelected = selectedKeys.has(`${parcel.farmerId}__${parcel.parcelId}`);
      const color = getMarkerColor(parcel, isSelected);
      const position = new kakao.maps.LatLng(parcel.coords.lat, parcel.coords.lng);

      const marker = new kakao.maps.Marker({
        position,
        map,
        title: parcel.farmerName,
        image: createMarkerImage(color),
      });

      const infoWindow = new kakao.maps.InfoWindow({
        content: createInfoWindowContent(parcel),
        removable: true,
      });

      kakao.maps.event.addListener(marker, 'click', () => {
        closeInfoWindow();
        clearCircle();

        infoWindow.open(map, marker);
        infoWindowRef.current = infoWindow;

        if (showDistanceCircle) {
          const circle = new kakao.maps.Circle({
            center: position,
            radius: 1000, // 1km
            strokeWeight: 2,
            strokeColor: '#2563eb',
            strokeOpacity: 0.6,
            strokeStyle: 'dashed',
            fillColor: '#2563eb',
            fillOpacity: 0.05,
          });
          circle.setMap(map);
          circleRef.current = circle;
        }

        onMarkerClick?.(parcel);
      });

      markersRef.current.push(marker);
      bounds.extend(position);
      hasAnyCoords = true;
    }

    // 좌표 있는 필지가 있으면 bounds 자동 조정
    if (hasAnyCoords) {
      map.setBounds(bounds);
    }

    return () => {
      clearMarkers();
      closeInfoWindow();
      clearCircle();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, map, parcels, selectedParcels, filterRi, showDistanceCircle]);

  if (error) {
    return (
      <div className={`flex items-center justify-center bg-gray-50 rounded-lg border border-gray-200 ${className}`}>
        <div className="text-center p-8">
          <div className="text-red-400 text-4xl mb-3">!</div>
          <p className="text-red-600 font-medium mb-1">카카오맵 로드 실패</p>
          <p className="text-gray-500 text-sm">{error}</p>
          <p className="text-gray-400 text-xs mt-2">.env 파일에 VITE_KAKAO_JS_KEY를 설정하세요.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      <div
        ref={mapRef}
        className="w-full h-full rounded-lg"
        style={{ minHeight: '500px' }}
      />
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-50 rounded-lg">
          <div className="text-center">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-gray-500 text-sm">지도를 불러오는 중...</p>
          </div>
        </div>
      )}
    </div>
  );
}
