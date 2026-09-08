import { describe, expect, it } from 'vitest';
import {
  farmerGroupKey,
  hasFarmerId,
  keySetOf,
  parcelFarmerKey,
  parcelMatchKey,
} from '../parcelKey';
import {
  categoryLabel,
  isPublicPayment,
  isRepresentative,
  markAsRepresentative,
} from '../parcelCategory';
import { makeParcel } from './factories';

/**
 * 이 키 공식은 예전에 네 곳에 복제돼 있었다(`extractionStore.matchKey`,
 * `extractionAlgorithm.matchesRepKeys`, `validateExtraction` 인라인,
 * `excelExporter.getParcelKey`). 한 곳만 바뀌면 조용히 어긋난다.
 */
describe('parcelMatchKey', () => {
  it('PNU가 있으면 PNU를 쓴다', () => {
    expect(parcelMatchKey(makeParcel({ pnu: 'PNU_A' }))).toBe('PNU_A');
  });

  it('PNU가 없으면 주소와 지번을 잇는다', () => {
    expect(
      parcelMatchKey(
        makeParcel({ pnu: '', address: '경상북도 봉화군 봉화읍 내성리 100', parcelId: '100' }),
      ),
    ).toBe('경상북도 봉화군 봉화읍 내성리 100__100');
  });

  it('경영체번호가 달라도 같은 필지면 같은 키다', () => {
    const a = makeParcel({ pnu: '', farmerId: 'F001', address: '주소', parcelId: '100' });
    const b = makeParcel({ pnu: '', farmerId: 'F002', address: '주소', parcelId: '100' });
    expect(parcelMatchKey(a)).toBe(parcelMatchKey(b));
  });

  /**
   * PROJ1-1-37. 예전에는 `'__'`라는 키를 만들어 돌려줬다. 그러면 식별 불가능한
   * 필지들이 전부 **같은 필지**로 취급돼, 대표필지 태깅이 번지고 dedupe가 한 건으로
   * 접고 삭제가 무관한 행까지 지웠다.
   *
   * 형제 함수 `parcelFarmerKey`가 같은 이유로 `null`을 돌려주는데 이쪽만 방치돼 있었다.
   */
  it('PNU도 주소도 지번도 없으면 키를 만들지 않는다', () => {
    expect(parcelMatchKey(makeParcel({ pnu: '', address: '', parcelId: '' }))).toBeNull();
  });

  it('주소만 있어도 키를 만든다', () => {
    expect(parcelMatchKey(makeParcel({ pnu: '', address: '어느 주소', parcelId: '' }))).toBe(
      '어느 주소__',
    );
  });

  it('지번만 있어도 키를 만든다', () => {
    expect(parcelMatchKey(makeParcel({ pnu: '', address: '', parcelId: '100' }))).toBe('__100');
  });
});

/**
 * `ri`를 키에 넣는 이유: `parcelId`는 지번이라 **리를 넘어 고유하지 않다.**
 * 한 농가가 A리·B리에 각각 지번 100-1을 가지면 둘이 같은 키가 되어,
 * 그중 하나가 대표필지일 때 나머지도 대표필지로 태깅된다.
 * 그 태깅이 엑셀 시트를 가르고 초과분 제거에서 보호까지 하므로 영향이 크다.
 */
