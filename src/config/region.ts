/**
 * 조사 대상 지역 설정
 *
 * 봉화군 관련 상수가 pnuGenerator / kakaoGeocoder / mapUtils / useMapInit 네 곳에
 * 흩어져 있다. 새 상수를 더 만들지 않도록 지역 판정은 이 파일을 통해서 한다.
 * (전면 통합은 별도 티켓)
 */

export const TARGET_REGION = {
  name: '봉화군',
  sido: '경상북도',
  /** 법정동코드 앞 5자리 — PNU 접두 (경상북도 47 + 봉화군 920) */
  pnuPrefix: '47920',
} as const;

/** 지역 판정에 필요한 최소 필드 */
interface RegionFields {
  pnu?: string;
  sigungu?: string;
  address?: string;
}

/**
 * 조사 대상 지역(봉화군)의 필지인지 판정한다.
 *
 * 판정 순서는 신뢰도 순이다.
 *   1. PNU 접두 5자리 — 가장 확실하다
 *   2. 시군구 컬럼
 *   3. 필지주소 문자열
 *
 * 셋 다 판단 근거가 없으면 **제외하지 않는다**. 근거 없이 데이터를 버리는 것보다
 * 남겨두고 사용자가 리별 설정에서 조정하게 하는 편이 안전하다.
 */
export function isInTargetRegion(p: RegionFields): boolean {
  const pnu = (p.pnu ?? '').trim();
  if (pnu.length >= TARGET_REGION.pnuPrefix.length) {
    return pnu.startsWith(TARGET_REGION.pnuPrefix);
  }

  const sigungu = (p.sigungu ?? '').trim();
  if (sigungu) return sigungu.includes(TARGET_REGION.name);

  const address = (p.address ?? '').trim();
  if (address) return address.includes(TARGET_REGION.name);

  return true;
}

export interface RegionFilterResult<T> {
  kept: T[];
  excluded: T[];
  /** 제외된 필지의 시군구별 건수 (많은 순) */
  bySigungu: Array<{ sigungu: string; count: number }>;
}

/**
 * 조사 대상 지역 밖 필지를 걸러낸다. 제외 내역을 함께 돌려주어
 * 조용히 버려지지 않게 한다.
 */
export function filterToTargetRegion<T extends RegionFields>(
  parcels: T[],
): RegionFilterResult<T> {
  const kept: T[] = [];
  const excluded: T[] = [];

  for (const p of parcels) {
    if (isInTargetRegion(p)) kept.push(p);
    else excluded.push(p);
  }

  const counts = new Map<string, number>();
  for (const p of excluded) {
    const key = (p.sigungu ?? '').trim() || '(시군구 미상)';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return {
    kept,
    excluded,
    bySigungu: [...counts.entries()]
      .map(([sigungu, count]) => ({ sigungu, count }))
      .sort((a, b) => b.count - a.count),
  };
}
