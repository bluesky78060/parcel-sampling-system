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
 * **좌표가 `null`이어도 그대로 반영한다.** `g?.coords ? ... : p`로 바꾸면 안 된다 —
 * 좌표 재변환(`force=true`)은 캐시를 비우고 전체를 다시 돌리는데, 그때 실패하면
 * `batchGeocoder`가 `coords: null`을 넣는다(`batchGeocoder.ts:512`). 실패가
 * `notFound`(서버가 답했고 좌표가 없다)면 **낡은 좌표가 지워지는 것이 맞다.**
 * 여기서 막으면 재변환이 초기화를 못 한다.
 *
 * 실패가 `quota`·`unreachable`·`auth`면 서버 사정이라 좌표에 대해 아무 말도 하지
 * 않는다. 그때는 `batchGeocoder`가 **애초에 `null`을 기입하지 않고 낡은 좌표를
 * 유지한다**(PROJ1-1-43에서 고쳤다). 즉 여기 도달하는 `null`은 "서버가 답했고
 * 좌표가 없다"는 뜻이므로 그대로 반영하는 것이 맞다.
 *
 * 예전에 좌표가 부당하게 지워지던 것은 이 삼항 때문이 아니라 **키 충돌** 때문이었다 —
 * 실패한 필지가 무관한 필지의 좌표를 덮어썼다. 키를 고치면 그 경로가 사라진다.
 *
 * @param targets  좌표를 받을 필지들. 지오코딩에 보내지 않은 필지가 섞여 있어도 된다
 * @param geocoded `startGeocoding`이 돌려준 배열. 실패분도 포함된다
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
