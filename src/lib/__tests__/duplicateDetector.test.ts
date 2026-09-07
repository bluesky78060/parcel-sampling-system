import { describe, expect, it, vi } from 'vitest';
import { findDuplicates, getDuplicateKey, markEligibility } from '../duplicateDetector';
import { makeParcel } from './factories';

// 이 모듈은 진행 상황을 console.log로 남긴다. 테스트 출력에서만 지운다.
vi.spyOn(console, 'log').mockImplementation(() => {});

describe('getDuplicateKey', () => {
  it('PNU가 있으면 PNU를 쓴다', () => {
    expect(getDuplicateKey(makeParcel({ pnu: '4792025031104020001' }))).toBe(
      'pnu:4792025031104020001',
    );
  });

  it('PNU가 없으면 정규화한 주소를 쓴다', () => {
    expect(getDuplicateKey(makeParcel({ pnu: '', address: '경상북도 봉화군 봉화읍 내성리 100' }))).toBe(
      'addr:경상북도봉화군봉화읍내성리100',
    );
  });

  it('PNU도 주소도 없으면 빈 키다', () => {
    expect(getDuplicateKey(makeParcel({ pnu: '', address: '' }))).toBe('');
  });
});

describe('findDuplicates', () => {
  it('PNU가 일치하는 필지를 중복으로 본다', () => {
    const master = [
      makeParcel({ pnu: 'PNU_A', address: '주소 A' }),
      makeParcel({ pnu: 'PNU_B', address: '주소 B' }),
      makeParcel({ pnu: 'PNU_C', address: '주소 C' }),
    ];
    const result = findDuplicates(master, {
      2024: [makeParcel({ pnu: 'PNU_A', address: '주소 A' })],
      2025: [makeParcel({ pnu: 'PNU_B', address: '주소 B' })],
    });

    expect(result.duplicateCountByYear[2024]).toBe(1);
    expect(result.duplicateCountByYear[2025]).toBe(1);
    expect(result.eligibleCount).toBe(1); // PNU_C만 남는다
  });

  /**
   * 실측으로 확인한 동작. `isMatched`는 PNU 매칭에 **실패하면 주소로 다시 시도**한다
   * (PNU가 없을 때만 주소를 보는 것이 아니다). 따라서 PNU가 서로 다른 두 필지도
   * 주소가 같으면 중복으로 판정된다.
   *
   * 파일마다 PNU 표기가 다를 수 있어(조립 PNU vs 원본 PNU) 폴백이 있는 편이 안전하지만,
   * 반대로 조립 주소가 리 수준으로 뭉뚱그려진 경우 무관한 필지가 함께 제외될 수 있다.
   * PROJ1-1-31의 4번(조립 주소가 지번 없이 끝나는 경우)과 맞물리는 지점이다.
   */
  it('PNU가 달라도 주소가 같으면 중복으로 본다 (주소 폴백이 항상 동작)', () => {
    const result = findDuplicates([makeParcel({ pnu: 'PNU_A', address: '같은 주소 100' })], {
      2024: [makeParcel({ pnu: 'PNU_다름', address: '같은 주소 100' })],
    });
    expect(result.duplicateCountByYear[2024]).toBe(1);
    expect(result.eligibleCount).toBe(0);
  });

  it('PNU가 없으면 주소로 비교한다', () => {
    const master = [makeParcel({ pnu: '', address: '경상북도 봉화군 봉화읍 내성리 100' })];
    const result = findDuplicates(master, {
      2024: [makeParcel({ pnu: '', address: '경상북도봉화군 봉화읍 내성리 100' })], // 표기만 다름
    });

    expect(result.duplicateCountByYear[2024]).toBe(1);
    expect(result.eligibleCount).toBe(0);
  });

  it('한 필지가 두 해 모두에 걸리면 양쪽에 집계된다', () => {
    const result = findDuplicates([makeParcel({ pnu: 'PNU_A', address: '주소 A' })], {
      2024: [makeParcel({ pnu: 'PNU_A', address: '주소 A' })],
      2025: [makeParcel({ pnu: 'PNU_A', address: '주소 A' })],
    });

    expect(result.duplicateCountByYear[2024]).toBe(1);
    expect(result.duplicateCountByYear[2025]).toBe(1);
    expect(result.eligibleCount).toBe(0); // 중복은 한 번만 빠진다
  });

  it('기채취 파일이 없으면 전부 적격이다', () => {
    const master = [
      makeParcel({ pnu: 'PNU_A', address: '주소 A' }),
      makeParcel({ pnu: 'PNU_B', address: '주소 B' }),
    ];
    expect(findDuplicates(master, {}).eligibleCount).toBe(2);
  });

  /**
   * PROJ1-1-29에서 연도를 인자 이름에서 뺐다. 예전에는 `sampled2024`/`sampled2025`로
   * 고정돼 있어 다음 해 조사로 넘어가려면 함수와 호출부를 함께 고쳐야 했다.
   */
  it('연도 개수와 값에 구애받지 않는다', () => {
    const result = findDuplicates([makeParcel({ pnu: 'PNU_A', address: '주소 A' })], {
      2030: [makeParcel({ pnu: 'PNU_A', address: '주소 A' })],
      2031: [],
      2032: [],
    });
    expect(Object.keys(result.duplicateCountByYear).map(Number).sort()).toEqual([2030, 2031, 2032]);
    expect(result.duplicateCountByYear[2030]).toBe(1);
  });

  it('키가 없는 필지는 중복 집합에 넣지 않는다', () => {
    const master = [makeParcel({ pnu: '', address: '' })];
    const result = findDuplicates(master, { 2024: [makeParcel({ pnu: 'PNU_A', address: '주소 A' })] });
    expect(result.duplicateCountByYear[2024]).toBe(0);
    expect(result.eligibleCount).toBe(1);
  });
});

