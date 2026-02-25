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
 * 2026 마스터 - 2024 기채취 - 2025 기채취 = 추출 대상
 */
export function findDuplicates(
  masterParcels: Parcel[],
  sampled2024: Parcel[],
  sampled2025: Parcel[]
): DuplicateResult {
  const keys2024 = buildSampledKeySets(sampled2024);
  const keys2025 = buildSampledKeySets(sampled2025);

  console.log(
    '[중복감지] 마스터:', masterParcels.length,
    '| 2024 PNU:', keys2024.pnuSet.size, 'ADDR:', keys2024.addrSet.size,
    '| 2025 PNU:', keys2025.pnuSet.size, 'ADDR:', keys2025.addrSet.size
  );

  const duplicateKeys2024 = new Set<string>();
  const duplicateKeys2025 = new Set<string>();
  let eligibleCount = 0;

  for (const parcel of masterParcels) {
    const trackingKey = getDuplicateKey(parcel);
    const is2024 = isMatched(parcel, keys2024);
    const is2025 = isMatched(parcel, keys2025);

    if (is2024 && trackingKey) duplicateKeys2024.add(trackingKey);
    if (is2025 && trackingKey) duplicateKeys2025.add(trackingKey);
    if (!is2024 && !is2025) eligibleCount++;
  }

  console.log(
    '[중복감지] 2024 중복:', duplicateKeys2024.size,
    '| 2025 중복:', duplicateKeys2025.size,
    '| 추출가능:', eligibleCount
  );

  return {
    duplicateKeys2024,
    duplicateKeys2025,
    duplicateCount2024: duplicateKeys2024.size,
    duplicateCount2025: duplicateKeys2025.size,
    eligibleCount,
  };
}

/**
 * 마스터 필지에 추출 가능 여부를 마킹
 */
export function markEligibility(
  masterParcels: Parcel[],
  sampled2024: Parcel[],
  sampled2025: Parcel[]
): Parcel[] {
  const result = findDuplicates(masterParcels, sampled2024, sampled2025);
  const allDuplicateKeys = new Set([...result.duplicateKeys2024, ...result.duplicateKeys2025]);

  return masterParcels.map(parcel => {
    const key = getDuplicateKey(parcel);
    const is2024 = result.duplicateKeys2024.has(key);
    const is2025 = result.duplicateKeys2025.has(key);
    const sampledYears: number[] = [];
    if (is2024) sampledYears.push(2024);
    if (is2025) sampledYears.push(2025);

    return {
      ...parcel,
      isEligible: !allDuplicateKeys.has(key),
      sampledYears,
    };
  });
}
