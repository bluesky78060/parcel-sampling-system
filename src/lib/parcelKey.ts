import type { Parcel } from '../types';

/**
 * 필지 식별 키 — **여기 하나만 쓴다.**
 *
 * 예전에는 같은 공식이 네 곳에 복제돼 있었다(`extractionStore.matchKey`,
 * `extractionAlgorithm.matchesRepKeys`, `validateExtraction` 인라인,
 * `excelExporter.getParcelKey`). 한 곳만 바뀌면 조용히 어긋난다.
 *
 * **식별 불가능한 필지에는 `null`을 돌려준다.** 호출부는 용도에 따라 다르게 다뤄야 한다.
 * - Set 구축: 넣지 않는다
 * - Set 조회: `false`로 본다
 * - dedupe: **접지 않고 각각 남긴다** — 빈 키끼리 같은 필지로 볼 근거가 없다
 * - 삭제·선택: 키가 없으면 `rowUid`(행 식별자)로 비교한다 — 참조는 사본에서 끊긴다
 */
export function parcelMatchKey(p: Parcel): string | null {
  if (p.pnu) return p.pnu;
  // PNU도 주소도 지번도 없으면 이 필지를 식별할 방법이 없다.
  // 예전에는 `'__'`라는 키를 만들어 돌려줬는데, 그러면 식별 불가능한 필지들이
  // 전부 **같은 필지**로 취급된다. 대표필지 태깅이 번지고, dedupe가 한 건으로 접고,
  // 삭제가 무관한 행까지 지운다. 형제 함수 `parcelFarmerKey`가 같은 이유로
  // `null`을 돌려주는데 이쪽만 방치돼 있었다.
  if (!p.address && !p.parcelId) return null;
  return `${p.address}__${p.parcelId}`;
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

/**
 * 이 필지의 농가가 식별되는가.
 *
 * 마스터 파일이라고 경영체번호가 항상 있는 것은 아니다. `ColumnMapper`가 요구하는 것은
 * **컬럼의 매핑**이지 행마다 값이 있다는 보장이 아니고, `excelParser`는 빈 셀을 `''`로
 * 만든 뒤 그 행을 걸러내지 않는다. 따라서 `farmerId === ''`인 필지가 실제로 생긴다.
 *
 * 빈 값은 "같은 농가"가 아니라 **"농가 미상"**이다. 이 둘을 구분하지 않으면
 * 농가당 상한이 서로 무관한 필지 전체에 한꺼번에 걸린다.
 */
export function hasFarmerId(p: Parcel): boolean {
  // `!!`로 판정한다 — `farmerGroupKey`의 `||`와 정확히 같은 기준이다.
  // `!== ''`로 두면 `undefined`에서 둘이 갈려(여기선 "식별됨", 저기선 "미상")
  // 이 파일이 고친 결함이 키 이름만 바꿔 되살아난다.
  // (`normalizeId('000')`이 `'0'`이라 truthy이므로 기존 동작은 그대로다.)
  return !!p.farmerId;
}

/**
 * 농가별 그룹핑 키.
 *
 * 경영체번호가 비면 `__nofarmer_{index}` 키를 준다. 그러지 않으면 `farmerGroups['']`에
 * 농가 미상 필지가 전부 들어가고, `slice(0, maxPerFarmer)`가 그중 두어 건만 남긴다 —
 * 서로 아무 관계도 없는 필지 수십 건이 한꺼번에 후보에서 사라진다.
 *
 * **인덱스는 `groupBy`에 넘긴 배열 안의 위치다. 따라서 이 키는 한 번의 `groupBy` 호출
 * 안에서만 고유하다 — 호출을 가로질러 비교하면 안 된다.** A리의 `__nofarmer_0`과
 * B리의 `__nofarmer_0`은 같은 문자열이다. 현재 호출부(`extractFromRi`)는 리별 배열로
 * 호출하고 결과를 즉시 소비하므로 안전하지만, 두 호출의 그룹 키를 한 `Set`에 모으면
 * 조용히 어긋난다.
 *
 * 경영체번호는 `normalizeId`를 거친 숫자 문자열이라 `__nofarmer_` 접두사와 겹치지 않는다.
 * (다만 그 함수가 문자 종류를 강제하지는 않는다 — 실무상 위험은 무시할 수준이다.)
 */
export function farmerGroupKey(p: Parcel, index: number): string {
  return p.farmerId || `__nofarmer_${index}`;
}

/**
 * 고유 필지 수.
 *
 * 식별 불가능한 필지(키가 `null`)를 어떻게 셀지는 **묻는 질문에 따라 다르다.**
 * 한 함수를 복사해 쓰면 그 차이가 조용히 사라진다.
 *
 * - `'each'` — **결과 집계.** 그 행들은 실제로 엑셀에 나가므로 각각 1건이다
 * - `'exclude'` — **달성 가능성 판정.** 식별 불가능한 필지는 `ri`가 비어 리 그룹에
 *   들어가지 못하고 지오코딩도 안 되며 현장 지시서로 쓸 수 없다. 가용 재고로 세면
 *   "달성 가능"이 낙관 쪽으로 기울어, 분석 화면에서 가능하다고 보고 진행했다가
 *   추출 후에야 미달을 만난다
 */
export function countUniqueParcels(
  parcels: Parcel[],
  unidentified: 'each' | 'exclude',
): number {
  const keys = new Set<string>();
  let unidentifiedCount = 0;
  for (const p of parcels) {
    const key = parcelMatchKey(p);
    if (key === null) unidentifiedCount++;
    else keys.add(key);
  }
  return keys.size + (unidentified === 'each' ? unidentifiedCount : 0);
}

/**
 * 행 식별자를 만든다.
 *
 * `crypto.randomUUID()`는 **보안 컨텍스트(HTTPS·localhost)에서만** 있다.
 * 이 앱은 GitHub Pages(HTTPS)와 dev 서버(localhost)에서만 도므로 정상 경로에서는
 * 항상 쓸 수 있지만, 없을 때 조용히 터지면 파싱 전체가 멈추므로 폴백을 둔다.
 *
 * 폴백의 충돌 확률은 한 파일(4만 행) 안에서 무시할 수준이고, 이 값은 세션 안에서만
 * 쓰이므로 전역 유일성도 필요 없다.
 */
export function newRowUid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}
