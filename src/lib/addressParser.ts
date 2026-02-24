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
 * 주소에서 시도 추출
 * 예: "충청남도 아산시..." → "충청남도"
 * 예: "충남 아산시..." → "충남"
 */
export function parseSido(address: string): string {
  const match = address.match(/^([가-힣]+(?:도|시|특별시|광역시|특별자치시|특별자치도))/);
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

/**
 * 주소에서 본번/부번 추출
 * 예: "충남 아산시 염치읍 강청리 123-4" → { mainLotNum: "123", subLotNum: "4" }
 * 예: "충남 아산시 염치읍 강청리 산123-4" → { mainLotNum: "산123", subLotNum: "4" }
 * 예: "충남 아산시 염치읍 강청리 123" → { mainLotNum: "123", subLotNum: "" }
 */
export function parseLotNumber(address: string): { mainLotNum: string; subLotNum: string } {
  // 주소 끝부분에서 (산)숫자-숫자 또는 (산)숫자 패턴 추출
  const match = address.match(/(산?\d+)(?:-(\d+))?(?:\s*$)/);
  if (match) {
    return {
      mainLotNum: match[1],
      subLotNum: match[2] ?? '',
    };
  }
  return { mainLotNum: '', subLotNum: '' };
}

/**
 * 주소를 구성요소로 분해
 * 마스터 파일의 통합 주소를 읍면동/리/본번/부번으로 파싱
 */
export interface AddressComponents {
  sido: string;
  sigungu: string;
  eubmyeondong: string;
  ri: string;
  mainLotNum: string;
  subLotNum: string;
}

export function parseAddressComponents(address: string): AddressComponents {
  return {
    sido: parseSido(address),
    sigungu: parseSigungu(address),
    eubmyeondong: parseEubmyeondong(address),
    ri: parseRi(address),
    ...parseLotNumber(address),
  };
}

/**
 * 본번+부번 → 필지번호 문자열 생성
 * 예: ("123", "4") → "123-4"
 * 예: ("123", "") → "123"
 * 예: ("123", "0") → "123"
 */
export function buildParcelId(mainLotNum: string, subLotNum: string): string {
  const main = mainLotNum.trim();
  const sub = subLotNum.trim();
  if (!main) return '';
  if (!sub || sub === '0') return main;
  return `${main}-${sub}`;
}
