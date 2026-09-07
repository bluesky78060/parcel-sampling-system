import { describe, expect, it } from 'vitest';
import { generatePnu, generatePnuForParcels, getRegisteredRis, riCodePrefix } from '../pnuGenerator';

/**
 * PNU 19자리 구조:
 *   [시도 2][시군구 3][읍면동 3][리 2][산여부 1][본번 4][부번 4]
 *
 * **이 표가 틀리면 다른 리의 필지 좌표를 가져온다.** 좌표 검증은 봉화군 전체를
 * 통과시키므로 걸러지지 않고 지도에 조용히 엉뚱한 곳이 찍힌다 — PROJ1-1-28이
 * 정확히 그 사고였다(소천면 신라리 → 실제로는 서천리).
 */
describe('generatePnu', () => {
  it('19자리 PNU를 만든다', () => {
    const pnu = generatePnu({
      eubmyeondong: '봉화읍',
      ri: '내성리',
      mainLotNum: '402',
      subLotNum: '1',
    });
    expect(pnu).toHaveLength(19);
    // 47(경북) 920(봉화군) 250(봉화읍) 31(내성리) 1(일반) 0402(본번) 0001(부번)
    expect(pnu).toBe('4792025031' + '1' + '0402' + '0001');
  });

  it('본번·부번의 선행 0을 흡수한다', () => {
    const padded = generatePnu({
      eubmyeondong: '봉화읍',
      ri: '내성리',
      mainLotNum: '0402',
      subLotNum: '0001',
    });
    const plain = generatePnu({
      eubmyeondong: '봉화읍',
      ri: '내성리',
      mainLotNum: '402',
      subLotNum: '1',
    });
    expect(padded).toBe(plain);
  });

  it('부번이 없으면 0000으로 채운다', () => {
    expect(
      generatePnu({ eubmyeondong: '봉화읍', ri: '내성리', mainLotNum: '402', subLotNum: '' }),
    ).toBe('4792025031' + '1' + '0402' + '0000');
  });

  it('산 번지는 산여부 자리가 2다', () => {
    const san = generatePnu({
      eubmyeondong: '봉화읍',
      ri: '적덕리',
      mainLotNum: '56',
      subLotNum: '',
      isSan: true,
    });
    expect(san[10]).toBe('2');
    const normal = generatePnu({
      eubmyeondong: '봉화읍',
      ri: '적덕리',
      mainLotNum: '56',
      subLotNum: '',
    });
    expect(normal[10]).toBe('1');
  });

  it('앞뒤 공백이 있어도 매핑을 찾는다', () => {
    expect(
      generatePnu({ eubmyeondong: ' 봉화읍 ', ri: ' 내성리 ', mainLotNum: '402', subLotNum: '1' }),
    ).toHaveLength(19);
  });

  /**
   * 매핑에 없으면 조용히 빈 문자열을 돌려준다. 그러면 Phase 0(PNU 일괄 조회)를
   * 건너뛰고 주소 지오코딩 폴백을 타는데, 그것은 필지 기하 중심이 아니라
   * 지번 대표점이라 정확도가 떨어진다. PROJ1-1-28에서 누락 2건이 이 경로로 샜다.
   */
  it('매핑에 없는 읍면·리는 빈 문자열이다', () => {
    expect(generatePnu({ eubmyeondong: '없는면', ri: '없는리', mainLotNum: '1', subLotNum: '' })).toBe('');
  });

  it('숫자가 아닌 본번은 0으로 본다', () => {
    expect(
      generatePnu({ eubmyeondong: '봉화읍', ri: '내성리', mainLotNum: 'None', subLotNum: 'nan' }),
    ).toBe('4792025031' + '1' + '0000' + '0000');
  });
});

/**
 * PROJ1-1-28에서 실측으로 고친 3건. 이 표는 사람이 손으로 채우는 값이라 또 틀린다.
 * VWorld 연속지적도 전수 스캔(`scripts/verify-eumri-map.mjs`)이 본 검증이고,
 * 여기서는 그때 확인된 값이 되돌려지지 않았는지만 못박는다.
 */
