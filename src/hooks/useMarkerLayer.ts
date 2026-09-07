import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import type { Parcel } from '../types';
import { isRepresentative, isPublicPayment } from '../lib/parcelCategory';
import { useSurveyStore } from '../store/surveyStore';
import {
  isInBonghwa,
  getMarkerColor,
  createCircleIcon,
  createStarIcon,
  createPopupContent,
  parcelKey,
} from '../components/Map/mapUtils';

export interface MarkerCounts {
  selected: number;
  representative: number;
  /**
   * 미선택 필지 수. `showUnselected`가 꺼져 있으면 이들은 **마커로 만들어지지 않는다** —
   * 숫자는 "지도에 올릴 수 있는 미선택 필지가 이만큼 있다"는 뜻이다.
   */
  unselected: number;
  /** 실제로 지도에 올린 마커 수. 숨겨진 미선택 필지는 포함하지 않는다. */
  total: number;
}

interface UseMarkerLayerParams {
  mapRef: React.RefObject<L.Map | null>;
  parcels: Parcel[];
  selectedKeys: Set<string>;
  filterRi?: string;
  categoryFilter?: 'all' | 'public-payment' | 'representative';
  showDistanceCircle: boolean;
  showUnselected: boolean;
  onMarkerClick?: (parcel: Parcel) => void;
  polygonCentroidCacheRef: React.RefObject<Map<string, L.LatLngTuple>>;
}

interface UseMarkerLayerReturn {
  outOfRangeCount: number;
  markerCounts: MarkerCounts;
  markerByKeyRef: React.RefObject<Map<string, L.Marker>>;
}

