import type { Parcel, DuplicateResult } from '../types';
import { normalizeAddress } from './addressParser';

/**
 * 필지의 중복 키 생성 (우선순위: farmerId+parcelId > 정규화주소)
 */
export function getDuplicateKey(parcel: Parcel): string {
  if (parcel.farmerId && parcel.parcelId) {
    return `${parcel.farmerId}_${parcel.parcelId}`;
  }
  return normalizeAddress(parcel.address);
}

/**
 * 보조 중복 키 생성 (농가번호 + 정규화주소)
 */
function getSecondaryKey(parcel: Parcel): string {
  return `${parcel.farmerId}_${normalizeAddress(parcel.address)}`;
}

/**
 * 중복 필지 감지
 * - 마스터 파일과 2024/2025 채취 파일을 비교
 * - 3단계 매칭: 1순위(ID조합), 2순위(정규화주소), 3순위(농가+주소)
 */
export function findDuplicates(
  masterParcels: Parcel[],
  sampled2024: Parcel[],
  sampled2025: Parcel[]
): DuplicateResult {
  // 2024년 키셋 구축
  const keys2024 = new Set<string>();
  const secondaryKeys2024 = new Set<string>();
  for (const p of sampled2024) {
    keys2024.add(getDuplicateKey(p));
    secondaryKeys2024.add(getSecondaryKey(p));
  }

  // 2025년 키셋 구축
  const keys2025 = new Set<string>();
  const secondaryKeys2025 = new Set<string>();
  for (const p of sampled2025) {
    keys2025.add(getDuplicateKey(p));
    secondaryKeys2025.add(getSecondaryKey(p));
  }

  const duplicateKeys2024 = new Set<string>();
  const duplicateKeys2025 = new Set<string>();
  let eligibleCount = 0;

  for (const parcel of masterParcels) {
    const primaryKey = getDuplicateKey(parcel);
    const secondaryKey = getSecondaryKey(parcel);

    const is2024 = keys2024.has(primaryKey) || secondaryKeys2024.has(secondaryKey);
    const is2025 = keys2025.has(primaryKey) || secondaryKeys2025.has(secondaryKey);

    if (is2024) duplicateKeys2024.add(primaryKey);
    if (is2025) duplicateKeys2025.add(primaryKey);
    if (!is2024 && !is2025) eligibleCount++;
  }

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
