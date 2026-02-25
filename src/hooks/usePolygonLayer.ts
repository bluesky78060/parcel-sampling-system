import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import type { Parcel } from '../types';
import { computePolygonCentroid } from '../lib/kakaoGeocoder';
import {
  getMarkerColor,
  pointInPolygon,
  parcelKey,
  VWORLD_DATA_URL,
} from '../components/Map/mapUtils';

interface UsePolygonLayerParams {
  mapRef: React.RefObject<L.Map | null>;
  parcels: Parcel[];
  selectedKeys: Set<string>;
  showPolygons: boolean;
  /** Shared ref for polygon centroid cache (created in component, shared with useMarkerLayer) */
  polygonCentroidCacheRef: React.MutableRefObject<Map<string, L.LatLngTuple>>;
  /** Ref to marker lookup so polygon centroids can reposition markers */
  markerByKeyRef: React.RefObject<Map<string, L.Marker>>;
}

interface UsePolygonLayerReturn {
  polygonZoomWarning: boolean;
}

/**
 * Manages the VWORLD cadastral polygon layer.
 * Fetches polygon features on map move, matches them to parcels by PNU or
 * coordinate containment, and caches polygon centroids for marker repositioning.
 */
export function usePolygonLayer({
  mapRef,
  parcels,
  selectedKeys,
  showPolygons,
  polygonCentroidCacheRef,
  markerByKeyRef,
}: UsePolygonLayerParams): UsePolygonLayerReturn {
  const polygonLayerRef = useRef<L.GeoJSON | null>(null);
  const fetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [polygonZoomWarning, setPolygonZoomWarning] = useState(false);

  // Stable refs for values that change but should not trigger effect re-runs
  const selectedKeysRef = useRef(selectedKeys);
  selectedKeysRef.current = selectedKeys;

  const parcelsRef = useRef(parcels);
  parcelsRef.current = parcels;

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

      // Read latest parcels & selectedKeys from refs
      const currentParcels = parcelsRef.current;
      const currentSelectedKeys = selectedKeysRef.current;

      // PNU 기반 조회용 맵 구축
      const pnuLookup = new Map<string, { parcel: Parcel; isSelected: boolean }>();
      const coordParcels: { parcel: Parcel; isSelected: boolean; lat: number; lng: number }[] = [];

      for (const p of currentParcels) {
        if (p.pnu) {
          pnuLookup.set(p.pnu, {
            parcel: p,
            isSelected: currentSelectedKeys.has(parcelKey(p)),
          });
        } else if (p.coords) {
          coordParcels.push({
            parcel: p,
            isSelected: currentSelectedKeys.has(parcelKey(p)),
            lat: p.coords.lat,
            lng: p.coords.lng,
          });
        }
      }

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
                pnuLookup.set(pnu, { parcel: cp.parcel, isSelected: cp.isSelected });
                coordParcels.splice(i, 1);
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
          const key = parcelKey(match.parcel);
          const latlng: L.LatLngTuple = [centroid.lat, centroid.lng];
          polygonCentroidCacheRef.current.set(key, latlng);
          const marker = markerByKeyRef.current?.get(key);
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
  }, [showPolygons, mapRef, polygonCentroidCacheRef, markerByKeyRef]);

  return {
    polygonZoomWarning,
  };
}
