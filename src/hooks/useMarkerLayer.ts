import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import type { Parcel } from '../types';
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
  unselected: number;
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
  marker.bindPopup(createPopupContent(parcel, isSelected));

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
        return (p.parcelCategory ?? 'public-payment') === categoryFilter;
      }
      return true;
    });

    const parcelsWithCoords = displayParcels.filter((p) => p.coords);
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
      const color = getMarkerColor(parcel, isSelected);
      const latlng: L.LatLngTuple = [lat, lng];
      const isRep = (parcel.parcelCategory ?? 'public-payment') === 'representative';

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
      total: countSelected + countRep + countUnselected,
    });

    toggleUnselectedLayer(map, unselectedMarkersRef.current, showUnselected);
    fitMapBounds(map, bounds, parcelsWithCoords, selectedKeys);
  }, [parcels, selectedKeys, filterRi, categoryFilter, showUnselected, mapRef, polygonCentroidCacheRef]);

  return { outOfRangeCount, markerCounts, markerByKeyRef };
}
