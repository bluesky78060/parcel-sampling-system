import L from 'leaflet';
import { BONGHWA_BOUNDS, isInBonghwaBounds } from '../../lib/bonghwaBounds';
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

// 팝업 HTML(`createPopupContent`)은 `lib/parcelPopup.ts`로 옮겼다. `getMarkerColor`와
// **같은 논거**다 — 그 함수는 leaflet을 하나도 쓰지 않는데(이스케이퍼·분류 판정과
// 템플릿 문자열뿐이다) 여기 있는 동안 node에서 import조차 못 해 커버리지가 0이었고,
// 연도를 스토어 읽기로 되돌리는 변이가 테스트 476건·lint·tsc를 전부 통과했다.
// 재수출하지 않는다.

// Ray casting 알고리즘으로 점이 폴리곤 안에 있는지 확인

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
