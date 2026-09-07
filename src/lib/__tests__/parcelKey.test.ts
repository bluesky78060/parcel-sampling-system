import { describe, expect, it } from 'vitest';
import { parcelFarmerKey, parcelMatchKey } from '../parcelKey';
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
   * PROJ1-1-30에 기록한 취약점. PNU가 없고 주소·지번이 모두 빈 필지끼리는
   * `'__'`라는 같은 키를 갖는다. `parcelFarmerKey`는 이 문제를 막았는데
   * (빈 값이면 `null` 반환) 이쪽은 아직 방치돼 있다.
   *
   * PROJ1-1-30에서 `null` 반환으로 고치면 이 테스트가 실패한다 —
   * 그때 기대값을 `toBeNull()`로 바꾸면 된다.
   */
  it('[PROJ1-1-30 미수정] 주소·지번이 모두 비면 전부 같은 키가 된다', () => {
    const a = makeParcel({ pnu: '', address: '', parcelId: '' });
    const b = makeParcel({ pnu: '', address: '', parcelId: '' });
    expect(parcelMatchKey(a)).toBe('__');
    expect(parcelMatchKey(a)).toBe(parcelMatchKey(b));
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
