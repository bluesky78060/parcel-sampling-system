import L from 'leaflet';
import type { Parcel } from '../../types';
import { escapeHtml } from '../../lib/htmlUtils';
import { BONGHWA_BOUNDS, isInBonghwaBounds } from '../../lib/bonghwaBounds';
import { isRepresentative } from '../../lib/parcelCategory';
import { parcelMatchKey } from '../../lib/parcelKey';

// 경계값은 lib/bonghwaBounds에 하나만 둔다. 예전에 여기 복제해 둔 값이
// 지오코딩 쪽과 갈라지면서, 통과한 좌표가 마커 단계에서 버려졌다.
export { BONGHWA_BOUNDS };
export const isInBonghwa = isInBonghwaBounds;

// `getMarkerColor`는 `lib/markerColor.ts`로 옮겼다. 이 모듈은 leaflet을
// top-level import 하는데 leaflet은 로드 시점에 `window`를 만져서, node 환경인
// 이 저장소의 테스트에서는 여기 있는 것을 **아무것도 import할 수 없다.**
// 색 판정은 순수 로직이므로 leaflet에 묶어 둘 이유가 없다. 재수출도 하지 않는다 —
// 같은 이름의 통로가 둘이 되면 한쪽만 고치는 실수가 다시 열린다.

export function createCircleIcon(color: string) {
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

export function createStarIcon(color: string) {
  return L.divIcon({
    className: '',
    html: `<svg width="28" height="38" viewBox="0 0 28 38" xmlns="http://www.w3.org/2000/svg">
      <path d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 24 14 24s14-13.5 14-24C28 6.3 21.7 0 14 0z" fill="${color}"/>
      <polygon points="14,6 16.2,11.5 22,12 17.5,15.8 19,21.5 14,18.2 9,21.5 10.5,15.8 6,12 11.8,11.5" fill="white"/>
    </svg>`,
    iconSize: [28, 38],
    iconAnchor: [14, 38],
    popupAnchor: [0, -38],
  });
}

/**
 * 팝업 HTML.
 *
 * `surveyYear`를 인자로 받는다. 예전에는 여기서도 스토어를 직접 읽었다 —
 * `getMarkerColor`와 **같은 함정**이다. 색과 팝업이 서로 다른 시점의 연도를
 * 보면 화면 안에서 엇갈리므로, 둘 다 호출부가 구독한 하나의 값을 받는다.
 */
export function createPopupContent(parcel: Parcel, isSelected: boolean, surveyYear: number): string {
  const isRep = isRepresentative(parcel);
  const categoryBadge = isRep
    ? '<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:600;background:#ecfdf5;color:#059669;border:1px solid #a7f3d0;">대표필지</span>'
    : '<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:600;background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe;">공익직불제</span>';
  const selectionColor = isRep ? '#059669' : (isSelected ? '#2563eb' : '#999');
  const selectionText = isRep ? '고정 선택' : (isSelected ? '추출 선택' : '미선택');

  return `<div style="min-width:200px; font-family:sans-serif;">
    <div style="display:flex;align-items:center;gap:6px;"><strong>${escapeHtml(parcel.farmerName)}</strong>${categoryBadge}</div>
    <hr style="margin:6px 0; border-color:#eee;">
    <table style="font-size:12px;">
      <tr><td style="color:#888;padding:2px 8px 2px 0">필지번호</td><td><b>${escapeHtml(String(parcel.parcelId ?? ''))}</b></td></tr>
      <tr><td style="color:#888;padding:2px 8px 2px 0">주소</td><td>${escapeHtml(parcel.address ?? '')}</td></tr>
      <tr><td style="color:#888;padding:2px 8px 2px 0">리</td><td>${escapeHtml(parcel.ri ?? '')}</td></tr>
      <tr><td style="color:#888;padding:2px 8px 2px 0">면적</td><td>${parcel.area ? escapeHtml(parcel.area.toLocaleString()) + ' m\u00B2' : '-'}</td></tr>
      <tr><td style="color:#888;padding:2px 8px 2px 0">채취이력</td><td>${parcel.sampledYears.length ? escapeHtml(parcel.sampledYears.join(', ')) + '년' : '없음'}</td></tr>
      <tr><td style="color:#888;padding:2px 8px 2px 0">${surveyYear} 선택</td>
        <td><b style="color:${selectionColor}">${escapeHtml(selectionText)}</b></td></tr>
    </table>
  </div>`;
}

// Ray casting 알고리즘으로 점이 폴리곤 안에 있는지 확인
export function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
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
// VWORLD는 CORS 헤더를 보내지 않으므로 JSONP로 호출한다. 프록시가 필요 없어
// dev/prod 모두 같은 주소를 쓴다. (jsonp 헬퍼 참조)
export const VWORLD_DATA_URL = 'https://api.vworld.kr/req/data';

/**
 * 지도용 필지 키.
 *
 * 예전에는 `${farmerId}__${parcelId}`라는 **자체 공식**을 썼다. `lib/parcelKey.ts`가
 * "여기 하나만 쓴다"고 선언한 것을 어긴 다섯 번째 복제본이었고, 그 공식은
 * 경영체번호가 비면 `__100-1` 형태로 **리를 넘어 충돌**한다
 * (한 농가가 A리·B리에 같은 지번을 가질 수 있다).
 *
 * 충돌하면 `markerByKeyRef`에서 먼저 그린 마커의 참조가 유실되고,
 * 선택되지 않은 필지가 선택 마커로 찍힌다. 정규 키로 통일한다.
 *
 * 식별 불가능한 필지에는 `null`이 온다 — 호출부가 캐시·조회에서 건너뛴다.
 */
export const parcelKey = parcelMatchKey;