describe('parcelFarmerKey', () => {
  it('경영체번호·리·지번을 잇는다', () => {
    expect(parcelFarmerKey(makeParcel({ farmerId: 'F001', ri: '내성리', parcelId: '100-1' }))).toBe(
      'F001_내성리_100-1',
    );
  });

  it('리가 다르면 다른 키다', () => {
    const a = makeParcel({ farmerId: 'F001', ri: 'A리', parcelId: '100-1' });
    const b = makeParcel({ farmerId: 'F001', ri: 'B리', parcelId: '100-1' });
    expect(parcelFarmerKey(a)).not.toBe(parcelFarmerKey(b));
  });

  /**
   * PROJ1-1-15의 핵심. 빈 값끼리 매칭시키면 무관한 필지가 같은 필지로 취급되어,
   * 완전히 다른 농가의 경영체 정보가 복사된다. 키 자체를 만들지 않는 것이 맞다.
   */
  it('경영체번호가 비면 키를 만들지 않는다', () => {
    expect(parcelFarmerKey(makeParcel({ farmerId: '', ri: '내성리', parcelId: '100' }))).toBeNull();
  });

  it('빈 경영체번호끼리 같은 키로 묶이지 않는다', () => {
    const a = parcelFarmerKey(makeParcel({ farmerId: '', ri: 'A리', parcelId: '100' }));
    const b = parcelFarmerKey(makeParcel({ farmerId: '', ri: 'A리', parcelId: '100' }));
    // 둘 다 null — Set에 넣어도 매칭 대상이 되지 않는다
    expect(a).toBeNull();
    expect(b).toBeNull();
  });
});

/**
 * 마스터 파일이라고 경영체번호가 항상 있는 것은 아니다 — `ColumnMapper`가 요구하는 것은
 * **컬럼의 매핑**이지 행마다 값이 있다는 보장이 아니고, `excelParser`는 빈 셀을 `''`로
 * 만든 뒤 그 행을 걸러내지 않는다(PROJ1-1-30).
 */
describe('hasFarmerId', () => {
  it('경영체번호가 있으면 true다', () => {
    expect(hasFarmerId(makeParcel({ farmerId: 'F001' }))).toBe(true);
  });

  it('비어 있으면 false다', () => {
    expect(hasFarmerId(makeParcel({ farmerId: '' }))).toBe(false);
  });
});

/**
 * 빈 값은 "같은 농가"가 아니라 **"농가 미상"**이다. 묶으면 농가당 상한이 서로 무관한
 * 필지 전체에 한꺼번에 걸려 수십 건이 후보에서 통째로 사라진다.
 */
describe('farmerGroupKey', () => {
  it('경영체번호가 있으면 그것을 키로 쓴다', () => {
    expect(farmerGroupKey(makeParcel({ farmerId: 'F001' }), 0)).toBe('F001');
  });

  it('같은 농가는 인덱스가 달라도 같은 키다', () => {
    const a = farmerGroupKey(makeParcel({ farmerId: 'F001', parcelId: '1' }), 0);
    const b = farmerGroupKey(makeParcel({ farmerId: 'F001', parcelId: '2' }), 7);
    expect(a).toBe(b);
  });

  it('경영체번호가 비면 행마다 다른 키를 준다', () => {
    const a = farmerGroupKey(makeParcel({ farmerId: '' }), 0);
    const b = farmerGroupKey(makeParcel({ farmerId: '' }), 1);
    expect(a).not.toBe(b);
  });

  it('농가 미상 키는 실제 경영체번호와 충돌하지 않는다', () => {
    // 경영체번호는 숫자 문자열이라 이 접두사와 겹칠 수 없다
    expect(farmerGroupKey(makeParcel({ farmerId: '' }), 0)).toMatch(/^__nofarmer_/);
    expect(farmerGroupKey(makeParcel({ farmerId: '0' }), 0)).toBe('0');
  });
});

/**
 * `parcelCategory === 'representative'`로 직접 비교하면 `'both'`(공익 추출에도
 * 뽑힌 대표필지)를 놓친다. 그 실수가 지도 색상·엑셀 시트·드롭 보호에 각각 다르게
 * 나타나 원인을 찾기 어렵다 — PROJ1-1-27 MEDIUM-4가 그 사례다.
 */
