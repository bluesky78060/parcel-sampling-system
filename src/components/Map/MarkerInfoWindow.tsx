import type { Parcel } from '../../types';
import { escapeHtml } from '../../lib/htmlUtils';

export function createInfoWindowContent(parcel: Parcel): string {
  // HTML 문자열 반환 - 카카오맵 InfoWindow에 사용
  return `<div style="padding:12px; min-width:200px; font-family:sans-serif;">
    <strong>${escapeHtml(parcel.farmerName)}</strong>
    <hr style="margin:6px 0; border-color:#eee;">
    <table style="font-size:12px;">
      <tr><td style="color:#888;padding:2px 8px 2px 0">필지번호</td><td><b>${escapeHtml(String(parcel.parcelId ?? ''))}</b></td></tr>
      <tr><td style="color:#888;padding:2px 8px 2px 0">주소</td><td>${escapeHtml(parcel.address ?? '')}</td></tr>
      <tr><td style="color:#888;padding:2px 8px 2px 0">리</td><td>${escapeHtml(parcel.ri ?? '')}</td></tr>
      <tr><td style="color:#888;padding:2px 8px 2px 0">면적</td><td>${parcel.area ? escapeHtml(parcel.area.toLocaleString()) + ' m²' : '-'}</td></tr>
      <tr><td style="color:#888;padding:2px 8px 2px 0">채취이력</td><td>${parcel.sampledYears.length ? escapeHtml(parcel.sampledYears.join(', ')) + '년' : '없음'}</td></tr>
      <tr><td style="color:#888;padding:2px 8px 2px 0">2026 선택</td>
        <td><b style="color:${parcel.isSelected ? '#2563eb' : '#999'}">${parcel.isSelected ? '추출 선택' : '미선택'}</b></td></tr>
    </table>
  </div>`;
}