describe('EUMRI_MAP — PROJ1-1-28 실측 정정분 고정', () => {
  it('소천면 서천리는 4792035025다 (신라리가 아니다)', () => {
    expect(riCodePrefix('소천면', '서천리')).toBe('4792035025');
  });

  it('소천면에 신라리는 존재하지 않는다', () => {
    expect(() => riCodePrefix('소천면', '신라리')).toThrow();
  });

  it('신라리는 상운면에만 있다', () => {
    expect(riCodePrefix('상운면', '신라리')).toBe('4792038028');
  });

  it('PROJ1-1-28에서 추가한 누락 2건이 등록돼 있다', () => {
    expect(riCodePrefix('춘양면', '우구치리')).toBe('4792034028');
    expect(riCodePrefix('소천면', '남회룡리')).toBe('4792035026');
  });
});

describe('riCodePrefix', () => {
  it('리까지의 법정동코드 10자리를 돌려준다', () => {
    const prefix = riCodePrefix('봉화읍', '내성리');
    expect(prefix).toHaveLength(10);
    expect(prefix).toBe('4792025031');
  });

  /**
   * `generatePnu`와 달리 던진다. 헬스체크처럼 "실재하는 리 하나"가 필요한 곳에서
   * 쓰이므로, 없는 이름이 조용히 빈 문자열로 흘러가면 헬스체크가 무의미해진다.
   */
  it('표에 없는 이름은 던진다', () => {
    expect(() => riCodePrefix('없는면', '없는리')).toThrow(/EUMRI_MAP/);
  });
});

describe('getRegisteredRis', () => {
  it('등록된 리 목록을 읍면과 함께 돌려준다', () => {
    const ris = getRegisteredRis();
    expect(ris).toContain('봉화읍 내성리');
    expect(ris).toContain('소천면 서천리');
    expect(ris).not.toContain('소천면 신라리');
  });

  it('2026-09-07 실측 기준 72개 리가 등록돼 있다', () => {
    // 개수가 바뀌면 표를 손댄 것이므로 verify-eumri-map.mjs를 다시 돌려야 한다.
    expect(getRegisteredRis()).toHaveLength(72);
  });
});

describe('generatePnuForParcels', () => {
  /**
   * 제네릭 `T extends { pnu?: string; ... }`라, 리터럴을 그대로 넘기면 `pnu`가 없는
   * 형태로 추론되어 결과에서 `pnu`를 읽을 수 없다. 입력 형태를 명시한다.
   */
  type PnuParcel = {
    pnu?: string;
    eubmyeondong: string;
    ri: string;
    mainLotNum: string;
    subLotNum: string;
    address: string;
  };

  const base: PnuParcel = {
    eubmyeondong: '봉화읍',
    ri: '내성리',
    mainLotNum: '402',
    subLotNum: '1',
    address: '경상북도 봉화군 봉화읍 내성리 402-1',
  };

  it('PNU가 없는 필지에만 채운다', () => {
    const { updated, result } = generatePnuForParcels([
      { ...base },
      { ...base, pnu: '기존PNU유지' },
    ]);

    expect(updated[0].pnu).toHaveLength(19);
    expect(updated[1].pnu).toBe('기존PNU유지');
    expect(result.generated).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('overwrite면 기존 PNU도 덮는다', () => {
    const { updated, result } = generatePnuForParcels([{ ...base, pnu: '기존PNU' }], true);
    expect(updated[0].pnu).toHaveLength(19);
    expect(result.skipped).toBe(0);
    expect(result.generated).toBe(1);
  });

  it('주소의 산 표기로 산 번지를 판정한다', () => {
    const parcels: PnuParcel[] = [
      {
        eubmyeondong: '봉화읍',
        ri: '적덕리',
        mainLotNum: '56',
        subLotNum: '',
        address: '경상북도 봉화군 봉화읍 적덕리 산 56',
      },
    ];
    const { updated } = generatePnuForParcels(parcels);
    expect(updated[0].pnu![10]).toBe('2');
  });

  it('본번의 산 접두사로도 산 번지를 판정하고, 접두사는 본번에서 뗀다', () => {
    const parcels: PnuParcel[] = [
      {
        eubmyeondong: '봉화읍',
        ri: '적덕리',
        mainLotNum: '산56',
        subLotNum: '',
        address: '경상북도 봉화군 봉화읍 적덕리 56',
      },
    ];
    const { updated } = generatePnuForParcels(parcels);
    expect(updated[0].pnu).toBe('4792025027' + '2' + '0056' + '0000');
  });

  it('매핑이 없으면 원본을 그대로 두고 오류에 남긴다', () => {
    const { updated, result } = generatePnuForParcels([
      { ...base, eubmyeondong: '없는면', ri: '없는리' },
    ]);
    expect(updated[0].pnu).toBeUndefined();
    expect(result.generated).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('없는면');
  });
});
