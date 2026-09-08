import type { Parcel, ParcelCategory } from '../types';

/**
 * 필지 분류 판정 — **여기를 거쳐서만 판정한다.**
 *
 * `parcelCategory === 'representative'`로 직접 비교하면 `'both'`(공익 추출에도 뽑힌
 * 대표필지)를 놓친다. 그 실수가 지도 색상·엑셀 시트·드롭 보호에 각각 다르게 나타나
 * 원인을 찾기 어렵다.
 */
const categoryOf = (p: Parcel): ParcelCategory => p.parcelCategory ?? 'public-payment';

/** 대표필지인가 (공익 추출에도 뽑힌 경우 포함) */
export function isRepresentative(p: Parcel): boolean {
  return categoryOf(p) !== 'public-payment';
}

/** 공익직불제 추출로 뽑힌 필지인가 (대표필지를 겸하는 경우 포함) */
export function isPublicPayment(p: Parcel): boolean {
  return categoryOf(p) !== 'representative';
}

/**
 * 기존 카테고리에 "대표필지" 성격을 더한다.
 * 공익 추출분이면 `'both'`가 되고, 이미 대표필지면 그대로다.
 */
export function markAsRepresentative(cat: ParcelCategory | undefined): ParcelCategory {
  return (cat ?? 'public-payment') === 'public-payment' ? 'both' : (cat ?? 'representative');
}

/** 엑셀 '구분' 컬럼 표기 */
export function categoryLabel(p: Parcel): string {
  const cat = categoryOf(p);
  if (cat === 'both') return '공익직불제·대표필지';
  return cat === 'representative' ? '대표필지' : '공익직불제';
}

/**
 * 대표필지로 확정된 필지의 분류.
 *
 * **경영체번호가 있으면 공익직불제와 혼용된다** — 그 필지는 공익직불제 대상이기도
 * 하므로 양쪽 시트에 모두 실려야 한다. 번호가 없으면 공익직불제 대상이 아니므로
 * 대표필지 시트에만 남는다.
 *
 * 예전에는 `parcelCategory: 'representative'`로 **무조건 덮어썼다.** 그러면
 * `isPublicPayment`가 false가 되어 공익직불제 시트(`{연도}_필지선정`)에서 사라지고,
 * **담당자에게 나가는 제출 파일의 행 수가 조용히 줄어든다.** 공익 추출에도 뽑힌
 * 대표필지(`taggedPublic`)에는 이 위험이 이미 주석으로 적혀 있었는데,
 * 안 뽑힌 쪽(`repDirect`)과 대체 보충분(`repSupplements`)에만 빠져 있었다.
 */
export function representativeCategoryOf(p: Parcel): ParcelCategory {
  return p.farmerId ? 'both' : 'representative';
}
