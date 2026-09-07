/**
 * 지도 화면을 **언제 자동으로 맞출 것인가**를 정하는 규칙.
 *
 * 예전에는 마커를 다시 그릴 때마다 `fitBounds`를 걸었다. 그래서 사용자가 지도를
 * 확대해 특정 필지를 보고 있다가 체크박스 하나만 눌러도 화면이 전체 범위로
 * 튕겨 돌아왔다. 마커가 4만 개일 때는 느려서 조작 자체를 안 했기 때문에 드러나지
 * 않았고, 700개로 줄여 조작이 가능해지자 바로 문제가 됐다(PROJ1-1-32 → PROJ1-1-35).
 *
 * 판정을 훅 밖으로 뺀 이유: 조건이 넷이고 서로 미묘하게 다르다.
 * Leaflet DOM이 필요한 훅 안에 두면 회귀를 기계적으로 잡을 수 없다.
 */

export interface MapFitState {
  /** 선택된 리 필터. `undefined`는 전체다 */
  filterRi?: string;
  /** 선택된 카테고리 필터 */
  categoryFilter?: string;
  /** 이 시점에 지도에 실제로 올라간 마커가 하나라도 있었는가 */
  hadMarkers: boolean;
}

/**
 * 자동으로 화면을 맞춰야 하는가.
 *
 * 맞추는 경우는 셋뿐이다.
 *
 * | 상황 | 근거 |
 * |---|---|
 * | 첫 진입 (`last === null`) | 어디를 봐야 할지 아직 모른다 |
 * | 리·카테고리 필터 변경 | 사용자가 "다른 것을 보겠다"고 명시한 것이다 |
 * | 마커가 없다가 생김 | 좌표 변환이 끝난 경우다. 빈 화면을 그대로 둘 수 없다 |
 *
 * 반대로 표시 토글(미선택 표시·1km 반경), 조사 연도 변경, 필지 선택 해제로는
 * 움직이지 않는다. 그것들은 "보는 대상"이 아니라 **보는 방식**을 바꾸는 조작이라,
 * 사용자가 맞춰 둔 화면을 유지해야 작업을 이어갈 수 있다.
 *
 * 마커가 있다가 없어진 경우도 움직이지 않는다 — 맞출 대상이 없기도 하고,
 * 필터를 되돌렸을 때 원래 보던 자리로 돌아오는 편이 낫다.
 */
export function shouldAutoFit(last: MapFitState | null, current: MapFitState): boolean {
  if (last === null) return true;
  if (last.filterRi !== current.filterRi) return true;
  if (last.categoryFilter !== current.categoryFilter) return true;
  return !last.hadMarkers && current.hadMarkers;
}
