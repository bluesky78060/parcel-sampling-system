import { describe, expect, it } from 'vitest';
import {
  buildMapSelectedParcels,
  buildTableParcels,
  countMapLegend,
  isParcelSelected,
  mergeWithRepresentatives,
} from '../reviewSelectors';
import { makeParcel } from './factories';

/**
 * 이 계산들은 `ReviewPage`의 `useMemo` 안에 있어 DOM 없이는 테스트할 수 없었다.
 * PROJ1-1-37에서 리뷰가 실측한 결과, 키 처리를 되돌려도 테스트가 전부 통과했다 —
 * 검토 표에서 필지가 증발하고 지도가 안 뽑힌 것을 뽑힌 것으로 그리던 결함들이
 * 무보호였다.
 */

/** 경영체번호가 비고 지번이 같은 두 필지. 리가 달라 실제로는 서로 다른 필지다. */
const munDan = (over = {}) =>
  makeParcel({
    farmerId: '',
    ri: '문단리',
    parcelId: '100',
    address: '경상북도 봉화군 봉화읍 문단리 100',
    pnu: '',
    ...over,
  });

const beopJeon = (over = {}) =>
  makeParcel({
    farmerId: '',
    ri: '법전리',
    parcelId: '100',
    address: '경상북도 봉화군 법전면 법전리 100',
    pnu: '',
    ...over,
  });

describe('mergeWithRepresentatives', () => {
  it('대표필지가 없으면 마스터를 그대로 돌려준다', () => {
    const all = [makeParcel({ pnu: 'PNU_A' })];
    expect(mergeWithRepresentatives(all, [])).toBe(all);
  });

  it('마스터에 없는 대표필지만 더한다', () => {
    const all = [makeParcel({ pnu: 'PNU_A' })];
    const reps = [makeParcel({ pnu: 'PNU_A' }), makeParcel({ pnu: 'PNU_B' })];
    const merged = mergeWithRepresentatives(all, reps);
    expect(merged).toHaveLength(2);
    expect(merged.map((p) => p.pnu)).toEqual(['PNU_A', 'PNU_B']);
  });

  it('같은 필지면 마스터 쪽을 남긴다 (좌표를 갖고 있다)', () => {
    const master = makeParcel({ pnu: 'PNU_A', coords: { lat: 36.9, lng: 128.9 } });
    const rep = makeParcel({ pnu: 'PNU_A', coords: null });
    expect(mergeWithRepresentatives([master], [rep])[0].coords).not.toBeNull();
  });

  /**
   * 키가 없으면 마스터와 같은 필지인지 판정할 수 없다. 접으면 조용히 사라지는데,
   * 대표필지는 반드시 조사해야 하는 고정 관측점이다.
   */
  it('키가 없는 대표필지는 새 것으로 본다', () => {
    const all = [makeParcel({ pnu: 'PNU_A' })];
    const rep = makeParcel({ pnu: '', address: '', parcelId: '' });
    expect(mergeWithRepresentatives(all, [rep])).toHaveLength(2);
  });
});

