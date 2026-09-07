import { describe, expect, it } from 'vitest';
import { detectIsSan, mergeAddress, parseLotNumber } from '../addressMerger';

/**
 * 주의 — `parseLotNumber`라는 이름이 `addressParser`에도 있고 **동작이 다르다**.
 * 이쪽은 셀 값 하나를 정수로 바꾸고, 저쪽은 주소 문자열에서 본번·부번을 뽑는다.
 * PROJ1-1-10에 정리 대상으로 기록돼 있다.
 */
describe('parseLotNumber (셀 값 → 정수)', () => {
  it('선행 0을 뗀다', () => {
    expect(parseLotNumber('0402')).toBe(402);
  });

  it('빈 값·null·undefined는 0이다', () => {
    expect(parseLotNumber('')).toBe(0);
    expect(parseLotNumber('   ')).toBe(0);
    expect(parseLotNumber(null)).toBe(0);
    expect(parseLotNumber(undefined)).toBe(0);
  });

  it('엑셀이 숫자로 준 값도 받는다', () => {
    expect(parseLotNumber(402)).toBe(402);
  });

  it('소수점은 버린다 (엑셀 부동소수 잔재)', () => {
    expect(parseLotNumber(402.0)).toBe(402);
    expect(parseLotNumber('402.9')).toBe(402);
  });

  it('산 접두사를 떼고 숫자만 본다', () => {
    expect(parseLotNumber('산402')).toBe(402);
  });

  it('숫자가 없으면 0이다', () => {
    expect(parseLotNumber('산')).toBe(0);
    expect(parseLotNumber('없음')).toBe(0);
  });
});

describe('detectIsSan', () => {
  it('주소 안의 산 + 숫자를 잡는다', () => {
    expect(detectIsSan('경상북도 봉화군 봉화읍 적덕리 산 56', '')).toBe(true);
    expect(detectIsSan('경상북도 봉화군 봉화읍 적덕리 산56', '')).toBe(true);
  });

  it('본번이 산으로 시작해도 잡는다', () => {
    expect(detectIsSan('', '산56')).toBe(true);
    expect(detectIsSan('', '산 56')).toBe(true);
  });

  it('산이 없으면 false다', () => {
    expect(detectIsSan('경상북도 봉화군 봉화읍 적덕리 56', '56')).toBe(false);
    expect(detectIsSan('', '')).toBe(false);
  });

  /**
   * 리 이름에 '산'이 들어가도 뒤에 숫자가 붙지 않으므로 오탐하지 않아야 한다.
   * (봉화군에는 없지만 다른 시군으로 확장하면 '산정리' 같은 이름이 나온다)
   */
  it('리 이름 속의 산은 오탐하지 않는다', () => {
    expect(detectIsSan('경상북도 어느군 어느면 산정리 56', '56')).toBe(false);
  });
});

describe('mergeAddress', () => {
  it('분리 컬럼을 하나의 필지 주소로 합친다', () => {
    expect(
      mergeAddress({
        sido: '경상북도',
        sigungu: '봉화군',
        eubmyeondong: '봉화읍',
        ri: '적덕리',
        mainLotNum: '402',
        subLotNum: '1',
      }),
    ).toBe('경상북도 봉화군 봉화읍 적덕리 402-1');
  });

  it('부번이 0이거나 없으면 본번만 쓴다', () => {
    const base = {
      sido: '경상북도',
      sigungu: '봉화군',
      eubmyeondong: '봉화읍',
      ri: '적덕리',
      mainLotNum: '402',
    };
    expect(mergeAddress({ ...base, subLotNum: '0' })).toBe('경상북도 봉화군 봉화읍 적덕리 402');
    expect(mergeAddress({ ...base, subLotNum: '0000' })).toBe('경상북도 봉화군 봉화읍 적덕리 402');
    expect(mergeAddress({ ...base, subLotNum: '' })).toBe('경상북도 봉화군 봉화읍 적덕리 402');
  });

  it('0패딩 셀에서도 정상 지번을 만든다', () => {
    expect(
      mergeAddress({
        sido: '경상북도',
        sigungu: '봉화군',
        eubmyeondong: '상운면',
        ri: '운계리',
        mainLotNum: '0165',
        subLotNum: '0001',
      }),
    ).toBe('경상북도 봉화군 상운면 운계리 165-1');
  });

  it('산 번지는 리 뒤에 산을 넣는다', () => {
    expect(
      mergeAddress({
        sido: '경상북도',
        sigungu: '봉화군',
        eubmyeondong: '봉화읍',
        ri: '적덕리',
        mainLotNum: '56',
        subLotNum: '',
        isSan: true,
      }),
    ).toBe('경상북도 봉화군 봉화읍 적덕리 산 56');
  });

  it('빈 파트는 건너뛴다', () => {
    expect(
      mergeAddress({
        sido: '',
        sigungu: '',
        eubmyeondong: '봉화읍',
        ri: '적덕리',
        mainLotNum: '402',
        subLotNum: '',
      }),
    ).toBe('봉화읍 적덕리 402');
  });

  /**
   * 본번이 비면 지번이 `0`이 된다 — 주소가 `… 적덕리 0`으로 끝난다.
   * 지오코딩이 그 주소로 리 대표점을 돌려주거나 NOT_FOUND가 난다.
   * 호출부가 본번 없는 행을 걸러야 한다는 뜻이고, 지금 그 가드는 없다.
   */
  it('본번이 없으면 지번 0이 붙는다 (호출부가 걸러야 함)', () => {
    expect(
      mergeAddress({
        sido: '',
        sigungu: '',
        eubmyeondong: '봉화읍',
        ri: '적덕리',
        mainLotNum: '',
        subLotNum: '',
      }),
    ).toBe('봉화읍 적덕리 0');
  });
});
