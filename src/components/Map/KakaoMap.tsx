import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Parcel } from '../../types';
import { computePolygonCentroid } from '../../lib/kakaoGeocoder';

interface KakaoMapProps {
  parcels: Parcel[];
  selectedParcels: Parcel[];
  onMarkerClick?: (parcel: Parcel) => void;
  filterRi?: string;
  showDistanceCircle?: boolean;
  showPolygons?: boolean;
  className?: string;
}

// 봉화군 대략적 좌표 범위 (여유 포함)
const BONGHWA_BOUNDS = {
  latMin: 36.75,
  latMax: 37.15,
  lngMin: 128.55,
  lngMax: 129.25,
};

function isInBonghwa(lat: number, lng: number): boolean {
  return (
    lat >= BONGHWA_BOUNDS.latMin &&
    lat <= BONGHWA_BOUNDS.latMax &&
    lng >= BONGHWA_BOUNDS.lngMin &&
    lng <= BONGHWA_BOUNDS.lngMax
  );
}

function getMarkerColor(parcel: Parcel, isSelected: boolean): string {
  if (isSelected) return '#2563eb';
  if (parcel.sampledYears.includes(2024)) return '#dc2626';
  if (parcel.sampledYears.includes(2025)) return '#ea580c';
  if (parcel.isEligible) return '#6b7280';
  return '#9ca3af';
}

function createCircleIcon(color: string) {
  return L.divIcon({
    className: '',
    html: `<svg width="24" height="35" viewBox="0 0 24 35" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 23 12 23s12-14 12-23C24 5.4 18.6 0 12 0z" fill="${color}"/>
      <circle cx="12" cy="12" r="5" fill="white"/>
    </svg>`,
    iconSize: [24, 35],
    iconAnchor: [12, 35],
    popupAnchor: [0, -35],
  });
}

function createPopupContent(parcel: Parcel, isSelected: boolean): string {
  return `<div style="min-width:200px; font-family:sans-serif;">
    <strong>${parcel.farmerName}</strong>
    <hr style="margin:6px 0; border-color:#eee;">
    <table style="font-size:12px;">
      <tr><td style="color:#888;padding:2px 8px 2px 0">필지번호</td><td><b>${parcel.parcelId}</b></td></tr>
      <tr><td style="color:#888;padding:2px 8px 2px 0">주소</td><td>${parcel.address}</td></tr>
      <tr><td style="color:#888;padding:2px 8px 2px 0">리</td><td>${parcel.ri}</td></tr>
      <tr><td style="color:#888;padding:2px 8px 2px 0">면적</td><td>${parcel.area ? parcel.area.toLocaleString() + ' m²' : '-'}</td></tr>
      <tr><td style="color:#888;padding:2px 8px 2px 0">채취이력</td><td>${parcel.sampledYears.length ? parcel.sampledYears.join(', ') + '년' : '없음'}</td></tr>
      <tr><td style="color:#888;padding:2px 8px 2px 0">2026 선택</td>
        <td><b style="color:${isSelected ? '#2563eb' : '#999'}">${isSelected ? '추출 선택' : '미선택'}</b></td></tr>
    </table>
  </div>`;
}

// Ray casting 알고리즘으로 점이 폴리곤 안에 있는지 확인
function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// VWORLD Data API URL (폴리곤 가져오기용)
const isDev = import.meta.env.DEV;
const VWORLD_DATA_URL = isDev
  ? '/api/vworld/req/data'
  : 'https://api.vworld.kr/req/data';

