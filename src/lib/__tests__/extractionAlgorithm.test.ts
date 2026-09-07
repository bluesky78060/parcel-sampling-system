import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  MIN_AREA,
  extractParcels,
  generateFarmerStats,
  generateRiStats,
  getParcelArea,
  validateExtraction,
} from '../extractionAlgorithm';
import { parcelMatchKey } from '../parcelKey';
import type { Parcel } from '../../types';
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

  /**
   * `validateExtraction`은 `extractParcels`가 매 호출마다 돌리므로 커버리지 도구에는
   * covered로 뜨지만, 결과를 아무도 읽지 않으면 어서션이 0이다. 실제로 TOTAL_MISMATCH·
   * FARMER_OVER_LIMIT·SAMPLED_INCLUDED 세 검사를 각각 무력화해도 테스트가 전부
   * 살아남았다. 검증기를 검증하는 것이 없으면 검증기가 조용히 죽는다.
   */
  it('후보가 충분하면 검증 오류 없이 목표를 정확히 채운다', () => {
    const result = extractParcels(
      parcels,
      makeConfig({ totalTarget: 20, publicPaymentTarget: 20 }),
    );
    expect(result.selectedParcels).toHaveLength(20);
    expect(result.validation.errors).toEqual([]);
    expect(result.validation.isValid).toBe(true);
  });

  it('기채취 필지는 후보에 있어도 뽑히지 않는다', () => {
    const sampled = makeParcel({
      farmerId: 'FX',
      parcelId: '999',
      sampledYears: [2025],
      isEligible: false,
    });
    const result = extractParcels(
      [...parcels, sampled],
      makeConfig({ totalTarget: 20, publicPaymentTarget: 20 }),
    );
    expect(result.selectedParcels.some((p) => p.parcelId === '999')).toBe(false);
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

/**
 * `makeConfig`의 기본 `perRiTarget: 0`은 Step 3(`extractFromRi`)을 통째로 건너뛴다.
 * 그래서 위의 테스트들은 전부 Step 4(미달 보충) 경로만 탄다 — 리별 할당,
 * 농가별 슬라이스, 대표필지 우선이 한 줄도 실행되지 않는다.
 *
 * 실제로 `extractFromRi`의 `slice(0, config.maxPerFarmer)`를 `+5`로 망가뜨려도
 * 154건이 전부 통과했다. 여기서 `perRiTarget`을 양수로 줘 그 경로를 연다.
 */
describe('extractParcels — 리별 할당(Step 3)과 농가당 상한', () => {
  // 농가 12곳 × 5필지 = 60건. 12와 4의 배수 관계상 한 농가는 한 리에 모인다
  // (리마다 농가 3곳 × 5필지 = 15건).
  const parcels = Array.from({ length: 60 }, (_, i) =>
    makeParcel({
      farmerId: `F${i % 12}`,
      parcelId: `${100 + i}`,
      ri: `R${i % 4}리`,
      area: 1000,
    }),
  );

  const countByFarmer = (selected: ReturnType<typeof extractParcels>['selectedParcels']) => {
    const counts = new Map<string, number>();
    for (const p of selected) counts.set(p.farmerId, (counts.get(p.farmerId) ?? 0) + 1);
    return counts;
  };

  it('농가당 상한을 넘겨 뽑지 않는다', () => {
    const result = extractParcels(
      parcels,
      makeConfig({ totalTarget: 20, publicPaymentTarget: 20, perRiTarget: 5, maxPerFarmer: 2 }),
    );
    const counts = countByFarmer(result.selectedParcels);
    expect(counts.size).toBeGreaterThan(0);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);
  });

  it('상한이 1이면 농가마다 최대 한 필지다', () => {
    const result = extractParcels(
      parcels,
      makeConfig({ totalTarget: 12, publicPaymentTarget: 12, perRiTarget: 3, maxPerFarmer: 1 }),
    );
    const counts = countByFarmer(result.selectedParcels);
    expect(Math.max(...counts.values())).toBe(1);
  });

  it('리별 목표를 넘겨 뽑지 않는다', () => {
    const result = extractParcels(
      parcels,
      makeConfig({
        totalTarget: 100, // 총 목표를 크게 둬 Step 4 보충이 리별 상한을 덮지 않게 한다
        publicPaymentTarget: 100,
        perRiTarget: 2,
        maxPerFarmer: 5,
        underfillPolicy: 'skip',
      }),
    );
    const byRi = new Map<string, number>();
    for (const p of result.selectedParcels) byRi.set(p.ri, (byRi.get(p.ri) ?? 0) + 1);
    for (const [, count] of byRi) expect(count).toBeLessThanOrEqual(2);
  });

  it('riTargetOverrides가 리별 목표를 덮는다', () => {
    const result = extractParcels(
      parcels,
      makeConfig({
        totalTarget: 100,
        publicPaymentTarget: 100,
        perRiTarget: 2,
        riTargetOverrides: { 'R0리': 4 },
        maxPerFarmer: 5,
        underfillPolicy: 'skip',
      }),
    );
    const r0 = result.selectedParcels.filter((p) => p.ri === 'R0리').length;
    expect(r0).toBe(4);
  });
});

/**
 * 검증기를 직접 호출해 시험한다.
 *
 * `extractParcels`가 매 호출마다 `validateExtraction`을 돌리므로 커버리지 도구에는
 * covered로 뜨지만, 결과를 "오류가 비었는지"로만 보면 **검사 자체를 무력화해도
 * 통과한다.** 실제로 TOTAL_MISMATCH를 `if (false)`로 죽여도 29건이 전부 살아남았다.
 * 오류가 나와야 하는 입력을 직접 넣어야 검사기가 살아 있는지 알 수 있다.
 */
describe('validateExtraction', () => {
  const config = makeConfig({ totalTarget: 3, publicPaymentTarget: 3, maxPerFarmer: 2 });
  const riStatsFor = (selected: Parcel[]) => generateRiStats(selected, selected, config);

  it('결과 수가 목표와 같으면 TOTAL_MISMATCH가 없다', () => {
    const selected = [
      makeParcel({ farmerId: 'F1', parcelId: '1' }),
      makeParcel({ farmerId: 'F2', parcelId: '2' }),
      makeParcel({ farmerId: 'F3', parcelId: '3' }),
    ];
    const v = validateExtraction(selected, config, riStatsFor(selected));
    expect(v.errors.some((e) => e.code === 'TOTAL_MISMATCH')).toBe(false);
  });

  /**
   * 목표와의 차이가 **10 이하면 경고, 11 이상이면 오류**다
   * (`extractionAlgorithm.ts:577`의 `Math.abs(...) > 10`).
   * 이 임계값은 코드 한 줄에만 있고 화면에도 문서에도 없다. 여기서 못박는다 —
   * 담당자가 "몇 개까지 어긋나도 되는가"를 물으면 답이 이 숫자다.
   */
  it('목표와의 차이가 10 이하면 경고로만 남긴다', () => {
    const selected = [makeParcel({ farmerId: 'F1', parcelId: '1' })]; // 목표 3, 차이 2
    const v = validateExtraction(selected, config, riStatsFor(selected));
    expect(v.warnings.some((e) => e.code === 'TOTAL_MISMATCH')).toBe(true);
    expect(v.errors.some((e) => e.code === 'TOTAL_MISMATCH')).toBe(false);
  });

  it('목표와의 차이가 10을 넘으면 오류로 올린다', () => {
    // 목표 3, 결과 14 → 차이 11. 농가를 전부 다르게 해 FARMER_OVER_LIMIT과 섞이지 않게 한다
    const selected = Array.from({ length: 14 }, (_, i) =>
      makeParcel({ farmerId: `F${i}`, parcelId: `${i}` }),
    );
    const v = validateExtraction(selected, config, riStatsFor(selected));
    expect(v.errors.some((e) => e.code === 'TOTAL_MISMATCH')).toBe(true);
    expect(v.isValid).toBe(false);
  });

  /**
   * 대표필지는 총 목표 '안에' 들어가므로 호출자가 실제 기준을 넘긴다.
   * 이 옵션이 무시되면 대표필지를 병합한 결과가 늘 목표와 어긋난 것으로 보고된다.
   */
  it('options.totalTarget이 config보다 우선한다', () => {
    const selected = [makeParcel({ farmerId: 'F1', parcelId: '1' })];
    // config.totalTarget(3)으로 보면 어긋나지만, 호출자가 넘긴 1을 기준으로 삼아야 한다
    const v = validateExtraction(selected, config, riStatsFor(selected), { totalTarget: 1 });
    expect(v.errors.some((e) => e.code === 'TOTAL_MISMATCH')).toBe(false);
    expect(v.warnings.some((e) => e.code === 'TOTAL_MISMATCH')).toBe(false);
  });

  it('한 농가가 상한을 넘으면 FARMER_OVER_LIMIT을 낸다', () => {
    const selected = [
      makeParcel({ farmerId: 'F1', parcelId: '1' }),
      makeParcel({ farmerId: 'F1', parcelId: '2' }),
      makeParcel({ farmerId: 'F1', parcelId: '3' }),
    ];
    const v = validateExtraction(selected, config, riStatsFor(selected));
    expect(v.errors.some((e) => e.code === 'FARMER_OVER_LIMIT')).toBe(true);
  });

  /**
   * 면제는 카테고리가 아니라 키로 받는다. `parcelCategory === 'representative'`가
   * 사용자 지정 필지·알고리즘이 고른 대체분·이미 슬라이스를 거친 필지를 모두 싸잡기
   * 때문이고, 면제는 사용자가 직접 지정한 것에만 줘야 한다.
   */
  it('exemptFarmerLimitKeys로 지정한 필지는 농가 상한 계산에서 뺀다', () => {
    const over = [
      makeParcel({ farmerId: 'F1', parcelId: '1' }),
      makeParcel({ farmerId: 'F1', parcelId: '2' }),
      makeParcel({ farmerId: 'F1', parcelId: '3' }),
    ];
    const exempt = new Set([parcelMatchKey(over[2])]);
    const v = validateExtraction(over, config, riStatsFor(over), {
      exemptFarmerLimitKeys: exempt,
    });
    expect(v.errors.some((e) => e.code === 'FARMER_OVER_LIMIT')).toBe(false);
  });

  it('기채취 이력이 있는 필지가 섞이면 SAMPLED_INCLUDED를 낸다', () => {
    const selected = [
      makeParcel({ farmerId: 'F1', parcelId: '1' }),
      makeParcel({ farmerId: 'F2', parcelId: '2' }),
      makeParcel({ farmerId: 'F3', parcelId: '3', sampledYears: [2025] }),
    ];
    const v = validateExtraction(selected, config, riStatsFor(selected));
    expect(v.errors.some((e) => e.code === 'SAMPLED_INCLUDED')).toBe(true);
  });

  it('기채취 이력이 없으면 SAMPLED_INCLUDED가 없다', () => {
    const selected = [
      makeParcel({ farmerId: 'F1', parcelId: '1' }),
      makeParcel({ farmerId: 'F2', parcelId: '2' }),
      makeParcel({ farmerId: 'F3', parcelId: '3' }),
    ];
    const v = validateExtraction(selected, config, riStatsFor(selected));
    expect(v.errors.some((e) => e.code === 'SAMPLED_INCLUDED')).toBe(false);
  });
});

describe('generateRiStats / generateFarmerStats', () => {
  // 인자 순서가 (전체, 선택)이다. 둘 다 같은 배열을 넘기면 전수 선택된 상황이라
  // 두 인자가 뒤바뀌어도 통과해 버린다 — 서로 다른 배열로 구분해서 검증한다.
  it('리별로 전체 수와 선택 수를 각각 센다', () => {
    const all = [
      makeParcel({ ri: 'A리', parcelId: '1' }),
      makeParcel({ ri: 'A리', parcelId: '2' }),
      makeParcel({ ri: 'A리', parcelId: '3' }),
      makeParcel({ ri: 'B리', parcelId: '4' }),
    ];
    const selected = [all[0], all[1], all[3]];
    const stats = generateRiStats(all, selected, makeConfig());
    const byRi = Object.fromEntries(stats.map((s) => [s.ri, s]));
    expect(byRi['A리'].selectedCount).toBe(2);
    expect(byRi['B리'].selectedCount).toBe(1);
    expect(byRi['A리'].totalCount).toBe(3);
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
