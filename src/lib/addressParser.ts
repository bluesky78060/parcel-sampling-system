/**
 * 주소에서 리(里) 추출
 * - 패턴: '~리' (예: '충청남도 아산시 염치읍 강청리 123')
 * - 리가 없는 경우 읍면동 사용
 */
export function parseRi(address: string): string {
  const riMatch = address.match(/([가-힣]+리)(?:\s|$|\d)/);
  if (riMatch) return riMatch[1];

  const dongMatch = address.match(/([가-힣]+동|[가-힣]+읍|[가-힣]+면)(?:\s|$|\d)/);
  return dongMatch ? dongMatch[1] : '미분류';
}

/**
 * 주소에서 시군구 추출
 */
export function parseSigungu(address: string): string {
  const match = address.match(/([가-힣]+(?:시|군|구))(?:\s)/);
  return match ? match[1] : '';
}

/**
 * 주소에서 읍면동 추출
 */
export function parseEubmyeondong(address: string): string {
  const match = address.match(/([가-힣]+(?:읍|면|동))(?:\s)/);
  return match ? match[1] : '';
}

/**
 * 주소 정규화 (비교용)
 * - 공백 제거
 * - 특수문자 제거
 * - 한글/영숫자만 유지
 */
export function normalizeAddress(address: string): string {
  return address.replace(/\s+/g, '').replace(/[^\w가-힣]/g, '');
}

/**
 * 주소 유사도 비교 (정규화 후 동일 여부)
 */
export function isSameAddress(addr1: string, addr2: string): boolean {
  return normalizeAddress(addr1) === normalizeAddress(addr2);
}
