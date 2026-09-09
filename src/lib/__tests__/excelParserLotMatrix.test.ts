import { describe, expect, it } from 'vitest';
import { applyColumnMapping } from '../excelParser';
import { parcelMatchKey } from '../parcelKey';
import type { ColumnMapping } from '../../types';

/**
 * **경로별 매트릭스.** 지번 표기를 정규화할 때 경로가 셋인데, 표본이 한쪽만 덮으면
 * 반대쪽의 후퇴가 보이지 않는다.
 *
 * PROJ1-1-31 3항이 정확히 그렇게 났다. 조립 경로에만 정규화를 넣고 테스트 픽스처
 * 둘도 **둘 다 `address: ''`**(조립)여서, 주소 컬럼 파일과 짝지으면 **고치기 전에는
 * 맞던 것이 어긋나는데** 아무도 몰랐다. 실측 4/4 회귀.
 *
 * 그 커밋이 스스로 인용한 교훈("8개 입력이 전부 단일 오염이라 조합이 표본에서
 * 빠졌다")과 **같은 구조의 실패**다. 그래서 경로를 축으로 세운다.
 */

const RI = '경상북도 봉화군 명호면 운계리';

/** 주소 컬럼이 있는 파일 */
const withAddr: ColumnMapping = { farmerId: 'F', parcelId: 'P', address: 'A' };
/** 주소 컬럼이 없어 조립하는 파일 (통합 필지번호) */
const assembled: ColumnMapping = { farmerId: 'F', parcelId: 'P', address: '', ri: 'R' };
/** 주소 컬럼이 없고 본번·부번이 분리된 파일 (2024/2025 기채취 형식) */
const split: ColumnMapping = {
  farmerId: 'F', parcelId: '', address: '', ri: 'R',
  parcelIdMode: 'split', mainLotNum: 'M', subLotNum: 'S',
};

const keyWithAddr = (lot: string) =>
  parcelMatchKey(applyColumnMapping([{ F: 'F1', P: lot, A: `${RI} ${lot}` }], withAddr, 'a.xlsx')[0]);

const keyAssembled = (lot: string) =>
  parcelMatchKey(applyColumnMapping([{ F: 'F1', P: lot, R: RI }], assembled, 'b.xlsx')[0]);

const keySplit = (main: string, sub: string) =>
  parcelMatchKey(applyColumnMapping([{ F: 'F1', M: main, S: sub, R: RI }], split, 'c.xlsx')[0]);

/** 같은 필지를 가리키는 여러 표기 */
const SAME_PARCEL: Array<[string, string]> = [
  ['0165-1', '165-1'],
  ['0165-0001', '165-1'],
  ['165-0001', '165-1'],
  ['165-1', '165-1'],
];

describe('지번 표기가 달라도 같은 필지는 같은 키다', () => {
  describe('주소 컬럼 파일 ↔ 조립 주소 파일', () => {
    for (const [raw] of SAME_PARCEL) {
      it(`지번 ${raw}`, () => {
        expect(keyWithAddr(raw)).toBe(keyAssembled(raw));
      });
    }
  });

  describe('같은 파일 형식 안에서 표기만 다를 때', () => {
    it('주소 컬럼 파일끼리', () => {
      const keys = new Set(SAME_PARCEL.map(([raw]) => keyWithAddr(raw)));
      expect(keys.size).toBe(1);
    });
    it('조립 주소 파일끼리', () => {
      const keys = new Set(SAME_PARCEL.map(([raw]) => keyAssembled(raw)));
      expect(keys.size).toBe(1);
    });
  });

  describe('본번·부번 분리 파일 ↔ 나머지 둘', () => {
    it('0패딩 분리 컬럼이 같은 키를 낸다', () => {
      expect(keySplit('0165', '0001')).toBe(keyWithAddr('0165-0001'));
      expect(keySplit('0165', '0001')).toBe(keyAssembled('165-1'));
    });
    it('부번 0은 본번만 남는다', () => {
      expect(keySplit('0165', '0000')).toBe(keyWithAddr('0165-0000'));
      expect(keySplit('165', '')).toBe(keyAssembled('165'));
    });
  });

  /** `산` 표기는 두 정규화 함수가 갈리던 지점이다 — 한 함수로 모았는지 본다 */
  describe('산 지번', () => {
    it('주소 컬럼과 조립이 같은 키를 낸다', () => {
      expect(keyWithAddr('산 0056')).toBe(keyAssembled('산 0056'));
      expect(keyWithAddr('산56')).toBe(keyAssembled('산56'));
    });
    it('공백 유무가 키를 가르지 않는다', () => {
      expect(keyAssembled('산 0056')).toBe(keyAssembled('산56'));
    });
  });

  /** 서로 다른 필지는 여전히 달라야 한다 — 정규화가 과해서 뭉치면 안 된다 */
  describe('다른 필지는 다른 키다', () => {
    it('본번이 다르면 다르다', () => {
      expect(keyAssembled('165-1')).not.toBe(keyAssembled('166-1'));
    });
    it('부번이 다르면 다르다', () => {
      expect(keyAssembled('165-1')).not.toBe(keyAssembled('165-2'));
    });
    it('부번 유무가 다르면 다르다', () => {
      expect(keyAssembled('165')).not.toBe(keyAssembled('165-1'));
    });
    it('산 지번과 일반 지번은 다르다', () => {
      expect(keyAssembled('산56')).not.toBe(keyAssembled('56'));
    });
  });
});