/** Create a Leaflet marker for a parcel with click handling */
function createParcelMarker(
  parcel: Parcel,
  latlng: L.LatLngTuple,
  color: string,
  isRep: boolean,
  isSelected: boolean,
  map: L.Map,
  circleRef: React.MutableRefObject<L.Circle | null>,
  showDistanceCircleRef: React.MutableRefObject<boolean>,
  onMarkerClickRef: React.MutableRefObject<((parcel: Parcel) => void) | undefined>,
): L.Marker {
  const icon = isRep ? createStarIcon(color) : createCircleIcon(color);
  const marker = L.marker(latlng, {
    icon,
    zIndexOffset: isSelected ? 1000 : (isRep ? 500 : 0),
  });
  // 팝업 내용을 **열 때** 만든다. 미리 만들면 열지도 않을 HTML이 마커마다 힙에
  // 남는다 — 4만 건 기준 실측 38MB다. Leaflet은 bindPopup에 함수를 받으므로
  // 지연 생성이 그대로 지원된다.
  marker.bindPopup(() => createPopupContent(parcel, isSelected));

  marker.on('click', () => {
    map.flyTo(latlng, 17, { duration: 0.8 });

    if (circleRef.current) {
      circleRef.current.remove();
      circleRef.current = null;
    }

    if (showDistanceCircleRef.current) {
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

    onMarkerClickRef.current?.(parcel);
  });

  return marker;
}

/** Toggle unselected marker layer visibility */
function toggleUnselectedLayer(map: L.Map, layer: L.LayerGroup, show: boolean): void {
  if (show) {
    if (!map.hasLayer(layer)) layer.addTo(map);
  } else {
    if (map.hasLayer(layer)) map.removeLayer(layer);
  }
}

/** Fit map bounds to selected markers (or all markers if none selected) */
function fitMapBounds(
  map: L.Map,
  bounds: L.LatLngTuple[],
  parcelsWithCoords: Parcel[],
  selectedKeys: Set<string>,
): void {
  if (bounds.length === 0) return;

  const selectedBounds: L.LatLngTuple[] = [];
  for (const parcel of parcelsWithCoords) {
    if (!parcel.coords || !isInBonghwa(parcel.coords.lat, parcel.coords.lng)) continue;
    if (selectedKeys.has(parcelKey(parcel))) {
      selectedBounds.push([parcel.coords.lat, parcel.coords.lng]);
    }
  }
  map.fitBounds(selectedBounds.length > 0 ? selectedBounds : bounds, { padding: [30, 30] });
}

/**
 * Manages selected and unselected marker layers on the Leaflet map.
 * Creates markers for parcels, handles click → flyTo + distance circle,
 * applies polygon centroid corrections, and toggles unselected visibility.
 */
export function useMarkerLayer({
  mapRef,
  parcels,
  selectedKeys,
  filterRi,
  categoryFilter,
  showDistanceCircle,
  showUnselected,
  onMarkerClick,
  polygonCentroidCacheRef,
}: UseMarkerLayerParams): UseMarkerLayerReturn {
  const selectedMarkersRef = useRef<L.LayerGroup>(L.layerGroup());
  const unselectedMarkersRef = useRef<L.LayerGroup>(L.layerGroup());
  const markerByKeyRef = useRef<Map<string, L.Marker>>(new Map());
  const circleRef = useRef<L.Circle | null>(null);

  const [outOfRangeCount, setOutOfRangeCount] = useState(0);
  const [markerCounts, setMarkerCounts] = useState<MarkerCounts>({
    selected: 0,
    representative: 0,
    unselected: 0,
    total: 0,
  });

  // Stable ref for callback to avoid triggering effect re-runs
  const onMarkerClickRef = useRef(onMarkerClick);
  onMarkerClickRef.current = onMarkerClick;

  // Stable ref for showDistanceCircle used inside click handler
  const showDistanceCircleRef = useRef(showDistanceCircle);
  showDistanceCircleRef.current = showDistanceCircle;

  // 마커 색은 기채취 연도(N-1 빨강, N-2 주황)에 달렸고, `getMarkerColor`가 그것을
  // 스토어에서 직접 읽는다. 구독하지 않으면 조사 연도를 바꿔도 마커가 옛 색으로 남는다.
  // 팝업은 열 때 읽으므로 새 연도를 쓰는데, 그러면 색과 팝업이 엇갈린다.
  const surveyYear = useSurveyStore((st) => st.surveyYear);

  // Add marker layers to map once
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    selectedMarkersRef.current.addTo(map);
    unselectedMarkersRef.current.addTo(map);
    return () => {
      selectedMarkersRef.current.remove();
      unselectedMarkersRef.current.remove();
    };
  }, [mapRef]);

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

    const displayParcels = parcels.filter((p) => {
      if (filterRi && p.ri !== filterRi) return false;
      if (categoryFilter && categoryFilter !== 'all') {
        // 'both'(공익 추출에도 뽑힌 대표필지)는 어느 필터에서도 빠지면 안 된다
        return categoryFilter === 'representative' ? isRepresentative(p) : isPublicPayment(p);
      }
      return true;
    });

    const parcelsWithCoords = displayParcels.filter((p) => p.coords);
    console.info(
      `[마커] 전체 ${parcels.length}건 → 필터 후 ${displayParcels.length}건 → 좌표 있음 ${parcelsWithCoords.length}건`
    );
    const bounds: L.LatLngTuple[] = [];
    let outCount = 0;
    let countSelected = 0;
    let countRep = 0;
    let countUnselected = 0;

    for (const parcel of parcelsWithCoords) {
      if (!parcel.coords) continue;

      const { lat, lng } = parcel.coords;

      if (!isInBonghwa(lat, lng)) {
        outCount++;
        continue;
      }

      const isSelected = selectedKeys.has(parcelKey(parcel));
      const isRep = isRepresentative(parcel);

      // 미선택 마커는 `showUnselected`가 켜져 있을 때만 만든다.
      //
      // 예전에는 무조건 만들어 `unselectedMarkersRef`에 넣고, 그 레이어를 지도에서
      // 떼는 방식이었다. 그런데 레이어가 이미 지도에 붙어 있어서 addLayer 시점에
      // Leaflet이 실제 DOM을 만들었고, 곧바로 통째로 버렸다. 즉 체크박스를 꺼 두어도
      // 비용은 전액 지불하고 화면에는 안 나왔다.
      //
      // 카운트는 마커 없이도 세야 하므로 여기서 세고 넘어간다.
      if (!isRep && !isSelected && !showUnselected) {
        countUnselected++;
        continue;
      }

      const color = getMarkerColor(parcel, isSelected);
      const latlng: L.LatLngTuple = [lat, lng];

      const marker = createParcelMarker(parcel, latlng, color, isRep, isSelected, map, circleRef, showDistanceCircleRef, onMarkerClickRef);

      const key = parcelKey(parcel);
      markerByKeyRef.current.set(key, marker);

      // 폴리곤 centroid 캐시가 있으면 정확한 위치로 보정
      const cachedCentroid = polygonCentroidCacheRef.current?.get(key);
      if (cachedCentroid) {
        marker.setLatLng(cachedCentroid);
      }

      if (isRep) {
        countRep++;
        selectedMarkersRef.current.addLayer(marker);
      } else if (isSelected) {
        countSelected++;
        selectedMarkersRef.current.addLayer(marker);
      } else {
        countUnselected++;
        unselectedMarkersRef.current.addLayer(marker);
      }
      bounds.push(cachedCentroid ?? latlng);
    }

    setOutOfRangeCount(outCount);
    setMarkerCounts({
      selected: countSelected,
      representative: countRep,
      unselected: countUnselected,
      // 숨긴 미선택 필지는 마커를 만들지 않았으므로 총계에서 뺀다.
      // 넣으면 배지가 "마커 40,809"라고 하는데 화면에는 700개만 있게 된다.
      total: countSelected + countRep + (showUnselected ? countUnselected : 0),
    });

    toggleUnselectedLayer(map, unselectedMarkersRef.current, showUnselected);
    fitMapBounds(map, bounds, parcelsWithCoords, selectedKeys);
  }, [parcels, selectedKeys, filterRi, categoryFilter, showUnselected, surveyYear, mapRef, polygonCentroidCacheRef]);

  return { outOfRangeCount, markerCounts, markerByKeyRef };
}