export function KakaoMap({
  parcels,
  selectedParcels,
  onMarkerClick,
  filterRi,
  showDistanceCircle = false,
  showPolygons = false,
  className = '',
}: KakaoMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const selectedMarkersRef = useRef<L.LayerGroup>(L.layerGroup());
  const unselectedMarkersRef = useRef<L.LayerGroup>(L.layerGroup());
  const markerByKeyRef = useRef<Map<string, L.Marker>>(new Map());
  const polygonLayerRef = useRef<L.GeoJSON | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const fetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 폴리곤 매칭 결과 캐시: parcelKey → 폴리곤 centroid
  const polygonCentroidCacheRef = useRef<Map<string, L.LatLngTuple>>(new Map());
  const [outOfRangeCount, setOutOfRangeCount] = useState(0);
  const [polygonZoomWarning, setPolygonZoomWarning] = useState(false);
  const [showUnselected, setShowUnselected] = useState(false);

  const selectedKeys = new Set(selectedParcels.map((p) => `${p.farmerId}__${p.parcelId}`));

  // 지도 초기화 - 봉화군 중심
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [36.89, 128.88], // 봉화군 중심
      zoom: 11,
    });

    const vworldKey = import.meta.env.VITE_VWORLD_KEY;

    if (vworldKey) {
      // VWORLD 기본지도 타일 레이어
      const baseLayer = L.tileLayer(
        `https://api.vworld.kr/req/wmts/1.0.0/${vworldKey}/Base/{z}/{y}/{x}.png`,
        {
          attribution: '&copy; VWORLD 국토교통부',
          maxZoom: 22,
        }
      );

      // VWORLD 위성지도 타일 레이어
      const satelliteLayer = L.tileLayer(
        `https://api.vworld.kr/req/wmts/1.0.0/${vworldKey}/Satellite/{z}/{y}/{x}.jpeg`,
        {
          attribution: '&copy; VWORLD 국토교통부',
          maxZoom: 22,
        }
      );

      // VWORLD 항공사진 타일 레이어
      const photoLayer = L.tileLayer(
        `https://api.vworld.kr/req/wmts/1.0.0/${vworldKey}/Photo/{z}/{y}/{x}.jpeg`,
        {
          attribution: '&copy; VWORLD 국토교통부',
          maxZoom: 22,
        }
      );

      // VWORLD 하이브리드 (항공사진 + 라벨) 타일 레이어
      const hybridLayer = L.tileLayer(
        `https://api.vworld.kr/req/wmts/1.0.0/${vworldKey}/Hybrid/{z}/{y}/{x}.png`,
        {
          attribution: '&copy; VWORLD 국토교통부',
          maxZoom: 22,
        }
      );

      // 연속지적도 WMS 오버레이
      const cadastralLayer = L.tileLayer.wms(
        `https://api.vworld.kr/req/wms?key=${vworldKey}`,
        {
          layers: 'lp_pa_cbnd_bonbun,lp_pa_cbnd_bubun',
          styles: 'lp_pa_cbnd_bonbun,lp_pa_cbnd_bubun',
          format: 'image/png',
          transparent: true,
          version: '1.3.0',
          attribution: '&copy; VWORLD 국토교통부',
          maxZoom: 22,
        } as L.WMSOptions
      );

      // 위성지도를 초기 레이어로 추가
      satelliteLayer.addTo(map);

      // 하이브리드 오버레이 기본 활성화 (항공사진 위에 라벨 표시)
      hybridLayer.addTo(map);

      // 연속지적도 기본 활성화
      cadastralLayer.addTo(map);

      // 레이어 컨트롤 추가
      const baseLayers: Record<string, L.TileLayer> = {
        '위성지도': satelliteLayer,
        '항공사진': photoLayer,
        '기본지도': baseLayer,
      };

      const overlays: Record<string, L.Layer> = {
        '하이브리드 (라벨)': hybridLayer,
        '연속지적도': cadastralLayer,
      };

      L.control.layers(baseLayers, overlays).addTo(map);
    } else {
      // VWORLD 키 없을 때 OpenStreetMap fallback
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);
    }

    selectedMarkersRef.current.addTo(map);
    unselectedMarkersRef.current.addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 컨테이너 리사이즈 감지 → 지도 크기 재계산 (전체화면 토글 대응)
  useEffect(() => {
    const container = containerRef.current;
    const map = mapRef.current;
    if (!container || !map) return;

    const observer = new ResizeObserver(() => {
      map.invalidateSize();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // 필지 폴리곤 레이어 (VWORLD 연속지적도 피처 API)
  useEffect(() => {
    const map = mapRef.current;
    const vworldKey = import.meta.env.VITE_VWORLD_KEY;
    if (!map || !vworldKey) return;

    // 정리
    if (polygonLayerRef.current) {
      polygonLayerRef.current.remove();
      polygonLayerRef.current = null;
    }
    setPolygonZoomWarning(false);

    if (!showPolygons) return;

    // PNU 기반 조회용 맵 구축
    const pnuLookup = new Map<string, { parcel: Parcel; isSelected: boolean }>();
    // PNU 없지만 좌표 있는 필지 (폴리곤 포함 여부로 매칭)
    const coordParcels: { parcel: Parcel; isSelected: boolean; lat: number; lng: number }[] = [];

    for (const p of parcels) {
      if (p.pnu) {
        pnuLookup.set(p.pnu, {
          parcel: p,
          isSelected: selectedKeys.has(`${p.farmerId}__${p.parcelId}`),
        });
      } else if (p.coords) {
        coordParcels.push({
          parcel: p,
          isSelected: selectedKeys.has(`${p.farmerId}__${p.parcelId}`),
          lat: p.coords.lat,
          lng: p.coords.lng,
        });
      }
    }

    async function fetchAndDraw() {
      if (!map) return;

      if (map.getZoom() < 15) {
        setPolygonZoomWarning(true);
        if (polygonLayerRef.current) {
          polygonLayerRef.current.remove();
          polygonLayerRef.current = null;
        }
        return;
      }
      setPolygonZoomWarning(false);

      const bounds = map.getBounds();
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      const geomFilter = `BOX(${sw.lng},${sw.lat},${ne.lng},${ne.lat})`;

      // 본번/부번 두 레이어 모두 조회하여 병합
      const layers = ['LP_PA_CBND_BUBUN', 'LP_PA_CBND_BONBUN'];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allFeatures: any[] = [];
      const seenPnu = new Set<string>();

      try {
        const results = await Promise.all(
          layers.map(async (layer) => {
            const params = new URLSearchParams({
              service: 'data',
              request: 'GetFeature',
              data: layer,
              key: vworldKey!,
              format: 'json',
              geometry: 'true',
              crs: 'EPSG:4326',
              geomFilter,
              size: '1000',
            });
            try {
              const res = await fetch(`${VWORLD_DATA_URL}?${params}`);
              if (!res.ok) return [];
              const data = await res.json();
              return data.response?.result?.featureCollection?.features ?? [];
            } catch {
              return [];
            }
          })
        );

        for (const features of results) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const f of features as any[]) {
            const pnu = f.properties?.pnu;
            if (pnu && !seenPnu.has(pnu)) {
              seenPnu.add(pnu);
              allFeatures.push(f);
            }
          }
        }

        if (allFeatures.length === 0) return;

        // 기존 레이어 제거
        if (polygonLayerRef.current) {
          polygonLayerRef.current.remove();
        }

        const features = allFeatures;

        // 우리 필지와 매칭되는 것만 필터 + 색칠
        // PNU 매칭 우선, PNU 없는 필지는 좌표가 폴리곤 안에 포함되는지 확인
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const matchedFeatures = features.filter((f: any) => {
          const pnu = f.properties?.pnu;
          if (pnuLookup.has(pnu)) return true;

          // 좌표 기반 매칭: PNU 없는 필지의 좌표가 이 피처 안에 있는지 확인
          if (coordParcels.length > 0 && f.geometry?.coordinates) {
            const ring = f.geometry.type === 'MultiPolygon'
              ? f.geometry.coordinates[0][0]
              : f.geometry.coordinates[0];
            if (!ring) return false;

            for (let i = coordParcels.length - 1; i >= 0; i--) {
              const cp = coordParcels[i];
              if (pointInPolygon([cp.lng, cp.lat], ring)) {
                // 매칭된 필지를 pnuLookup에 추가하여 스타일링 가능하게
                pnuLookup.set(pnu, { parcel: cp.parcel, isSelected: cp.isSelected });
                coordParcels.splice(i, 1); // 매칭된 항목 제거 (중복 방지)
                return true;
              }
            }
          }

          return false;
        });

        if (matchedFeatures.length === 0) return;

        // 매칭된 폴리곤의 실제 중심점으로 마커 위치 보정 + 캐시 저장
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const feature of matchedFeatures as any[]) {
          const pnu = feature.properties?.pnu;
          const match = pnu ? pnuLookup.get(pnu) : null;
          if (!match) continue;

          const ring = feature.geometry?.type === 'MultiPolygon'
            ? feature.geometry.coordinates[0][0]
            : feature.geometry.coordinates[0];
          if (!ring || ring.length === 0) continue;

          const centroid = computePolygonCentroid(ring);
          const key = `${match.parcel.farmerId}__${match.parcel.parcelId}`;
          const latlng: L.LatLngTuple = [centroid.lat, centroid.lng];
          polygonCentroidCacheRef.current.set(key, latlng);
          const marker = markerByKeyRef.current.get(key);
          if (marker) {
            marker.setLatLng(latlng);
          }
        }

        const geojson: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features: matchedFeatures,
        };

        polygonLayerRef.current = L.geoJSON(geojson, {
          style: (feature) => {
            const pnu = feature?.properties?.pnu;
            const match = pnu ? pnuLookup.get(pnu) : null;
            if (!match) return { fillOpacity: 0, stroke: false };

            const color = getMarkerColor(match.parcel, match.isSelected);
            return {
              fillColor: color,
              fillOpacity: 0.35,
              color: color,
              weight: 2,
              opacity: 0.8,
            };
          },
        }).addTo(map);
      } catch (err) {
        console.warn('[KakaoMap] 필지 폴리곤 로딩 실패:', err);
      }
    }

    const debouncedFetch = () => {
      if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
      fetchTimeoutRef.current = setTimeout(fetchAndDraw, 500);
    };

    map.on('moveend', debouncedFetch);
    fetchAndDraw();

    return () => {
      map.off('moveend', debouncedFetch);
      if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
      if (polygonLayerRef.current) {
        polygonLayerRef.current.remove();
        polygonLayerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPolygons, parcels, selectedParcels]);

  // 마커 업데이트
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    selectedMarkersRef.current.clearLayers();
    unselectedMarkersRef.current.clearLayers();
    markerByKeyRef.current.clear();
    if (circleRef.current) {
      circleRef.current.remove();
      circleRef.current = null;
    }

    const displayParcels = filterRi
      ? parcels.filter((p) => p.ri === filterRi)
      : parcels;

    const parcelsWithCoords = displayParcels.filter((p) => p.coords);
    const bounds: L.LatLngTuple[] = [];
    let outCount = 0;

    for (const parcel of parcelsWithCoords) {
      if (!parcel.coords) continue;

      const { lat, lng } = parcel.coords;

      // 봉화군 범위 밖 좌표는 건너뛰기
      if (!isInBonghwa(lat, lng)) {
        outCount++;
        continue;
      }

      const isSelected = selectedKeys.has(`${parcel.farmerId}__${parcel.parcelId}`);
      const color = getMarkerColor(parcel, isSelected);
      const latlng: L.LatLngTuple = [lat, lng];

      const marker = L.marker(latlng, {
        icon: createCircleIcon(color),
        zIndexOffset: isSelected ? 1000 : 0,
      });
      marker.bindPopup(createPopupContent(parcel, isSelected));

      marker.on('click', () => {
        // 클릭한 마커로 확대 이동
        map.flyTo(latlng, 17, { duration: 0.8 });

        if (circleRef.current) {
          circleRef.current.remove();
          circleRef.current = null;
        }

        if (showDistanceCircle) {
          circleRef.current = L.circle(latlng, {
            radius: 1000,
            color: '#2563eb',
            weight: 2,
            opacity: 0.6,
            dashArray: '6 4',
            fillColor: '#2563eb',
            fillOpacity: 0.05,
          }).addTo(map);
        }

        onMarkerClick?.(parcel);
      });

      const parcelKey = `${parcel.farmerId}__${parcel.parcelId}`;
      markerByKeyRef.current.set(parcelKey, marker);

      // 폴리곤 centroid 캐시가 있으면 정확한 위치로 보정
      const cachedCentroid = polygonCentroidCacheRef.current.get(parcelKey);
      if (cachedCentroid) {
        marker.setLatLng(cachedCentroid);
      }

      if (isSelected) {
        selectedMarkersRef.current.addLayer(marker);
      } else {
        unselectedMarkersRef.current.addLayer(marker);
      }
      bounds.push(cachedCentroid ?? latlng);
    }

    setOutOfRangeCount(outCount);

    // 미선택 마커 표시 여부에 따라 레이어 토글
    if (showUnselected) {
      if (!map.hasLayer(unselectedMarkersRef.current)) {
        unselectedMarkersRef.current.addTo(map);
      }
    } else {
      if (map.hasLayer(unselectedMarkersRef.current)) {
        map.removeLayer(unselectedMarkersRef.current);
      }
    }

    if (bounds.length > 0) {
      // 선택 마커가 있으면 선택 마커 기준으로 fitBounds
      const selectedBounds: L.LatLngTuple[] = [];
      for (const parcel of parcelsWithCoords) {
        if (!parcel.coords || !isInBonghwa(parcel.coords.lat, parcel.coords.lng)) continue;
        if (selectedKeys.has(`${parcel.farmerId}__${parcel.parcelId}`)) {
          selectedBounds.push([parcel.coords.lat, parcel.coords.lng]);
        }
      }
      map.fitBounds(selectedBounds.length > 0 ? selectedBounds : bounds, { padding: [30, 30] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcels, selectedParcels, filterRi, showDistanceCircle, showUnselected]);

  return (
    <div className={`relative ${className}`}>
      <div
        ref={containerRef}
        className="w-full h-full rounded-lg"
        style={{ minHeight: '500px' }}
      />
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
      {outOfRangeCount > 0 && (
        <div className="absolute top-2 left-12 z-[1000] bg-amber-50 border border-amber-300 rounded-md px-3 py-1.5 text-xs text-amber-700 shadow-sm">
          봉화군 범위 밖 좌표 {outOfRangeCount.toLocaleString()}건 제외됨
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
