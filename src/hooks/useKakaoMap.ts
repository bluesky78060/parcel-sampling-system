import { useEffect, useRef, useState } from 'react';

interface UseKakaoMapOptions {
  center?: { lat: number; lng: number };
  level?: number; // 줌 레벨 (기본: 10)
}

interface UseKakaoMapReturn {
  mapRef: React.RefObject<HTMLDivElement | null>;
  map: any | null; // kakao.maps.Map
  isLoaded: boolean;
  error: string | null;
}

function loadKakaoMapSDK(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).kakao?.maps) {
      resolve();
      return;
    }
    const key = import.meta.env.VITE_KAKAO_JS_KEY;
    if (!key) {
      reject(new Error('VITE_KAKAO_JS_KEY 환경변수가 설정되지 않았습니다'));
      return;
    }
    const script = document.createElement('script');
    script.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&libraries=services&autoload=false`;
    script.onload = () => {
      (window as any).kakao.maps.load(() => resolve());
    };
    script.onerror = () => reject(new Error('카카오맵 SDK 로드 실패'));
    document.head.appendChild(script);
  });
}

export function useKakaoMap(options?: UseKakaoMapOptions): UseKakaoMapReturn {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const [map, setMap] = useState<any | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const center = options?.center ?? { lat: 36.5, lng: 127.0 };
  const level = options?.level ?? 10;

  useEffect(() => {
    let cancelled = false;

    loadKakaoMapSDK()
      .then(() => {
        if (cancelled) return;
        if (!mapRef.current) return;

        const kakao = (window as any).kakao;
        const mapInstance = new kakao.maps.Map(mapRef.current, {
          center: new kakao.maps.LatLng(center.lat, center.lng),
          level,
        });

        if (!cancelled) {
          setMap(mapInstance);
          setIsLoaded(true);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { mapRef, map, isLoaded, error };
}
