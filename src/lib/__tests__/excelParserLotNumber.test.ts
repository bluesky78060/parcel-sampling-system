import { describe, expect, it } from 'vitest';
import { applyColumnMapping } from '../excelParser';
import { parcelMatchKey } from '../parcelKey';
import type { ColumnMapping } from '../../types';

/**
 * **한 행 안에서 지번 표기가 갈리면 안 된다.**
 *
 * 조립 주소는 원본 셀을 그대로 쓰는데 `parcelId`는 `normalizeId`를 거쳤다.
 * `normalizeId`는 `replace(/^0+/, '')`라 **맨 앞의 0만** 뗀다. 통합 필지번호
 * `'0165-0001'` 한 행에서:
 *
 *   조립 주소  … 운계리 0165-0001   (원본 셀)
 *   parcelId   165-0001              ← 부번의 0이 남는다
 *
 * 결과가 둘이다.
 * (a) 조립 주소가 0패딩째로 지오코딩에 들어간다
 * (b) `parcelMatchKey`가 `${address}__${parcelId}`이므로, 대표필지 파일이 `'165-1'`
 *     이고 마스터가 `'0165-0001'`이면 **두 조각이 모두 어긋난다**
 */

/** 주소 컬럼이 없어 분리 컬럼에서 조립하는 경로 (통합 필지번호) */
const assembleSingle: ColumnMapping = {
  farmerId: '경영체번호',
  parcelId: '필지번호',
  address: '', // 주소 컬럼 없음 → 분리 컬럼에서 조립
  sido: '시도',
  sigungu: '시군구',
  eubmyeondong: '읍면',
  ri: '리',
};

/** 주소 컬럼이 없어 분리 컬럼에서 조립하는 경로 (본번·부번 분리) */
const assembleSplit: ColumnMapping = {
  farmerId: '경영체번호',
  parcelId: '', // 통합 필지번호 컬럼 없음
  address: '', // 주소 컬럼 없음 → 분리 컬럼에서 조립
  parcelIdMode: 'split',
  mainLotNum: '본번',
  subLotNum: '부번',
  sido: '시도',
  sigungu: '시군구',
  eubmyeondong: '읍면',
  ri: '리',
};

const place = {
  경영체번호: '12345',
  시도: '경상북도',
  시군구: '봉화군',
  읍면: '상운면',
  리: '운계리',
};

describe('통합 필지번호의 0패딩 — 조립 주소와 parcelId가 같은 표기여야 한다', () => {
  it("'0165-0001' → 주소도 parcelId도 '165-1'", () => {
    const [p] = applyColumnMapping(
      [{ ...place, 필지번호: '0165-0001' }],
      assembleSingle,
      'master.xlsx',
    );
    expect(p.parcelId).toBe('165-1');
    expect(p.address).toBe('경상북도 봉화군 상운면 운계리 165-1');
  });

  it("부번이 전부 0이면 뗀다: '0165-0000' → '165'", () => {
    const [p] = applyColumnMapping(
      [{ ...place, 필지번호: '0165-0000' }],
      assembleSingle,
      'master.xlsx',
    );
    expect(p.parcelId).toBe('165');
    expect(p.address).toBe('경상북도 봉화군 상운면 운계리 165');
  });

  it("0패딩이 없으면 그대로: '1043-2'", () => {
    const [p] = applyColumnMapping(
      [{ ...place, 필지번호: '1043-2' }],
      assembleSingle,
      'master.xlsx',
    );
    expect(p.parcelId).toBe('1043-2');
    expect(p.address).toBe('경상북도 봉화군 상운면 운계리 1043-2');
  });

  it("산 지번: '산0056' → '산56'", () => {
    const [p] = applyColumnMapping(
      [{ ...place, 필지번호: '산0056' }],
      assembleSingle,
      'master.xlsx',
    );
    expect(p.parcelId).toBe('산56');
    expect(p.address).toBe('경상북도 봉화군 상운면 운계리 산56');
  });

  it('본번·부번 분리 컬럼에서도 조립 주소가 정규화된다', () => {
    const [p] = applyColumnMapping(
      [{ ...place, 본번: '0165', 부번: '0001' }],
      assembleSplit,
      'sampled-2024.xlsx',
    );
    expect(p.parcelId).toBe('165-1');
    expect(p.address).toBe('경상북도 봉화군 상운면 운계리 165-1');
    // 흙토람용 분리 저장도 같은 표기여야 한다
    expect(p.mainLotNum).toBe('165');
    expect(p.subLotNum).toBe('1');
  });

  /**
   * 분리 컬럼이 **순수 숫자**이기만 하면 `normalizeLotId`와 `normalizeId`가 같은
   * 값을 낸다(`'0165'` → 둘 다 `'165'`). 즉 분리 경로만 놓고 보면 두 함수를 바꿔도
   * 위 테스트들은 살아남는다 — 실제로 변이를 넣어 확인했다.
   *
   * 갈리는 것은 본번 컬럼에 `산` 표기가 섞여 들어올 때다. `normalizeId`는
   * `'산0056'`을 그대로 두지만(선행 문자가 0이 아니라 `산`이므로) 지번으로서는
   * `'산56'`이 맞다. 이 케이스를 고정해야 분리 경로에서도 지번 규칙이 지켜진다.
   */
  it("본번 컬럼에 산 표기가 섞여도 지번 규칙을 적용한다: '산0056' → '산56'", () => {
    const [p] = applyColumnMapping(
      [{ ...place, 본번: '산0056', 부번: '0000' }],
      assembleSplit,
      'sampled-2024.xlsx',
    );
    expect(p.parcelId).toBe('산56');
    expect(p.mainLotNum).toBe('산56');
    expect(p.address).toBe('경상북도 봉화군 상운면 운계리 산56');
  });

  it('분리 컬럼의 부번이 전부 0이면 조립 주소에서도 뗀다', () => {
    const [p] = applyColumnMapping(
      [{ ...place, 본번: '0165', 부번: '00' }],
      assembleSplit,
      'sampled-2024.xlsx',
    );
    expect(p.parcelId).toBe('165');
    expect(p.address).toBe('경상북도 봉화군 상운면 운계리 165');
  });
});

