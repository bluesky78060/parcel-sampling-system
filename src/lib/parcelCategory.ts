import type { Parcel, ParcelCategory } from '../types';
import { hasFarmerId } from './parcelKey';

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
 *
 * **경영체번호를 보지 않는다.** 번호 기준을 적용하는 쪽은 `representativeCategoryOf`다.
 *
 * **호출부는 둘이고, 근거가 서로 다르다.** 결론(번호를 안 본다)만 같다.
 *
 *  1. `extractionStore`의 `taggedPublic` — 공익직불제 추출이 **실제로 뽑은** 행이라
 *     번호가 비어도 이미 700 안에 들어가 있다. 여기서 빼면 제출 파일의 행 수가 줄어든다.
 *  2. `reviewSelectors.mergeWithRepresentatives` — 대표필지와 겹치는 **마스터 파일 행**.
 *     마스터 행은 정의상 공익직불제 신청 필지이므로 번호와 무관하게 `'both'`가 맞다.
 *     이쪽은 **표시 전용**이다 — 태깅된 배열은 지도 두 경로 밖으로 나가지 않아
 *     엑셀 내보내기·추출 알고리즘·스토어에 도달하지 않는다.
 *
 * 호출부를 세어 근거를 다는 형태의 주석이다. 호출부가 늘면 **반드시 여기를 갱신할 것.**
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
 * **공익 추출에 뽑히지 않은** 대표필지의 분류 — `repDirect`와 `repSupplements` 전용.
 *
 * 경영체번호가 있으면 공익직불제와 혼용된다. 그 필지는 공익직불제 대상이기도 하므로
 * 양쪽 시트에 모두 실려야 한다. 번호가 없으면 공익직불제 대상이 아니라 대표필지
 * 시트에만 남는다.
 *
 * 예전에는 `parcelCategory: 'representative'`로 **무조건 덮어썼다.** 그러면
 * `isPublicPayment`가 false가 되어 공익직불제 시트(`{연도}_필지선정`)에서 사라지고,
 * **담당자에게 나가는 제출 파일의 행 수가 조용히 줄어든다.**
 *
 * ⚠️ **`taggedPublic`에는 이 함수를 쓰지 않는다 — 의도된 예외다.**
 * `taggedPublic`은 공익직불제 추출이 **실제로 뽑은** 행이다. 번호가 비어 있어도
 * 이미 700 안에 들어간 것이므로 공익직불제 시트에 있는 것이 맞다(빼면 제출 파일의
 * 행 수가 줄어든다). 번호가 빈 것은 `FARMER_ID_MISSING` 경고가 따로 알린다.
 * 그쪽은 `markAsRepresentative`가 담당하고, 번호를 보지 않는다.
 *
 * "경로를 통일한다"며 `taggedPublic`을 여기로 옮기면 **이 함수가 막으려던 결함이
 * 정확히 그 자리에서 되살아난다.** 사용자 결정(2026-09-08)으로 현행을 확정했다.
 * (`markAsRepresentative` 쪽 호출부가 둘로 늘었다 — 그쪽 doc 참조.)
 */
export function representativeCategoryOf(p: Parcel): ParcelCategory {
  return hasFarmerId(p) ? 'both' : 'representative';
}