describe('buildTableParcels', () => {
  it('마스터가 비면 선정분만 돌려준다', () => {
    const selected = [makeParcel({ pnu: 'PNU_A' })];
    expect(buildTableParcels([], selected)).toBe(selected);
  });

  it('선정분을 앞에, 미선정 적격분을 뒤에 둔다', () => {
    const a = makeParcel({ pnu: 'PNU_A' });
    const b = makeParcel({ pnu: 'PNU_B' });
    const table = buildTableParcels([a, b], [a]);
    expect(table).toHaveLength(2);
    expect(table[0].pnu).toBe('PNU_A');
  });

  it('부적격 필지는 목록에 없다', () => {
    const a = makeParcel({ pnu: 'PNU_A', isEligible: false });
    expect(buildTableParcels([a], [])).toHaveLength(0);
  });

  it('선정된 필지가 미선정 목록에 다시 나오지 않는다', () => {
    const a = makeParcel({ pnu: 'PNU_A' });
    expect(buildTableParcels([a], [a])).toHaveLength(1);
  });

  /**
   * **이 결함이 이 파일이 존재하는 이유다.**
   *
   * 예전 키(`farmerId__parcelId`)는 경영체번호가 비면 `__100`이 되어 리를 넘어
   * 충돌했다. 선정된 문단리 필지 때문에 미선정 법전리 필지가 "이미 선택됨"으로
   * 판정되어 **대기 목록에서 빠졌다** — 대체 필지를 고르려 해도 목록에 없었다.
   */
  it('농가 미상 + 같은 지번이어도 리가 다르면 미선정분이 남는다', () => {
    const mun = munDan();
    const beop = beopJeon();
    const table = buildTableParcels([mun, beop], [mun]);
    expect(table).toHaveLength(2);
    expect(table.some((p) => p.ri === '법전리')).toBe(true);
  });

  it('키가 없는 필지는 목록에서 빼지 않는다', () => {
    const unidentified = makeParcel({ pnu: '', address: '', parcelId: '' });
    expect(buildTableParcels([unidentified], [])).toHaveLength(1);
  });

  /**
   * 예전에는 키가 없으면 "알 수 없으니 빼지 않는다"였다. 그래서 키 없는 필지를
   * 추가하는 순간 **같은 행이 표에 두 번 나오고 둘 다 체크된 채로 보였다.**
   * `rowUid`가 생긴 지금은 같은 행인지 알 수 있다.
   */
  it('키가 없어도 이미 선정된 그 행은 미선정 목록에 다시 나오지 않는다', () => {
    const p = makeParcel({ pnu: '', address: '', parcelId: '' });
    const stored = { ...p, isSelected: true }; // 스토어는 사본을 담는다
    expect(buildTableParcels([p], [stored])).toHaveLength(1);
  });

  it('키가 없는 다른 행은 그대로 남는다', () => {
    const a = makeParcel({ pnu: '', address: '', parcelId: '' });
    const b = makeParcel({ pnu: '', address: '', parcelId: '' });
    const table = buildTableParcels([a, b], [{ ...a, isSelected: true }]);
    expect(table).toHaveLength(2);
    expect(table.some((x) => x.rowUid === b.rowUid)).toBe(true);
  });
});

describe('buildMapSelectedParcels', () => {
  it('선정된 필지만 남긴다', () => {
    const a = makeParcel({ pnu: 'PNU_A' });
    const b = makeParcel({ pnu: 'PNU_B' });
    expect(buildMapSelectedParcels([a, b], [a])).toHaveLength(1);
  });

  /**
   * 좌표는 마스터 쪽에서, 분류는 결과 쪽에서 온다. 합치지 않으면 대표필지가
   * 지도에서 초록 별이 아니라 파란 원으로 찍히고 팝업도 "공익직불제"로 나온다.
   */
  it('결과 쪽 분류를 마스터 객체에 씌운다', () => {
    const master = makeParcel({ pnu: 'PNU_A', parcelCategory: 'public-payment' });
    const inResult = makeParcel({ pnu: 'PNU_A', parcelCategory: 'both' });
    const out = buildMapSelectedParcels([master], [inResult]);
    expect(out[0].parcelCategory).toBe('both');
  });

  it('분류가 같으면 새 객체를 만들지 않는다', () => {
    const master = makeParcel({ pnu: 'PNU_A', parcelCategory: 'both' });
    const inResult = makeParcel({ pnu: 'PNU_A', parcelCategory: 'both' });
    expect(buildMapSelectedParcels([master], [inResult])[0]).toBe(master);
  });

  /**
   * 같은 키를 가진 결과 행의 분류가 엇갈리면 어느 쪽도 믿을 수 없다.
   * 나중 항목으로 덮어쓰면 공익직불제 필지가 대표필지 별로 찍히는데,
   * 대표필지는 반드시 조사해야 하는 고정 관측점이라 그쪽이 더 나쁜 신호다.
   */
  it('분류가 엇갈리면 보정을 포기하고 원본을 둔다', () => {
    const master = makeParcel({ pnu: 'PNU_A', parcelCategory: 'public-payment' });
    const r1 = makeParcel({ pnu: 'PNU_A', parcelCategory: 'public-payment' });
    const r2 = makeParcel({ pnu: 'PNU_A', parcelCategory: 'representative' });
    expect(buildMapSelectedParcels([master], [r1, r2])[0].parcelCategory).toBe('public-payment');
  });

  it('키가 없는 필지는 지도에 올리지 않는다', () => {
    const unidentified = makeParcel({ pnu: '', address: '', parcelId: '' });
    expect(buildMapSelectedParcels([unidentified], [unidentified])).toHaveLength(0);
  });
});