describe('parcelMatchKey — 표기가 다른 두 파일이 같은 필지로 매칭된다', () => {
  /**
   * 대표필지 파일은 본번·부번 분리(0패딩 없음), 마스터는 통합 0패딩인 실제 조합.
   * 예전에는 주소 조각과 지번 조각이 **둘 다** 어긋나 매칭이 통째로 실패했다.
   */
  it("마스터 '0165-0001' 과 대표필지 '165-1' 이 같은 키가 된다", () => {
    const [master] = applyColumnMapping(
      [{ ...place, 필지번호: '0165-0001' }],
      assembleSingle,
      'master.xlsx',
    );
    const [rep] = applyColumnMapping(
      [{ ...place, 본번: '165', 부번: '1' }],
      assembleSplit,
      'rep.xlsx',
    );

    expect(parcelMatchKey(master)).toBe(parcelMatchKey(rep));
    expect(parcelMatchKey(master)).not.toBeNull();
  });
});

describe('farmerId는 건드리지 않는다', () => {
  /**
   * `normalizeId`는 `farmerId`(경영체번호)에도 쓰인다. 지번용 규칙(하이픈을
   * 본번·부번으로 갈라 각각 0을 떼는 것)을 `normalizeId` 자체에 넣으면
   * 하이픈이 들어간 경영체번호가 조용히 바뀐다. 그래서 지번 전용 함수를 따로 뒀고,
   * 그 판단을 여기서 고정한다.
   */
  it("앞의 0만 뗀다: '0012345' → '12345'", () => {
    const [p] = applyColumnMapping(
      [{ ...place, 경영체번호: '0012345', 필지번호: '100-1' }],
      assembleSingle,
      'master.xlsx',
    );
    expect(p.farmerId).toBe('12345');
  });

  it("하이픈이 있어도 뒤쪽은 손대지 않는다: '0012-0034' → '12-0034'", () => {
    const [p] = applyColumnMapping(
      [{ ...place, 경영체번호: '0012-0034', 필지번호: '100-1' }],
      assembleSingle,
      'master.xlsx',
    );
    expect(p.farmerId).toBe('12-0034');
  });

  it("전부 0이면 '0': '000' → '0'", () => {
    const [p] = applyColumnMapping(
      [{ ...place, 경영체번호: '000', 필지번호: '100-1' }],
      assembleSingle,
      'master.xlsx',
    );
    expect(p.farmerId).toBe('0');
  });
});
