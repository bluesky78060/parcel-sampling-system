import type { Parcel } from '../types';

/**
 * 지오코딩 결과의 좌표를 원본 필지에 반영한다.
 *
 * 예전에는 이 블록이 **세 벌 복제**돼 있었고(`AnalyzePage` 2곳, `ReviewPage` 1곳,
 * 총 9개 지점), 손으로 만든 키를 썼다.
 *
 * ```ts
 * const key = `${gp.farmerId}_${gp.parcelId}_${gp.address}`;
 * ```
 *
 * `parcelFarmerKey`보다 두 가지가 더 약했다.
 *
 * 1. **`ri`가 없다.** `parcelId`는 지번이라 리를 넘어 고유하지 않다 — 한 농가가
 *    문단리와 법전리에 각각 지번 100을 가지면 둘이 같은 키가 된다
 * 2. **빈 값 가드가 없다.** `parcelId`도 `address`도 비면 `F001__`이 되어,
 *    그 농가의 식별 불가능한 필지들이 전부 한 키로 뭉친다
 *
 * `Map`은 마지막 것이 이기므로, 뭉친 필지 중 **하나의 좌표가 나머지 전부에 기입된다.**
 * 지도 마커가 엉뚱한 곳에 찍히고 엑셀의 위도·경도가 틀린다. PNU 경로는 주소와 무관하게
 * 실제 지적 좌표를 넣으므로, 충돌하는 두 행이 **각각 올바른 서로 다른 좌표**를 가진
 * 상태에서 한쪽이 다른 쪽을 덮어쓸 수 있다.
 *
 * `rowUid`는 파싱 시점에 행마다 부여되고 `batchGeocoder`의 모든 스프레드를 통과하므로
 * 충돌이 원천적으로 없다.
 *
 * @param targets  좌표를 받을 필지들. 지오코딩에 보내지 않은 필지가 섞여 있어도 된다
 * @param geocoded `startGeocoding`이 돌려준 배열. 실패분도 포함되어 있고,
 *                 실패분의 `coords`는 **원래 값 그대로**다(지오코더가 지우지 않는다)
 */
export function applyGeocodedCoords(
  targets: readonly Parcel[],
  geocoded: readonly Parcel[],
): Parcel[] {
  const byRowUid = new Map<string, Parcel>();
  for (const gp of geocoded) byRowUid.set(gp.rowUid, gp);

  return targets.map((p) => {
    const g = byRowUid.get(p.rowUid);
    return g ? { ...p, coords: g.coords } : p;
  });
}