describe('isParcelSelected', () => {
  it('같은 필지면 true다', () => {
    const a = makeParcel({ pnu: 'PNU_A' });
    expect(isParcelSelected(a, [makeParcel({ pnu: 'PNU_A' })])).toBe(true);
  });

  it('다른 필지면 false다', () => {
    expect(isParcelSelected(makeParcel({ pnu: 'PNU_A' }), [makeParcel({ pnu: 'PNU_B' })])).toBe(
      false,
    );
  });

  /**
   * 예전에는 `farmerId`·`parcelId` 비교라 이 둘이 같은 필지로 판정됐다 —
   * **마커 색은 회색인데 상세 패널만 "추출 선택"이라고 말했다.**
   */
  it('농가 미상 + 같은 지번이어도 리가 다르면 false다', () => {
    expect(isParcelSelected(beopJeon(), [munDan()])).toBe(false);
  });

  /**
   * 키가 없으면 행 식별자로 본다. 결과 배열에는 사본이 담기므로 참조로는 안 된다.
   */
  it('키가 없으면 행 식별자로 판정한다', () => {
    const p = makeParcel({ pnu: '', address: '', parcelId: '' });
    const copy = { ...p, isSelected: true };
    expect(isParcelSelected(p, [copy])).toBe(true);
  });

  it('키가 없고 행도 다르면 false다', () => {
    const a = makeParcel({ pnu: '', address: '', parcelId: '' });
    const b = makeParcel({ pnu: '', address: '', parcelId: '' });
    expect(isParcelSelected(a, [b])).toBe(false);
  });
});

describe('countMapLegend', () => {
  const years: readonly [number, number] = [2025, 2024];

  it('선정·미선정·기채취를 분류한다', () => {
    const all = [
      makeParcel({ pnu: 'A', coords: { lat: 36.9, lng: 128.9 } }),
      makeParcel({ pnu: 'B', coords: { lat: 36.9, lng: 128.9 } }),
      makeParcel({ pnu: 'C', coords: { lat: 36.9, lng: 128.9 }, sampledYears: [2025] }),
      makeParcel({ pnu: 'D', coords: { lat: 36.9, lng: 128.9 }, sampledYears: [2024] }),
    ];
    const counts = countMapLegend(all, [], [all[0]], years);
    expect(counts.selected).toBe(1);
    expect(counts.unselected).toBe(1);
    expect(counts.sampledByYear[2025]).toBe(1);
    expect(counts.sampledByYear[2024]).toBe(1);
  });

  it('좌표가 없으면 따로 센다', () => {
    const all = [makeParcel({ pnu: 'A', coords: null })];
    expect(countMapLegend(all, [], [], years).noCoords).toBe(1);
  });

  /**
   * 대표필지는 대표필지 배열에서 세고, 마스터 순회에서는 건너뛴다.
   * 건너뛰지 않으면 마스터에도 있는 대표필지가 두 번 세어진다.
   */
  it('마스터에도 있는 대표필지를 두 번 세지 않는다', () => {
    const rep = makeParcel({ pnu: 'A', coords: { lat: 36.9, lng: 128.9 } });
    const master = makeParcel({ pnu: 'A', coords: { lat: 36.9, lng: 128.9 } });
    const counts = countMapLegend([master], [rep], [], years);
    expect(counts.representative).toBe(1);
    expect(counts.unselected).toBe(0);
    expect(counts.selected).toBe(0);
  });

  it('부적격이고 기채취도 아니면 어디에도 안 센다', () => {
    const all = [makeParcel({ pnu: 'A', coords: { lat: 36.9, lng: 128.9 }, isEligible: false })];
    const counts = countMapLegend(all, [], [], years);
    expect(counts.selected + counts.unselected).toBe(0);
  });

  it('기채취 연도가 바뀌어도 그 연도로 집계한다', () => {
    const all = [makeParcel({ pnu: 'A', coords: { lat: 36.9, lng: 128.9 }, sampledYears: [2030] })];
    const counts = countMapLegend(all, [], [], [2030, 2029]);
    expect(counts.sampledByYear[2030]).toBe(1);
  });
});
