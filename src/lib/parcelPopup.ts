import type { Parcel } from '../types';
import { escapeHtml } from './htmlUtils';
import { isRepresentative } from './parcelCategory';

/**
 * 지도 마커 팝업의 HTML.
 *
 * **조사 연도를 인자로 받는다 — 스토어를 직접 읽지 않는다.**
 * `getMarkerColor`와 **같은 함정**이었다. 색과 팝업이 서로 다른 시점의 연도를 보면
 * 화면 안에서 엇갈리므로, 둘 다 호출부가 구독한 하나의 값을 받는다.
 *
 * 이 함수가 `components/Map/mapUtils`가 아니라 여기에 있는 이유는 `markerColor`와
 * 똑같다. `mapUtils`는 leaflet을 top-level import 하고 leaflet은 로드 시점에
 * `window`를 만져서, `environment: 'node'`인 이 저장소의 테스트에서는 그 모듈에
 * 있는 것을 **아무것도 import할 수 없다.** 그런데 이 함수는 leaflet을 하나도 쓰지
 * 않는다 — `escapeHtml`·`isRepresentative`와 템플릿 문자열뿐이다. 거기 두었을 때
 * 커버리지가 0이었고, 연도를 스토어 읽기로 되돌리는 변이가 테스트 476건을 전부
 * 통과했다(lint·tsc도 통과했다). 재수출도 하지 않는다 — 같은 이름의 통로가 둘이
 * 되면 한쪽만 고치는 실수가 다시 열린다.
 *
 * ⚠️ **HTML을 문자열로 조립한다.** 필지 주소·경영체명은 사용자가 올린 엑셀에서
 * 그대로 온다. 동적 값은 **하나도 빠짐없이** `escapeHtml`을 거쳐야 한다.
 * `__tests__/parcelPopup.test.ts`가 필드별로 이것을 고정한다.
 *
 * 다만 아래 세 자리의 `escapeHtml`은 **타입상 no-op**이라 테스트로 고정할 수 없다.
 * 각각을 지우는 변이는 실측에서 생존했고, **등가 변이**다 — 없앨 이유도 없지만
 * (방어적으로 남긴다) 커버리지 구멍으로 오해하지 않도록 적어 둔다.
 * - `area`는 `number` → `toLocaleString()`은 숫자·구분자만 낸다
 * - `sampledYears`는 `number[]` → `join`도 마찬가지다
 * - `selectionText`는 바로 위에서 만든 세 개의 한글 리터럴 중 하나다
 * 사용자 입력이 닿는 자리는 `farmerName`·`parcelId`·`address`·`ri` 넷이고,
 * 그 넷의 이스케이프를 지우는 변이는 전부 사망한다.
 *
 * @param surveyYear 조사 연도. 팝업의 "{연도} 선택" 라벨이 여기서 나온다.
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
      <tr><td style="color:#888;padding:2px 8px 2px 0">면적</td><td>${parcel.area ? escapeHtml(parcel.area.toLocaleString()) + ' m²' : '-'}</td></tr>
      <tr><td style="color:#888;padding:2px 8px 2px 0">채취이력</td><td>${parcel.sampledYears.length ? escapeHtml(parcel.sampledYears.join(', ')) + '년' : '없음'}</td></tr>
      <tr><td style="color:#888;padding:2px 8px 2px 0">${surveyYear} 선택</td>
        <td><b style="color:${selectionColor}">${escapeHtml(selectionText)}</b></td></tr>
    </table>
  </div>`;
}
