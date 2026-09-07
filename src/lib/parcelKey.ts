import type { Parcel } from '../types';

/**
 * 필지 식별 키 — **여기 하나만 쓴다.**
 *
 * 예전에는 같은 공식이 네 곳에 복제돼 있었다(`extractionStore.matchKey`,
 * `extractionAlgorithm.matchesRepKeys`, `validateExtraction` 인라인,
 * `excelExporter.getParcelKey`). 한 곳만 바뀌면 조용히 어긋난다.
 */
export function parcelMatchKey(p: Parcel): string {
  return p.pnu || `${p.address}__${p.parcelId}`;
}

/**
 * 경영체번호 기반 보조 키.
 *
 * `ri`를 넣는 이유: `parcelId`는 지번(본번-부번)이라 **리를 넘어 고유하지 않다.**
 * 한 농가가 A리와 B리에 각각 지번 100-1을 가지면 둘이 같은 키가 되어, 그중 하나가
 * 대표필지일 때 나머지도 대표필지로 태깅된다. 그 태깅이 엑셀 시트를 가르고
 * 초과분 제거에서 보호까지 하므로 영향이 크다.
 *
 * 대표필지 파일에 경영체번호가 없을 수 있는데, 빈 값끼리 매칭시키면 무관한 필지가
 * 같은 필지로 취급되므로 키 자체를 만들지 않는다.
 *
 * 이 키만으로는 보호가 완성되지 않는다. `extractionStore`의 마스터 보충 매칭은 이 키가
 * 빗나가면 경영체번호+지번 폴백으로 내려가는데, 그 폴백도 리를 봐야 한다(거기서 본다).
 * 리 표기는 파일마다 다를 수 있어("봉화읍 내성리" / "내성리") 키는 원문 그대로 쓰고,
 * 폴백에서 마지막 토큰으로 느슨하게 비교한다.
 */
export function parcelFarmerKey(p: Parcel): string | null {
  return p.farmerId ? `${p.farmerId}_${p.ri}_${p.parcelId}` : null;
}
