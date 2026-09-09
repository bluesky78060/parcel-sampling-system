import type { Parcel } from '../types';
import { isRepresentative } from './parcelCategory';
import { sampledYearsOf } from '../store/surveyStore';

/**
 * 필지 하나의 표시 색.
 *
 * **조사 연도를 인자로 받는다 — 스토어를 직접 읽지 않는다.**
 *
 * 예전에는 함수 안에서 `useSurveyStore.getState().surveyYear`를 읽었다. 겉보기에는
 * 순수 함수라 호출부가 "인자가 안 바뀌었으니 다시 그릴 필요 없다"고 판단했고,
 * 그러면 **연도를 바꿔도 색이 낡은 채로 남았다.**
 *
 * - `useMarkerLayer`: 실제로 그 일이 나서 `surveyYear` 구독을 붙여 막았다.
 *   다만 effect 본문 어디에도 `surveyYear`가 안 나와서, 의존성 배열의 그 항목이
 *   왜 있는지 코드만 보고는 알 수 없었다.
 * - `usePolygonLayer`: 같은 구멍이 **막히지 않은 채로** 남아 있었다. 폴리곤 색은
 *   `L.geoJSON`의 style 콜백이 **그리는 순간** 계산해 화면에 박는데, 그 effect의
 *   의존성에 연도가 없어 다시 그리지 않았다.
 *
 * 연도를 인자로 올리면 의존성이 눈에 보이고, lint가 빠진 의존성을 잡아 주며,
 * leaflet 없이 node에서 검증할 수 있다. 그래서 이 함수는 `mapUtils`(leaflet을
 * top-level import 해 node에서 로드조차 안 된다)가 아니라 여기에 있다.
 *
 * @param surveyYear 조사 연도. 기채취 연도(N-1 빨강, N-2 주황)가 여기서 파생된다.
 */
export function getMarkerColor(parcel: Parcel, isSelected: boolean, surveyYear: number): string {
  if (isRepresentative(parcel) && isSelected) return '#059669';
  if (isSelected) return '#2563eb';
  // 기채취 연도는 조사 연도에서 파생된다. 최근 연도(N-1)가 빨강, 그 전(N-2)이 주황.
  const [recent, older] = sampledYearsOf(surveyYear);
  if (parcel.sampledYears.includes(recent)) return '#dc2626';
  if (parcel.sampledYears.includes(older)) return '#ea580c';
  if (parcel.isEligible) return '#6b7280';
  return '#9ca3af';
}