describe('parcelCategory 판정', () => {
  it('both는 대표필지이면서 공익직불제다', () => {
    const p = makeParcel({ parcelCategory: 'both' });
    expect(isRepresentative(p)).toBe(true);
    expect(isPublicPayment(p)).toBe(true);
  });

  it('representative는 대표필지이기만 하다', () => {
    const p = makeParcel({ parcelCategory: 'representative' });
    expect(isRepresentative(p)).toBe(true);
    expect(isPublicPayment(p)).toBe(false);
  });

  it('public-payment는 공익직불제이기만 하다', () => {
    const p = makeParcel({ parcelCategory: 'public-payment' });
    expect(isRepresentative(p)).toBe(false);
    expect(isPublicPayment(p)).toBe(true);
  });

  it('카테고리가 없으면 공익직불제로 본다', () => {
    const p = makeParcel({ parcelCategory: undefined as never });
    expect(isPublicPayment(p)).toBe(true);
    expect(isRepresentative(p)).toBe(false);
  });
});

describe('markAsRepresentative', () => {
  it('공익 추출분에 대표필지 성격을 더하면 both가 된다', () => {
    expect(markAsRepresentative('public-payment')).toBe('both');
  });

  it('카테고리가 없어도 both가 된다', () => {
    expect(markAsRepresentative(undefined)).toBe('both');
  });

  it('이미 대표필지면 그대로다', () => {
    expect(markAsRepresentative('representative')).toBe('representative');
  });

  it('이미 both면 그대로다', () => {
    expect(markAsRepresentative('both')).toBe('both');
  });

  it('멱등이다', () => {
    const once = markAsRepresentative('public-payment');
    expect(markAsRepresentative(once)).toBe(once);
  });
});

describe('categoryLabel', () => {
  it('엑셀 구분 컬럼 표기를 만든다', () => {
    expect(categoryLabel(makeParcel({ parcelCategory: 'both' }))).toBe('공익직불제·대표필지');
    expect(categoryLabel(makeParcel({ parcelCategory: 'representative' }))).toBe('대표필지');
    expect(categoryLabel(makeParcel({ parcelCategory: 'public-payment' }))).toBe('공익직불제');
  });
});

/**
 * `keySetOf` — 키 집합을 만드는 유일한 방법.
 *
 * 이 필터가 호출부에 흩어져 있을 때 `extractionStore`에서만 세 번 결함이 났고
 * (PROJ1-1-37 `allUsedKeys`, PROJ1-1-39 `selectedKeySet`), 그중 하나는 형제 줄이
 * 바로 옆에서 멀쩡히 거르는데도 빠져 있었다. 여기 한 곳만 지키면 네 곳이 함께 지켜진다.
 */
describe('keySetOf', () => {
  it('키를 모은다', () => {
    const set = keySetOf([makeParcel({ pnu: 'A' }), makeParcel({ pnu: 'B' })], parcelMatchKey);
    expect([...set].sort()).toEqual(['A', 'B']);
  });

  /**
   * **이것이 이 함수가 존재하는 이유다.** `new Set([null]).has(null)`은 `true`이므로,
   * 식별 불가능한 필지 하나가 나머지 전부를 "이미 있음"으로 만든다.
   */
  it('식별 불가능한 필지는 집합에 넣지 않는다', () => {
    const unidentified = makeParcel({ pnu: '', address: '', parcelId: '' });
    const set = keySetOf([makeParcel({ pnu: 'A' }), unidentified], parcelMatchKey);
    expect(set.size).toBe(1);
    expect(set.has(parcelMatchKey(unidentified) as unknown as string)).toBe(false);
  });

  it('전부 식별 불가능하면 빈 집합이다', () => {
    const set = keySetOf(
      [makeParcel({ pnu: '', address: '', parcelId: '' })],
      parcelMatchKey,
    );
    expect(set.size).toBe(0);
  });

  it('경영체번호 키에도 같은 규칙이 적용된다', () => {
    const noFarmer = makeParcel({ farmerId: '' });
    const set = keySetOf([noFarmer, makeParcel({ farmerId: 'F1' })], parcelFarmerKey);
    expect(set.size).toBe(1);
  });

  it('중복 키는 한 번만 담는다', () => {
    expect(keySetOf([makeParcel({ pnu: 'A' }), makeParcel({ pnu: 'A' })], parcelMatchKey).size).toBe(1);
  });
});
