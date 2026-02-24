import type { LatLng } from '../types';
import { normalizeAddress } from './addressParser';

// 세션 동안 유지되는 캐시: 정규화 주소 → 좌표
const geocodeCache = new Map<string, LatLng>();

const KAKAO_ADDRESS_URL = 'https://dapi.kakao.com/v2/local/search/address.json';
const KAKAO_KEYWORD_URL = 'https://dapi.kakao.com/v2/local/search/keyword.json';

/**
 * API 키 존재 여부 확인
 */
export function isGeocodingAvailable(): boolean {
  return !!import.meta.env.VITE_KAKAO_REST_KEY;
}

/**
 * 단일 주소를 좌표로 변환
 * 1. 캐시 확인
 * 2. Kakao Geocoding REST API 호출 (/v2/local/search/address.json)
 * 3. 실패 시 키워드 검색으로 재시도 (/v2/local/search/keyword.json)
 * 4. 결과 캐시 저장
 */
export async function geocodeAddress(address: string): Promise<LatLng | null> {
  const key = normalizeAddress(address);

  // 1. 캐시 확인
  if (geocodeCache.has(key)) {
    return geocodeCache.get(key)!;
  }

  const apiKey = import.meta.env.VITE_KAKAO_REST_KEY;
  if (!apiKey) {
    console.warn('[kakaoGeocoder] VITE_KAKAO_REST_KEY가 설정되지 않았습니다.');
    return null;
  }

  const headers = {
    Authorization: `KakaoAK ${apiKey}`,
  };

  // 2. 주소 검색 API 시도
  try {
    const addressRes = await fetch(
      `${KAKAO_ADDRESS_URL}?query=${encodeURIComponent(address)}`,
      { headers }
    );

    if (addressRes.ok) {
      const addressData = await addressRes.json();
      if (addressData.documents && addressData.documents.length > 0) {
        const doc = addressData.documents[0];
        const coords: LatLng = {
          lat: parseFloat(doc.y),
          lng: parseFloat(doc.x),
        };
        geocodeCache.set(key, coords);
        return coords;
      }
    }
  } catch (err) {
    console.warn('[kakaoGeocoder] 주소 검색 API 오류:', err);
  }

  // 3. 키워드 검색으로 재시도 (지번 주소 등 처리)
  try {
    const keywordRes = await fetch(
      `${KAKAO_KEYWORD_URL}?query=${encodeURIComponent(address)}`,
      { headers }
    );

    if (keywordRes.ok) {
      const keywordData = await keywordRes.json();
      if (keywordData.documents && keywordData.documents.length > 0) {
        const doc = keywordData.documents[0];
        const coords: LatLng = {
          lat: parseFloat(doc.y),
          lng: parseFloat(doc.x),
        };
        geocodeCache.set(key, coords);
        return coords;
      }
    }
  } catch (err) {
    console.warn('[kakaoGeocoder] 키워드 검색 API 오류:', err);
  }

  return null;
}

/**
 * 캐시에서 좌표 조회 (API 호출 없이)
 */
export function getCachedCoords(address: string): LatLng | null {
  const key = normalizeAddress(address);
  return geocodeCache.get(key) ?? null;
}

/**
 * 캐시 초기화
 */
export function clearGeocodeCache(): void {
  geocodeCache.clear();
}

/**
 * 캐시된 항목 수
 */
export function getCacheSize(): number {
  return geocodeCache.size;
}
