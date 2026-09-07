import { beforeEach, describe, expect, it } from 'vitest';
import {
  countUniqueSelected,
  dedupeSelected,
  useExtractionStore,
} from '../extractionStore';
import { makeParcel } from '../../lib/__tests__/factories';
import type { ExtractionResult, Parcel } from '../../types';

/**
 * PROJ1-1-37. 필지를 식별하는 키가 저장소 여기저기에 다른 공식으로 흩어져 있었고,
 * 그중 `${farmerId}__${parcelId}`는 **경영체번호가 비면 리를 넘어 충돌**했다
 * (한 농가가 A리·B리에 같은 지번을 가질 수 있다).
 *
 * PROJ1-1-30이 농가 미상 필지를 추출 후보로 되살리면서 이 충돌의 노출 규모가 커졌다 —
 * 전에는 리당 2건만 결과에 들어갔는데 이제 전부 들어간다.
 */

/** 경영체번호가 비고 지번이 같은 두 필지. 리가 달라 실제로는 서로 다른 필지다. */
const munDanRi = () =>
  makeParcel({
    farmerId: '',
    ri: '문단리',
    parcelId: '100',
    address: '경상북도 봉화군 봉화읍 문단리 100',
    pnu: '',
  });

const beopJeonRi = () =>
  makeParcel({
    farmerId: '',
    ri: '법전리',
    parcelId: '100',
    address: '경상북도 봉화군 법전면 법전리 100',
    pnu: '',
  });

describe('dedupeSelected', () => {
  it('같은 필지는 1건으로 접는다', () => {
    const a = makeParcel({ pnu: 'PNU_A' });
    const b = makeParcel({ pnu: 'PNU_A' });
    expect(dedupeSelected([a, b])).toHaveLength(1);
  });

  /**
   * 예전 키로는 둘 다 `''__100`이라 한 건으로 접혔다 — 한쪽이 결과에서 사라진다.
   */
  it('경영체번호가 비고 지번이 같아도 리가 다르면 접지 않는다', () => {
    expect(dedupeSelected([munDanRi(), beopJeonRi()])).toHaveLength(2);
  });

  /**
   * PNU·주소·지번이 모두 빈 행은 식별할 방법이 없다. 접으면 조용히 사라지므로
   * 각각 남긴다 — 빈 키끼리 같은 필지로 볼 근거가 없다.
   */
  it('식별 불가능한 필지는 접지 않고 각각 남긴다', () => {
    const a = makeParcel({ pnu: '', address: '', parcelId: '' });
    const b = makeParcel({ pnu: '', address: '', parcelId: '' });
    expect(dedupeSelected([a, b])).toHaveLength(2);
  });

  it('공익직불제 행을 앞에 두면 그것이 남는다', () => {
    const pub = makeParcel({ pnu: 'PNU_A', parcelCategory: 'public-payment' });
    const rep = makeParcel({ pnu: 'PNU_A', parcelCategory: 'representative' });
    expect(dedupeSelected([pub, rep])[0].parcelCategory).toBe('public-payment');
  });
});

describe('countUniqueSelected', () => {
  it('같은 필지는 1건으로 센다', () => {
    expect(countUniqueSelected([makeParcel({ pnu: 'PNU_A' }), makeParcel({ pnu: 'PNU_A' })])).toBe(1);
  });

  it('리가 다르면 지번이 같아도 2건이다', () => {
    expect(countUniqueSelected([munDanRi(), beopJeonRi()])).toBe(2);
  });

  /**
   * 한 덩어리로 세면 결과 수가 실제보다 적게 나와 목표 미달로 오판된다.
   */
  it('식별 불가능한 필지는 각각 1건으로 센다', () => {
    const a = makeParcel({ pnu: '', address: '', parcelId: '' });
    const b = makeParcel({ pnu: '', address: '', parcelId: '' });
    expect(countUniqueSelected([a, b])).toBe(2);
  });
});

/**
 * **이 저장소에서 가장 조용한 손실 경로였다.**
 *
 * 예전에는 `p.farmerId === farmerId && p.parcelId === parcelId`로 지웠다.
 * 검토 화면에서 문단리의 농가 미상 지번 100을 한 건 빼면 법전리의 것도 함께
 * 700건에서 사라졌고, 화면에는 아무 표시도 없었다.
 */
describe('removeParcel — 삭제가 번지지 않는다', () => {
  const makeResult = (selectedParcels: Parcel[]): ExtractionResult => ({
    selectedParcels,
    riStats: [],
    farmerStats: [],
    validation: { isValid: true, warnings: [], errors: [] },
  });

  beforeEach(() => {
    useExtractionStore.setState({ result: null });
  });

  it('지정한 필지만 지운다', () => {
    const mun = munDanRi();
    const beop = beopJeonRi();
    useExtractionStore.setState({ result: makeResult([mun, beop]) });

    useExtractionStore.getState().removeParcel(mun);

    const left = useExtractionStore.getState().result!.selectedParcels;
    expect(left).toHaveLength(1);
    expect(left[0].ri).toBe('법전리');
  });

  it('같은 필지가 두 행으로 들어 있으면 둘 다 지운다', () => {
    // 같은 PNU = 같은 필지. 공익직불제 행과 대표필지 행으로 두 번 들어올 수 있다.
    const a = makeParcel({ pnu: 'PNU_A', parcelCategory: 'public-payment' });
    const b = makeParcel({ pnu: 'PNU_A', parcelCategory: 'representative' });
    const other = makeParcel({ pnu: 'PNU_B' });
    useExtractionStore.setState({ result: makeResult([a, b, other]) });

    useExtractionStore.getState().removeParcel(a);

    const left = useExtractionStore.getState().result!.selectedParcels;
    expect(left).toHaveLength(1);
    expect(left[0].pnu).toBe('PNU_B');
  });

  /**
   * 키가 없으면 다른 필지와 구분할 방법이 없다. 참조로만 지워야
   * 무관한 행이 함께 사라지지 않는다.
   */
  it('식별 불가능한 필지는 그 객체만 지운다', () => {
    const a = makeParcel({ pnu: '', address: '', parcelId: '' });
    const b = makeParcel({ pnu: '', address: '', parcelId: '' });
    useExtractionStore.setState({ result: makeResult([a, b]) });

    useExtractionStore.getState().removeParcel(a);

    const left = useExtractionStore.getState().result!.selectedParcels;
    expect(left).toHaveLength(1);
    expect(left[0]).toBe(b);
  });

  it('결과가 없으면 아무 일도 하지 않는다', () => {
    useExtractionStore.getState().removeParcel(munDanRi());
    expect(useExtractionStore.getState().result).toBeNull();
  });
});
