/**
 * 지도 화면을 **언제 자동으로 맞출 것인가**를 정하는 규칙.
 *
 * 예전에는 마커를 다시 그릴 때마다 `fitBounds`를 걸었다. 그래서 사용자가 지도를
 * 확대해 특정 필지를 보고 있다가 체크박스 하나만 눌러도 화면이 전체 범위로
 * 튕겨 돌아왔다. 마커가 4만 개일 때는 느려서 조작 자체를 안 했기 때문에 드러나지
 * 않았고, 700개로 줄여 조작이 가능해지자 바로 문제가 됐다(PROJ1-1-32 → PROJ1-1-36).
 *
 * 판정을 훅 밖으로 뺀 이유: 조건이 여럿이고 서로 미묘하다.
 * Leaflet DOM이 필요한 훅 안에 두면 회귀를 기계적으로 잡을 수 없다.
 */

import type { LatLng } from '../types';

/** 지도 카테고리 필터. 훅의 prop 타입과 같은 유니온을 유지한다 — `string`으로 넓히면 오타가 조용히 통과한다. */
export type MapCategoryFilter = 'all' | 'public-payment' | 'representative';

export interface MapFitState {
  /** 선택된 리 필터. `undefined`와 `''`는 모두 "전체"로 같게 본다 */
  filterRi?: string;
  /** 선택된 카테고리 필터 */
  categoryFilter?: MapCategoryFilter;
  /** 이 시점에 지도에 실제로 올라간 마커가 하나라도 있었는가 */
  hadMarkers: boolean;
  /** 올라간 마커 중 **현재 화면 안**에 든 것이 하나라도 있는가 */
  anyMarkerInView: boolean;
}

/**
 * 빈 문자열과 `undefined`를 같은 "전체"로 본다.
 *
 * 현재 유일한 호출부(`ReviewPage`)가 `filterRi || undefined`로 정규화해 넘기지만,
 * 타입은 `''`을 허용한다. 두 번째 호출부가 생겨 그대로 넘기면 `'' !== undefined`가
 * 참이 되어 **필터를 만진 적도 없는데 화면이 맞춰진다.** 여기서 막는다.
 */
const normalizeRi = (value?: string): string | undefined => value || undefined;

/** 지도 화면의 경계. Leaflet 타입에 의존하지 않도록 숫자 넷으로만 받는다. */
export interface ViewRect {
  south: number;
  west: number;
  north: number;
  east: number;
}

/**
 * 렌더된 마커 중 화면 안에 든 것이 하나라도 있는가.
 *
 * 훅 안에서 `bounds.some((ll) => viewBounds.contains(ll))` 한 줄로 두었더니,
 * 이 값을 `false`로 고정하는 변이가 189건을 **전부 통과**했다.
 * `false` 고정은 마커를 다시 그릴 때마다 무조건 맞추게 만든다 —
 * **PROJ1-1-36이 고치려던 바로 그 동작**인데 초록불이었다.
 *
 * 판정에 실제로 쓰이는 계산은 전부 이 모듈 안에 있어야 한다.
 */
export function anyMarkerInView(positions: readonly LatLng[], view: ViewRect): boolean {
  return positions.some(
    ({ lat, lng }) =>
      lat >= view.south && lat <= view.north && lng >= view.west && lng <= view.east,
  );
}

/**
 * 마커 렌더 결과로부터 판정 상태를 만든다.
 *
 * `hadMarkers`를 훅에서 직접 조립하면 그 산식(`renderedCount > 0`)을 아무도 검증하지
 * 않는다 — 실제로 `hadMarkers: true`로 고정해 버리는 변이가 테스트를 전부 통과했다.
 */
export function deriveFitState(input: {
  filterRi?: string;
  categoryFilter?: MapCategoryFilter;
  renderedCount: number;
  anyMarkerInView: boolean;
}): MapFitState {
  return {
    filterRi: input.filterRi,
    categoryFilter: input.categoryFilter,
    hadMarkers: input.renderedCount > 0,
    anyMarkerInView: input.anyMarkerInView,
  };
}

/**
 * 자동으로 화면을 맞춰야 하는가.
 *
 * 맞추는 경우는 넷이다.
 *
 * | 상황 | 근거 |
 * |---|---|
 * | 첫 진입 (`last === null`) | 어디를 봐야 할지 아직 모른다 |
 * | 리·카테고리 필터 변경 | 사용자가 "다른 것을 보겠다"고 명시한 것이다 |
 * | 마커가 없다가 생김 | 좌표 변환이 끝난 경우다. 빈 화면을 그대로 둘 수 없다 |
 * | 마커는 있는데 화면 안에 하나도 없음 | 빈 지도에 "마커 700" 배지만 뜨는 모순을 막는다 |
 *
 * 반대로 표시 토글(미선택 표시·1km 반경), 조사 연도 변경, 필지 선택 해제로는
 * 움직이지 않는다. 그것들은 "보는 대상"이 아니라 **보는 방식**을 바꾸는 조작이라,
 * 사용자가 맞춰 둔 화면을 유지해야 작업을 이어갈 수 있다.
 *
 * 마지막 규칙이 세 가지 빈틈을 함께 덮는다.
 * - "추출 선택만"을 다시 켰을 때 그 700건이 현재 뷰포트 밖에 있는 경우
 * - 좌표 변환이 부분 성공해 재시도했을 때 새 마커가 화면 밖에 생기는 경우
 * - 전체화면을 축소해 마커가 화면 밖으로 밀려나는 경우
 *
 * 마커가 있다가 없어진 경우는 움직이지 않는다 — 맞출 대상이 없기도 하고,
 * 필터를 되돌렸을 때 원래 보던 자리로 돌아오는 편이 낫다.
 *
 * **주의**: 마지막 규칙은 "사용자가 방금 그 자리에서 없앤 마커"와 "표시 대상이 통째로
 * 바뀐 경우"를 구분하지 않는다. 지금은 선택 해제 컨트롤이 표 탭에만 있고 지도 탭의
 * 상세 패널은 읽기 전용이라 도달하지 않는다. **지도에서 선택을 해제할 수 있게 되면**
 * 확대해 보던 필지를 해제하는 순간 뷰포트가 비어 전체로 튕기고, 그것은 이 규칙이
 * 없애려던 감각과 정확히 같다. 그때는 상태값에 선택 시그니처를 넣어
 * 선택 변경만으로는 뷰포트 규칙이 발동하지 않도록 해야 한다.
 */
export function shouldAutoFit(last: MapFitState | null, current: MapFitState): boolean {
  if (last === null) return true;
  if (normalizeRi(last.filterRi) !== normalizeRi(current.filterRi)) return true;
  if (last.categoryFilter !== current.categoryFilter) return true;
  if (!last.hadMarkers && current.hadMarkers) return true;
  return current.hadMarkers && !current.anyMarkerInView;
}

/**
 * 판정과 상태 갱신을 한 번에 돌려준다.
 *
 * 갱신을 호출부에 맡기면 `if (fit)` 안으로 들어가는 실수가 난다. 그러면
 * `hadMarkers`의 false→true 전이를 놓쳐 "좌표 변환이 끝나면 맞춘다"는 규칙이
 * 조용히 죽는다 — 그 변이가 실제로 테스트를 전부 통과했다.
 * `next`를 조건과 무관하게 돌려주어 그 실수를 구조적으로 막는다.
 */
export function reduceFit(
  prev: MapFitState | null,
  current: MapFitState,
): { fit: boolean; next: MapFitState } {
  return { fit: shouldAutoFit(prev, current), next: current };
}
