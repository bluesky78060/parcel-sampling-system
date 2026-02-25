import L from 'leaflet';
import type { Parcel } from '../../types';
import { escapeHtml } from '../../lib/htmlUtils';

// 봉화군 대략적 좌표 범위 (여유 포함)
export const BONGHWA_BOUNDS = {
  latMin: 36.75,
  latMax: 37.15,
  lngMin: 128.55,
  lngMax: 129.25,
};

export function isInBonghwa(lat: number, lng: number): boolean {
  return (
    lat >= BONGHWA_BOUNDS.latMin &&
    lat <= BONGHWA_BOUNDS.latMax &&
    lng >= BONGHWA_BOUNDS.lngMin &&
    lng <= BONGHWA_BOUNDS.lngMax
  );
}

export function getMarkerColor(parcel: Parcel, isSelected: boolean): string {
  if ((parcel.parcelCategory ?? 'public-payment') === 'representative' && isSelected) return '#059669';
  if (isSelected) return '#2563eb';
  if (parcel.sampledYears.includes(2024)) return '#dc2626';
  if (parcel.sampledYears.includes(2025)) return '#ea580c';
  if (parcel.isEligible) return '#6b7280';
  return '#9ca3af';
}

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

export function createPopupContent(parcel: Parcel, isSelected: boolean): string {
  const isRep = (parcel.parcelCategory ?? 'public-payment') === 'representative';
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
      <tr><td style="color:#888;padding:2px 8px 2px 0">2026 선택</td>
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
const isDev = import.meta.env.DEV;
export const VWORLD_DATA_URL = isDev
  ? '/api/vworld/req/data'
  : 'https://api.vworld.kr/req/data';

/** Build a parcel key from farmerId and parcelId */
export function parcelKey(parcel: Parcel): string {
  return `${parcel.farmerId}__${parcel.parcelId}`;
}
