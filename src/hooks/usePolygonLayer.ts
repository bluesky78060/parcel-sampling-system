import { useEffect, useRef, useState } from 'react';
import { jsonp } from '../lib/jsonp';
import L from 'leaflet';
import type { Parcel } from '../types';
import { computePolygonCentroid, getVworldKey } from '../lib/kakaoGeocoder';
import { getMarkerColor } from '../lib/markerColor';
import { useSurveyStore } from '../store/surveyStore';
import {
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

  /**
   * 폴리곤 색도 마커 색과 같은 `getMarkerColor`에서 나온다.
   *
   * **여기에는 이 구독이 없었고, 그게 잠복 결함이었다.** 색은 아래 `L.geoJSON`의
   * style 콜백이 **레이어를 그리는 순간** 계산해 화면에 박는다. 그 뒤 조사 연도를
   * 바꿔도 이 effect가 다시 돌지 않으니 style 콜백도 다시 불리지 않고, 폴리곤은
   * 옛 연도의 색으로 남았다. 같은 화면의 마커는(`useMarkerLayer`가 연도를 구독하므로)
   * 새 색으로 바뀌어서, 마커와 폴리곤이 서로 다른 색이 됐다.
   *
   * 연도를 바꾸는 것은 드문 조작이라 VWorld 재조회 한 번이 붙는 비용은 받아들인다
   * (지도는 이미 `moveend`마다 재조회한다). 폴리곤만 다시 칠하는 최적화는
   * pnuLookup을 effect 밖으로 끌어내야 하는데, 이 effect는 최근에 여러 번 고쳐진
   * 곳이라 그 이득을 위해 구조를 흔들 이유가 없다.
   */
  const surveyYear = useSurveyStore((st) => st.surveyYear);

  useEffect(() => {
    const map = mapRef.current;
    const vworldKey = getVworldKey();
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
        // 키가 없으면 선택 여부를 판정할 수 없다 — 미선택으로 본다
        const pk = parcelKey(p);
        const isSelected = pk !== null && currentSelectedKeys.has(pk);
        if (p.pnu) {
          pnuLookup.set(p.pnu, { parcel: p, isSelected });
        } else if (p.coords) {
          coordParcels.push({
            parcel: p,
            isSelected,
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
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const data = await jsonp<any>(VWORLD_DATA_URL, {
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
              return data?.response?.result?.featureCollection?.features ?? [];
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
          if (key === null) continue; // 캐시에 넣을 수도, 마커를 찾을 수도 없다
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

            const color = getMarkerColor(match.parcel, match.isSelected, surveyYear);
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
  }, [showPolygons, surveyYear, mapRef, polygonCentroidCacheRef, markerByKeyRef]);

  return {
    polygonZoomWarning,
  };
}
