import type { Parcel, ParcelCategory } from '../types';
import { parcelMatchKey } from './parcelKey';

/**
 * 결과 검토 화면의 파생 계산.
 *
 * 이것들은 원래 `ReviewPage`의 `useMemo` 안에 있었다. React가 필요해서가 아니라
 * 거기서 쓰기 때문이었고, 그래서 **DOM 없이는 테스트할 수 없었다.**
 *
 * PROJ1-1-37에서 리뷰가 실측한 결과 이 계산들의 키 처리를 되돌려도 테스트가 전부
 * 통과했다 — 검토 표에서 필지가 증발하고 지도가 안 뽑힌 것을 뽑힌 것으로 그리던
 * 결함들이 무보호였다. 순수 함수로 꺼내 그 구멍을 메운다.
 */

/**
 * 마스터에 대표필지를 합친다. 같은 필지면 마스터 쪽을 남긴다(좌표를 갖고 있다).
 *
 * 키가 없는 대표필지는 마스터와 같은 필지인지 판정할 수 없으므로 **새 것으로 본다.**
 * 접으면 조용히 사라지는데, 대표필지는 반드시 조사해야 하는 고정 관측점이다.
 */
export function mergeWithRepresentatives(
  allParcels: Parcel[],
  representativeParcels: Parcel[],
): Parcel[] {
  if (representativeParcels.length === 0) return allParcels;
  const existingKeys = new Set(
    allParcels.map(parcelMatchKey).filter((k): k is string => k !== null),
  );
  const newReps = representativeParcels.filter((p) => {
    const key = parcelMatchKey(p);
    return key === null || !existingKeys.has(key);
  });
  return [...allParcels, ...newReps];
}

/**
 * 검토 표에 올릴 목록 — 선정분 + 아직 선정되지 않은 적격 필지.
 *
 * 예전 키(`farmerId__parcelId`)는 경영체번호가 비면 `__100-1` 형태로 리를 넘어
 * 충돌했다. 그래서 **선정된 문단리 필지 때문에 미선정 법전리 필지가 "이미 선택됨"으로
 * 판정되어 대기 목록에서 빠졌다** — 사용자가 대체 필지를 고르려 해도 목록에 없었다.
 */
export function buildTableParcels(allParcels: Parcel[], selectedParcels: Parcel[]): Parcel[] {
  if (allParcels.length === 0) return selectedParcels;

  const eligible = allParcels.filter((p) => p.isEligible);
  const selectedKeys = new Set(
    selectedParcels.map(parcelMatchKey).filter((k): k is string => k !== null),
  );
  const unselected = eligible.filter((p) => {
    const key = parcelMatchKey(p);
    // 키가 없으면 "이미 선정됐는지" 알 수 없다 — 목록에서 빼지 않는다
    return key === null || !selectedKeys.has(key);
  });
  return [...selectedParcels, ...unselected];
}

/**
 * 지도에 올릴 선정 필지 — 좌표는 마스터 쪽에서, 분류는 결과 쪽에서 가져와 합친다.
 *
 * 좌표 때문에 합쳐진 배열을 소스로 써야 한다(지오코딩이 스토어의 필지만 갱신하고
 * 결과 배열은 건드리지 않는다). 그런데 그 배열은 중복 제거 때 **마스터 쪽 객체를
 * 남기고**, 마스터 행의 분류는 `'public-payment'`다. 대표필지 태깅(`'both'`)은
 * 결과 배열의 사본에만 붙어 있다.
 *
 * 그대로 두면 대표필지가 지도에서 초록 별이 아니라 파란 원으로 찍히고,
 * 팝업도 "공익직불제"로 나오며, 배지의 대표 수가 적게 세어진다.
 *
 * **충돌 봉쇄**: PNU가 없고 주소가 같은 두 필지는 정규 키로도 겹칠 수 있다.
 * 그때 나중 항목으로 덮어쓰면 공익직불제 필지가 대표필지 별로 찍히는데,
 * 대표필지는 반드시 조사해야 하는 고정 관측점이라 아닌 것을 그렇게 표시하는 쪽이
 * 놓치는 쪽보다 현장에 더 나쁜 신호다. 어느 쪽도 믿을 수 없으면 보정을 포기한다.
 */
