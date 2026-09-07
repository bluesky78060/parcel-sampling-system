import type { Parcel, DuplicateResult } from '../types';
import { normalizeAddress } from './addressParser';

/**
 * 마스터 필지의 내부 추적 키 (PNU 우선, 필지주소 폴백)
 */
export function getDuplicateKey(parcel: Parcel): string {
  if (parcel.pnu) return `pnu:${parcel.pnu}`;
  if (parcel.address) return `addr:${normalizeAddress(parcel.address)}`;
  return '';
}

/**
 * 기채취 키셋 구축 (PNU 셋 + 필지주소 셋 분리)
 */
function buildSampledKeySets(parcels: Parcel[]) {
  const pnuSet = new Set<string>();
  const addrSet = new Set<string>();
  for (const p of parcels) {
    if (p.pnu) pnuSet.add(p.pnu);
    if (p.address) addrSet.add(normalizeAddress(p.address));
  }
  return { pnuSet, addrSet };
}

/**
 * 마스터 필지가 기채취 셋에 매칭되는지 확인
 * PNU가 있으면 PNU로, 없으면 필지주소로 비교
 */
function isMatched(
  parcel: Parcel,
  sampledKeys: { pnuSet: Set<string>; addrSet: Set<string> }
): boolean {
  if (parcel.pnu && sampledKeys.pnuSet.has(parcel.pnu)) return true;
  if (parcel.address) {
    return sampledKeys.addrSet.has(normalizeAddress(parcel.address));
  }
  return false;
}

/**
 * 중복 필지 감지 (PNU 우선, farmerId+parcelId 폴백)
 *
 * 마스터 − 기채취 연도들 = 추출 대상.
 *
 * 연도를 인자 이름에 박지 않는다. 예전에는 `sampled2024`/`sampled2025` 두 개로
 * 고정돼 있어서, 다음 해 조사로 넘어가려면 이 함수와 호출부를 함께 고쳐야 했다.
 *
 * @param sampledByYear 연도 → 그 해에 채취된 필지 목록
 */
export function findDuplicates(
  masterParcels: Parcel[],
  sampledByYear: Record<number, Parcel[]>
): DuplicateResult {
  const years = Object.keys(sampledByYear).map(Number).sort((a, b) => b - a);
  const keySetsByYear = new Map(years.map(y => [y, buildSampledKeySets(sampledByYear[y])]));

  console.log(
    '[중복감지] 마스터:', masterParcels.length,
    ...years.flatMap(y => {
      const k = keySetsByYear.get(y)!;
      return [`| ${y} PNU:`, k.pnuSet.size, 'ADDR:', k.addrSet.size];
    })
  );

  const duplicateKeysByYear: Record<number, Set<string>> = {};
  for (const y of years) duplicateKeysByYear[y] = new Set<string>();
  let eligibleCount = 0;

  for (const parcel of masterParcels) {
    const trackingKey = getDuplicateKey(parcel);
    let matchedAny = false;
    for (const y of years) {
      if (isMatched(parcel, keySetsByYear.get(y)!)) {
        matchedAny = true;
        if (trackingKey) duplicateKeysByYear[y].add(trackingKey);
      }
    }
    if (!matchedAny) eligibleCount++;
  }

  const duplicateCountByYear: Record<number, number> = {};
  for (const y of years) duplicateCountByYear[y] = duplicateKeysByYear[y].size;

  console.log(
    '[중복감지]',
    ...years.flatMap(y => [`${y} 중복:`, duplicateCountByYear[y], '|']),
    '추출가능:', eligibleCount
  );

  return { duplicateKeysByYear, duplicateCountByYear, eligibleCount };
}

/**
 * 마스터 필지에 추출 가능 여부를 마킹
 */
export function markEligibility(
  masterParcels: Parcel[],
  sampledByYear: Record<number, Parcel[]>
): Parcel[] {
  const result = findDuplicates(masterParcels, sampledByYear);
  // 필지에 붙는 채취이력은 시간순(오름차순)이다. 엑셀 '채취이력'·'채취연도' 컬럼과
  // 지도 팝업이 이 배열을 그대로 join하므로, 연도를 일반화하기 전의 산출물
  // ("2024, 2025")과 같은 모양을 유지한다. findDuplicates의 내림차순은 로그용일 뿐이다.
  const years = Object.keys(result.duplicateKeysByYear).map(Number).sort((a, b) => a - b);
  const allDuplicateKeys = new Set(years.flatMap(y => [...result.duplicateKeysByYear[y]]));

  return masterParcels.map(parcel => {
    const key = getDuplicateKey(parcel);
    const sampledYears = years.filter(y => result.duplicateKeysByYear[y].has(key));

    return {
      ...parcel,
      isEligible: !allDuplicateKeys.has(key),
      sampledYears,
    };
  });
}
