/**
 * 봉화군 좌표 경계 — **단일 출처**
 *
 * 예전에는 이 값이 두 곳에 복제되어 있었다(`kakaoGeocoder.isValidBonghwaCoord`와
 * `mapUtils.isInBonghwa`). 2026-09-04에 지오코딩 쪽만 넓히고 지도 쪽을 그대로 두는 바람에,
 * **지오코딩은 통과한 좌표가 마커 단계에서 버려졌다** — 선택된 필지인데 지도에 마커가
 * 찍히지 않는 증상으로 나타났다(2026-09-07 사용자 보고).
 *
 * 경계값은 성격이 다른 두 곳에서 쓰이므로 반드시 같은 값이어야 한다.
 * 새로 참조할 곳이 생기면 여기서 가져다 쓴다.
 *
 * 실측 근거(2026-09-07): VWorld 시군구 경계(LT_C_ADSIGG_INFO, sig_cd=47920)와
 * 봉화군 법정리 72개 경계(LT_C_ADRI_INFO)의 정점 합집합 — 둘이 같은 값을 준다.
 *   lat 36.74653 ~ 37.10041 / lng 128.63763 ~ 129.18541
 *   (서단 봉화읍 화천리, 동단 석포면 석포리, 남단 재산면 남면리, 북단 석포면 석포리)
 *
 * 2026-09-04에 "표본 14,400필지 실측 lng 최대 129.37416"을 근거로 동쪽을 129.45까지
 * 넓힌 적이 있는데, 그 129.37416은 **centroid 상쇄 오차의 산출물**이었다
 * (소천면 분천리 99-11, PNU 4792035027100990011 — 실제 위치 129.0946에서 26km 동쪽).
 * 봉화군 어느 리의 경계도 lng 129.186을 넘지 않는다. 넓힌 범위는 울진군 26km 폭을
 * 통째로 통과시키므로 되돌렸다.
 *
 * 아래 값은 경계 정점에 약 2km 여유를 둔 것이다. 경계 폴리곤은 단순화돼 있을 수 있고,
 * 오목한 필지의 centroid는 폴리곤 밖에 떨어질 수 있어 여유가 필요하다. 반대로 여유가
 * 너무 크면 옆 군 필지가 걸러지지 않는다. 값을 바꾸면 `node scripts/verify-bounds.mjs`로
 * 두 방향 모두 확인할 것(경계를 포함하는지 + 여유가 5km를 넘지 않는지).
 */
export const BONGHWA_BOUNDS = {
  latMin: 36.73,
  latMax: 37.12,
  lngMin: 128.61,
  lngMax: 129.21,
} as const;

/** 좌표가 봉화군 범위 안인가 */
export function isInBonghwaBounds(lat: number, lng: number): boolean {
  return (
    lat >= BONGHWA_BOUNDS.latMin &&
    lat <= BONGHWA_BOUNDS.latMax &&
    lng >= BONGHWA_BOUNDS.lngMin &&
    lng <= BONGHWA_BOUNDS.lngMax
  );
}
