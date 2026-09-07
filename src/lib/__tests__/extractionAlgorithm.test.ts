import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  MIN_AREA,
  extractParcels,
  generateFarmerStats,
  generateRiStats,
  getParcelArea,
} from '../extractionAlgorithm';
import { parcelMatchKey } from '../parcelKey';
import { makeConfig, makeParcel } from './factories';

beforeAll(() => {
  // 추출 과정을 콘솔로 중계한다. 테스트 출력에서만 지운다.
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

/**
 * 면적은 세 곳에서 올 수 있다 — `p.area`(매핑된 컬럼), `rawData`의 면적류 컬럼,
 * 그리고 아무 데도 없는 경우. PROJ1-1-4에서 이 우선순위가 한 번 뒤집힌 적이 있다.
 */
describe('getParcelArea', () => {
  it('매핑된 면적을 우선한다', () => {
    expect(getParcelArea(makeParcel({ area: 1200, rawData: { 재배면적: 999 } }))).toBe(1200);
  });

  it('면적이 없으면 rawData의 면적 컬럼을 찾는다', () => {
    expect(getParcelArea(makeParcel({ rawData: { 재배면적: 1200 } }))).toBe(1200);
  });

  it('합산 면적 컬럼을 부분 면적보다 먼저 본다', () => {
    const p = makeParcel({
      rawData: { '재배면적(노지+시설)': 1500, 재배면적: 800, 면적: 300 },
    });
    expect(getParcelArea(p)).toBe(1500);
  });

  it('컬럼명의 공백을 무시하고 매칭한다', () => {
    expect(getParcelArea(makeParcel({ rawData: { '재배면적 (노지+시설)': 1500 } }))).toBe(1500);
  });

  it('쉼표가 든 문자열 면적도 읽는다', () => {
    expect(getParcelArea(makeParcel({ rawData: { 면적: '1,200' } }))).toBe(1200);
  });

  it('아무 데도 없으면 null이다', () => {
    expect(getParcelArea(makeParcel({}))).toBeNull();
    expect(getParcelArea(makeParcel({ rawData: { 작물명: '벼' } }))).toBeNull();
  });

  /**
   * PROJ1-1-24 미결 사항. `parseArea`가 면적 0을 `undefined`로 접어
   * "면적 0"과 "면적 정보 없음"을 같은 값으로 뭉갠다. 실데이터에 0값이 63건 있다.
   * 0을 부적격으로 볼지 정보 없음으로 볼지는 아직 결정되지 않았다.
   */
  it('면적 0은 정보 없음으로 취급한다 (PROJ1-1-24 미결)', () => {
    expect(getParcelArea(makeParcel({ area: 0 }))).toBeNull();
  });

  it('rawData의 0도 면적으로 채택하지 않는다', () => {
    expect(getParcelArea(makeParcel({ rawData: { 면적: 0, 재배면적: 1200 } }))).toBe(1200);
  });
});

describe('extractParcels — 면적 필터', () => {
  const config = makeConfig({ totalTarget: 100, publicPaymentTarget: 100, maxPerFarmer: 100 });

  it(`${MIN_AREA}㎡ 미만은 제외한다`, () => {
    const parcels = [
      makeParcel({ farmerId: 'F1', parcelId: '1', area: MIN_AREA - 1 }),
      makeParcel({ farmerId: 'F2', parcelId: '2', area: MIN_AREA }),
      makeParcel({ farmerId: 'F3', parcelId: '3', area: MIN_AREA + 1 }),
    ];
    const ids = extractParcels(parcels, config).selectedParcels.map((p) => p.parcelId);
    expect(ids).not.toContain('1');
    expect(ids).toContain('2');
    expect(ids).toContain('3');
  });

  it('면적 정보가 없으면 제외하지 않는다', () => {
    const parcels = [makeParcel({ farmerId: 'F1', parcelId: '1' })];
    expect(extractParcels(parcels, config).selectedParcels).toHaveLength(1);
  });
});

describe('extractParcels — 적격성과 제외 리', () => {
  const config = makeConfig({ totalTarget: 100, publicPaymentTarget: 100, maxPerFarmer: 100 });

  it('부적격 필지는 뽑지 않는다', () => {
    const parcels = [
      makeParcel({ farmerId: 'F1', parcelId: '1', isEligible: false }),
      makeParcel({ farmerId: 'F2', parcelId: '2', isEligible: true }),
    ];
    const selected = extractParcels(parcels, config).selectedParcels;
    expect(selected.every((p) => p.isEligible)).toBe(true);
    expect(selected.map((p) => p.parcelId)).toEqual(['2']);
  });

  it('제외 리의 필지는 뽑지 않는다', () => {
    const parcels = [
      makeParcel({ farmerId: 'F1', parcelId: '1', ri: '제외리' }),
      makeParcel({ farmerId: 'F2', parcelId: '2', ri: '포함리' }),
    ];
    const selected = extractParcels(parcels, {
      ...config,
      excludedRis: ['제외리'],
    }).selectedParcels;
    expect(selected.every((p) => p.ri !== '제외리')).toBe(true);
  });
});

/**
 * `randomSeed` 입력란의 존재 자체가 "시드를 적어두면 같은 결과가 나온다"는 약속이다.
 * 700필지는 행정 산출물이므로 "왜 같은 시드인데 다른 결과냐"는 질문이 실제로 나온다.
 * (rng 소비량이 바뀌면 재현성이 깨지는 것은 PROJ1-1-22의 알고리즘 버전 스탬프로 다룬다.)
 */
describe('extractParcels — 시드 재현성', () => {
  const parcels = Array.from({ length: 60 }, (_, i) =>
    makeParcel({
      farmerId: `F${i % 12}`,
      parcelId: `${100 + i}`,
      ri: `R${i % 4}리`,
      area: 1000,
    }),
  );

  it('같은 시드는 같은 결과를 낸다', () => {
    const config = makeConfig({ totalTarget: 20, publicPaymentTarget: 20, randomSeed: 42 });
    const a = extractParcels(parcels, config).selectedParcels.map(parcelMatchKey);
    const b = extractParcels(parcels, config).selectedParcels.map(parcelMatchKey);
    expect(a).toEqual(b);
  });

  it('시드가 다르면 결과가 달라진다', () => {
    const a = extractParcels(
      parcels,
      makeConfig({ totalTarget: 20, publicPaymentTarget: 20, randomSeed: 1 }),
    ).selectedParcels.map(parcelMatchKey);
    const b = extractParcels(
      parcels,
      makeConfig({ totalTarget: 20, publicPaymentTarget: 20, randomSeed: 999 }),
    ).selectedParcels.map(parcelMatchKey);
    expect(a).not.toEqual(b);
  });

  it('입력 순서가 같으면 실행 순서도 같다', () => {
    const config = makeConfig({ totalTarget: 20, publicPaymentTarget: 20, randomSeed: 7 });
    const runs = Array.from({ length: 3 }, () =>
      extractParcels(parcels, config).selectedParcels.map(parcelMatchKey).join('|'),
    );
    expect(new Set(runs).size).toBe(1);
  });
});

describe('extractParcels — 결과 불변식', () => {
  const parcels = Array.from({ length: 60 }, (_, i) =>
    makeParcel({
      farmerId: `F${i % 12}`,
      parcelId: `${100 + i}`,
      ri: `R${i % 4}리`,
      area: 1000,
    }),
  );

  it('목표를 넘겨 뽑지 않는다', () => {
    const result = extractParcels(
      parcels,
      makeConfig({ totalTarget: 20, publicPaymentTarget: 20 }),
    );
    expect(result.selectedParcels.length).toBeLessThanOrEqual(20);
  });

  it('같은 필지를 두 번 뽑지 않는다', () => {
    const result = extractParcels(
      parcels,
      makeConfig({ totalTarget: 30, publicPaymentTarget: 30 }),
    );
    const keys = result.selectedParcels.map((p) => `${p.farmerId}__${p.parcelId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('선택된 필지는 모두 입력에 있던 것이다', () => {
    const result = extractParcels(
      parcels,
      makeConfig({ totalTarget: 30, publicPaymentTarget: 30 }),
    );
    const inputKeys = new Set(parcels.map((p) => `${p.farmerId}__${p.parcelId}`));
    for (const p of result.selectedParcels) {
      expect(inputKeys.has(`${p.farmerId}__${p.parcelId}`)).toBe(true);
    }
  });

  it('후보가 없으면 빈 결과를 낸다', () => {
    const result = extractParcels([], makeConfig({ totalTarget: 10, publicPaymentTarget: 10 }));
    expect(result.selectedParcels).toEqual([]);
  });

  it('후보가 목표보다 적으면 있는 만큼만 뽑는다', () => {
    const few = [
      makeParcel({ farmerId: 'F1', parcelId: '1', area: 1000 }),
      makeParcel({ farmerId: 'F2', parcelId: '2', area: 1000 }),
    ];
    const result = extractParcels(few, makeConfig({ totalTarget: 100, publicPaymentTarget: 100 }));
    expect(result.selectedParcels).toHaveLength(2);
  });
});

describe('generateRiStats / generateFarmerStats', () => {
  it('리별로 선택 수를 센다', () => {
    const selected = [
      makeParcel({ ri: 'A리', parcelId: '1' }),
      makeParcel({ ri: 'A리', parcelId: '2' }),
      makeParcel({ ri: 'B리', parcelId: '3' }),
    ];
    const stats = generateRiStats(selected, selected, makeConfig());
    const byRi = Object.fromEntries(stats.map((s) => [s.ri, s.selectedCount]));
    expect(byRi['A리']).toBe(2);
    expect(byRi['B리']).toBe(1);
  });

  it('농가별로 선택 수를 센다', () => {
    const stats = generateFarmerStats([
      makeParcel({ farmerId: 'F1', parcelId: '1' }),
      makeParcel({ farmerId: 'F1', parcelId: '2' }),
      makeParcel({ farmerId: 'F2', parcelId: '3' }),
    ]);
    const byFarmer = Object.fromEntries(stats.map((s) => [s.farmerId, s.selectedParcels]));
    expect(byFarmer['F1']).toBe(2);
    expect(byFarmer['F2']).toBe(1);
  });

  /**
   * PROJ1-1-30에 기록한 미이행분. 경영체번호가 빈 필지들이 `farmerId: ''` 한 농가로
   * 집계된다. 고치면 이 테스트가 실패한다 — 그때 기대를 "빈 농가는 집계에서 제외"로
   * 바꾸면 된다.
   */
  it('[PROJ1-1-30 미수정] 빈 경영체번호가 한 농가로 집계된다', () => {
    const stats = generateFarmerStats([
      makeParcel({ farmerId: '', parcelId: '1' }),
      makeParcel({ farmerId: '', parcelId: '2' }),
      makeParcel({ farmerId: '', parcelId: '3' }),
    ]);
    expect(stats).toHaveLength(1);
    expect(stats[0].farmerId).toBe('');
    expect(stats[0].selectedParcels).toBe(3);
  });
});
