/**
 * addressMerger.ts
 *
 * 분리된 주소 컬럼(시도·시군구·읍면동·리·본번·부번)을 하나의 필지 주소로 합칩니다.
 * korea-parcel-tools 스킬의 make_pilji_addr 로직을 TypeScript로 변환한 구현입니다.
 *
 * 형식: {시도} {시군구} {읍면동} {리} [산] {지번}
 * 지번: 부번이 0 또는 없음 → 본번만 ("402"), 부번이 있음 → "402-1"
 */

export interface AddressMergeInput {
  sido: string;
  sigungu: string;
  eubmyeondong: string;
  ri: string;
  mainLotNum: string | number | null | undefined;
  subLotNum: string | number | null | undefined;
  isSan?: boolean;
}

/**
 * 본번/부번 셀 값을 정수로 변환합니다.
 * - null/undefined/빈 문자열 → 0
 * - '0402' → 402 (선행 0 제거)
 * - 소수점 포함 (엑셀 숫자) → 정수 변환
 */
export function parseLotNumber(val: string | number | null | undefined): number {
  if (val == null) return 0;
  const str = String(val).trim();
  if (str === '') return 0;

  // "산402" 같은 접두사 제거 후 숫자 추출
  const numericStr = str.replace(/^산/, '').replace(/[^0-9.]/g, '');
  if (numericStr === '') return 0;

  const parsed = parseFloat(numericStr);
  return isNaN(parsed) ? 0 : Math.floor(parsed);
}

/**
 * 산 번지 여부를 감지합니다.
 * - 주소 문자열에 "산" + 숫자 패턴 포함
 * - 본번 값이 "산"으로 시작
 */
export function detectIsSan(addressVal: string, mainLotVal: string | number | null | undefined): boolean {
  const addrStr = addressVal ?? '';
  const mainStr = String(mainLotVal ?? '').trim();
  return (
    /\s산\s?\d/.test(addrStr) ||
    /[^가-힣]산\s?\d/.test(addrStr) ||
    /^산\s?\d/.test(addrStr) ||
    /^산/.test(mainStr)
  );
}

/**
 * 분리된 주소 컬럼을 하나의 필지 주소 문자열로 합칩니다.
 *
 * 반환값 예시:
 * - "경상북도 봉화군 봉화읍 적덕리 402"
 * - "경상북도 봉화군 봉화읍 적덕리 402-1"
 * - "경상북도 봉화군 봉화읍 적덕리 산 56"
 */
export function mergeAddress(input: AddressMergeInput): string {
  const { sido, sigungu, eubmyeondong, ri, mainLotNum, subLotNum, isSan } = input;

  const mainNum = parseLotNumber(mainLotNum);
  const subNum = parseLotNumber(subLotNum);

  // 지번 조합
  const jibun = subNum > 0 ? `${mainNum}-${subNum}` : `${mainNum}`;

  // 주소 파트 조합 (빈 값 제외)
  const parts: string[] = [];

  if (sido) parts.push(sido.trim());
  if (sigungu) parts.push(sigungu.trim());
  if (eubmyeondong) parts.push(eubmyeondong.trim());
  if (ri) parts.push(ri.trim());

  // 산 번지 처리: 리 뒤에 "산" 삽입
  if (isSan) parts.push('산');

  parts.push(jibun);

  return parts.join(' ');
}