describe('markEligibility', () => {
  it('중복이 아니면 적격으로 표시한다', () => {
    const marked = markEligibility([makeParcel({ pnu: 'PNU_C', address: '주소 C' })], {
      2024: [makeParcel({ pnu: 'PNU_A', address: '주소 A' })],
    });
    expect(marked[0].isEligible).toBe(true);
    expect(marked[0].sampledYears).toEqual([]);
  });

  it('중복이면 부적격으로 표시하고 채취 연도를 붙인다', () => {
    const marked = markEligibility([makeParcel({ pnu: 'PNU_A', address: '주소 A' })], {
      2024: [makeParcel({ pnu: 'PNU_A', address: '주소 A' })],
      2025: [makeParcel({ pnu: 'PNU_A', address: '주소 A' })],
    });
    expect(marked[0].isEligible).toBe(false);
    expect(marked[0].sampledYears).toEqual([2024, 2025]);
  });

  /**
   * 채취이력은 **오름차순**이어야 한다. 엑셀 '채취이력'·'채취연도' 컬럼과 지도
   * 팝업이 이 배열을 그대로 join하므로, 연도를 일반화하기 전의 산출물("2024, 2025")과
   * 같은 모양을 유지해야 담당자가 대조할 수 있다.
   * (`findDuplicates`의 내림차순은 로그용일 뿐이다.)
   */
  it('채취 연도는 오름차순이다', () => {
    const marked = markEligibility([makeParcel({ pnu: 'PNU_A', address: '주소 A' })], {
      2026: [makeParcel({ pnu: 'PNU_A', address: '주소 A' })],
      2024: [makeParcel({ pnu: 'PNU_A', address: '주소 A' })],
      2025: [makeParcel({ pnu: 'PNU_A', address: '주소 A' })],
    });
    expect(marked[0].sampledYears).toEqual([2024, 2025, 2026]);
  });

  it('한 해에만 걸리면 그 해만 붙는다', () => {
    const marked = markEligibility([makeParcel({ pnu: 'PNU_A', address: '주소 A' })], {
      2024: [makeParcel({ pnu: 'PNU_A', address: '주소 A' })],
      2025: [makeParcel({ pnu: 'PNU_B', address: '주소 B' })],
    });
    expect(marked[0].sampledYears).toEqual([2024]);
    expect(marked[0].isEligible).toBe(false);
  });

  it('원본 필지를 변형하지 않는다', () => {
    const original = makeParcel({ pnu: 'PNU_A', address: '주소 A', isEligible: true });
    markEligibility([original], { 2024: [makeParcel({ pnu: 'PNU_A', address: '주소 A' })] });
    expect(original.isEligible).toBe(true); // 새 객체를 돌려줘야 한다
  });

  it('행 수를 보존한다', () => {
    const master = Array.from({ length: 10 }, (_, i) =>
      makeParcel({ pnu: `PNU_${i}`, address: `주소 ${i}` }),
    );
    expect(
      markEligibility(master, { 2024: [makeParcel({ pnu: 'PNU_0', address: '주소 0' })] }),
    ).toHaveLength(10);
  });
});