export function buildMapSelectedParcels(
  allParcelsWithRep: Parcel[],
  selectedParcels: Parcel[],
): Parcel[] {
  const categoryByKey = new Map<string, ParcelCategory | undefined>();
  for (const p of selectedParcels) {
    const key = parcelMatchKey(p);
    if (key === null) continue;
    if (!categoryByKey.has(key)) categoryByKey.set(key, p.parcelCategory);
    else if (categoryByKey.get(key) !== p.parcelCategory) categoryByKey.set(key, undefined);
  }

  return allParcelsWithRep
    .filter((p) => {
      const key = parcelMatchKey(p);
      return key !== null && categoryByKey.has(key);
    })
    .map((p) => {
      const key = parcelMatchKey(p);
      const category = key !== null ? categoryByKey.get(key) : undefined;
      return category && category !== p.parcelCategory ? { ...p, parcelCategory: category } : p;
    });
}

/**
 * 이 필지가 선정되었는가.
 *
 * 예전에는 `p.farmerId === ... && p.parcelId === ...`로 비교했다. 경영체번호가 비면
 * 리를 넘어 충돌해 **마커 색은 회색인데 상세 패널만 "추출 선택"이라고 말했다.**
 * `grep`으로는 안 잡혔다 — 템플릿 문자열이 아니라 `===` 비교였기 때문이다.
 *
 * 키가 없으면 행 식별자로 판정한다. 결과 배열에는 사본이 담기므로 참조로는 안 된다.
 */
export function isParcelSelected(parcel: Parcel, selectedParcels: Parcel[]): boolean {
  const key = parcelMatchKey(parcel);
  if (key === null) return selectedParcels.some((p) => p.rowUid === parcel.rowUid);
  return selectedParcels.some((p) => parcelMatchKey(p) === key);
}

export interface MapLegendCounts {
  selected: number;
  representative: number;
  unselected: number;
  /** 연도 → 그 해에 채취된 필지 수. `MapLegend`가 연도로 찾아가므로 순서에 기대지 않는다 */
  sampledByYear: Record<number, number>;
  noCoords: number;
}

/**
 * 지도 범례의 분류별 개수.
 *
 * @param sampledYears 기채취 연도 두 개(최근순). 조사 연도에서 파생된 값이 들어온다.
 */
export function countMapLegend(
  allParcels: Parcel[],
  representativeParcels: Parcel[],
  selectedParcels: Parcel[],
  sampledYears: readonly [number, number],
): MapLegendCounts {
  const selectedKeys = new Set(
    selectedParcels.map(parcelMatchKey).filter((k): k is string => k !== null),
  );
  const repKeys = new Set(
    representativeParcels.map(parcelMatchKey).filter((k): k is string => k !== null),
  );

  let selected = 0;
  let representative = 0;
  let unselected = 0;
  let noCoords = 0;
  const sampledByYear: Record<number, number> = { [sampledYears[0]]: 0, [sampledYears[1]]: 0 };

  // 대표필지는 여기서 센다 (좌표 있는 것만)
  for (const p of representativeParcels) {
    if (p.coords) representative++;
    else noCoords++;
  }

  for (const p of allParcels) {
    const key = parcelMatchKey(p);
    if (key !== null && repKeys.has(key)) continue; // 대표필지는 위에서 처리했다
    if (!p.coords) {
      noCoords++;
    } else if (key !== null && selectedKeys.has(key)) {
      selected++;
    } else if (p.sampledYears.includes(sampledYears[0])) {
      sampledByYear[sampledYears[0]]++;
    } else if (p.sampledYears.includes(sampledYears[1])) {
      sampledByYear[sampledYears[1]]++;
    } else if (p.isEligible) {
      unselected++;
    }
  }

  return { selected, representative, unselected, sampledByYear, noCoords };
}
