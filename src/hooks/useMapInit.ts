import { useEffect, useRef } from 'react';
import L from 'leaflet';

/**
 * Initializes a Leaflet map centered on Bonghwa-gun with VWORLD tile layers.
 * Also attaches a ResizeObserver to invalidate size on container resize.
 *
 * @param containerRef - ref to the DOM element that will host the map
 * @returns mapRef - a mutable ref holding the L.Map instance (or null)
 */
export function useMapInit(containerRef: React.RefObject<HTMLDivElement | null>) {
  const mapRef = useRef<L.Map | null>(null);

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

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [containerRef]);

  // 컨테이너 리사이즈 감지 -> 지도 크기 재계산 (전체화면 토글 대응)
  useEffect(() => {
    const container = containerRef.current;
    const map = mapRef.current;
    if (!container || !map) return;

    const observer = new ResizeObserver(() => {
      map.invalidateSize();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef]);

  return mapRef;
}
