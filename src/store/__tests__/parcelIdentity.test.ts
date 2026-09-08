import { beforeEach, describe, expect, it } from 'vitest';
import {
  countUniqueSelected,
  dedupeSelected,
  useExtractionStore,
} from '../extractionStore';
import { countUniqueParcels } from '../../lib/parcelKey';
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

/**
 * `addParcel`이 무조건 append하던 것을 멱등하게 바꿨다.
 *
 * 식별 불가능한 필지는 `ResultTable`에서 키로 조회할 수 없어 선택 표시가 켜지지
 * 않았고, **클릭할 때마다 계속 쌓이면서 UI로는 뺄 수 없었다.** 700 산출물이
 * 그만큼 부풀어 엑셀에 그대로 나갔다.
 */
describe('addParcel — 중복 추가가 쌓이지 않는다', () => {
  const makeResult = (selectedParcels: Parcel[]): ExtractionResult => ({
    selectedParcels,
    riStats: [],
    farmerStats: [],
    validation: { isValid: true, warnings: [], errors: [] },
  });

  beforeEach(() => {
    useExtractionStore.setState({ result: null });
  });

  it('같은 필지를 두 번 넣어도 한 번만 들어간다', () => {
    const p = makeParcel({ pnu: 'PNU_A' });
    useExtractionStore.setState({ result: makeResult([]) });

    useExtractionStore.getState().addParcel(p);
    useExtractionStore.getState().addParcel(p);

    expect(useExtractionStore.getState().result!.selectedParcels).toHaveLength(1);
  });

  it('키가 같으면 다른 객체여도 한 번만 들어간다', () => {
    useExtractionStore.setState({ result: makeResult([]) });

    useExtractionStore.getState().addParcel(makeParcel({ pnu: 'PNU_A' }));
    useExtractionStore.getState().addParcel(makeParcel({ pnu: 'PNU_A' }));

    expect(useExtractionStore.getState().result!.selectedParcels).toHaveLength(1);
  });

  it('키가 다르면 각각 들어간다', () => {
    useExtractionStore.setState({ result: makeResult([]) });

    useExtractionStore.getState().addParcel(makeParcel({ pnu: 'PNU_A' }));
    useExtractionStore.getState().addParcel(makeParcel({ pnu: 'PNU_B' }));

    expect(useExtractionStore.getState().result!.selectedParcels).toHaveLength(2);
  });

  it('넣었다 뺄 수 있다', () => {
    const p = makeParcel({ pnu: 'PNU_A' });
    useExtractionStore.setState({ result: makeResult([]) });

    useExtractionStore.getState().addParcel(p);
    expect(useExtractionStore.getState().result!.selectedParcels).toHaveLength(1);

    useExtractionStore.getState().removeParcel(p);
    expect(useExtractionStore.getState().result!.selectedParcels).toHaveLength(0);
  });

  /**
   * PROJ1-1-38 이전에는 여기가 뚫려 있었다. `addParcel`이
   * `{...parcel, isSelected: true}` 사본을 저장하는 순간 참조가 끊겨,
   * 키 없는 필지는 클릭할 때마다 700에 행이 쌓이고 UI로는 뺄 수 없었다.
   *
   * `rowUid`는 파싱 시점에 부여되어 **사본에도 따라가므로** 그 구멍이 없다.
   */
  it('식별 불가능한 필지도 사본을 넘어 중복이 막힌다', () => {
    const p = makeParcel({ pnu: '', address: '', parcelId: '' });
    useExtractionStore.setState({ result: makeResult([]) });

    useExtractionStore.getState().addParcel(p);
    useExtractionStore.getState().addParcel(p);
    useExtractionStore.getState().addParcel(p);

    expect(useExtractionStore.getState().result!.selectedParcels).toHaveLength(1);
  });

  it('식별 불가능한 서로 다른 필지는 각각 들어간다', () => {
    const a = makeParcel({ pnu: '', address: '', parcelId: '' });
    const b = makeParcel({ pnu: '', address: '', parcelId: '' });
    useExtractionStore.setState({ result: makeResult([]) });

    useExtractionStore.getState().addParcel(a);
    useExtractionStore.getState().addParcel(b);

    expect(useExtractionStore.getState().result!.selectedParcels).toHaveLength(2);
  });

  /**
   * 넣은 것을 원본으로 뺄 수 있어야 한다. 예전에는 스토어에 사본이 담겨
   * 원본으로는 참조가 안 맞아 지울 수 없었다.
   */
  it('식별 불가능한 필지를 원본으로 뺄 수 있다', () => {
    const p = makeParcel({ pnu: '', address: '', parcelId: '' });
    useExtractionStore.setState({ result: makeResult([]) });

    useExtractionStore.getState().addParcel(p);
    expect(useExtractionStore.getState().result!.selectedParcels).toHaveLength(1);

    useExtractionStore.getState().removeParcel(p);
    expect(useExtractionStore.getState().result!.selectedParcels).toHaveLength(0);
  });
});

/**
 * `rowUid`가 이 구조의 전제다. 파싱 시점에 부여되고 사본에 따라가야
 * 행 조작이 성립한다.
 */
describe('rowUid', () => {
  it('행마다 다르다', () => {
    const a = makeParcel({ pnu: 'PNU_A' });
    const b = makeParcel({ pnu: 'PNU_A' }); // 같은 필지여도 다른 행
    expect(a.rowUid).not.toBe(b.rowUid);
    expect(a.rowUid).toBeTruthy();
  });

  it('사본에 그대로 따라간다', () => {
    const p = makeParcel({ pnu: 'PNU_A' });
    const copy = { ...p, isSelected: true, parcelCategory: 'representative' as const };
    expect(copy.rowUid).toBe(p.rowUid);
  });

  /**
   * 스토어가 저장하는 것은 사본이다. 그래도 같은 행으로 판정되어야
   * 넣고 빼는 것이 성립한다.
   */
  it('스토어에 담긴 사본도 같은 행으로 판정된다', () => {
    const p = makeParcel({ pnu: '', address: '', parcelId: '' });
    useExtractionStore.setState({
      result: {
        selectedParcels: [],
        riStats: [],
        farmerStats: [],
        validation: { isValid: true, warnings: [], errors: [] },
      },
    });

    useExtractionStore.getState().addParcel(p);
    const stored = useExtractionStore.getState().result!.selectedParcels[0];

    expect(stored).not.toBe(p); // 사본이다
    expect(stored.rowUid).toBe(p.rowUid); // 그러나 같은 행이다
  });
});

/**
 * 식별 불가능한 필지를 어떻게 셀지는 **묻는 질문에 따라 다르다.**
 * 한 함수를 복사해 쓰면 그 차이가 조용히 사라진다.
 */
describe('countUniqueParcels — 정책이 갈린다', () => {
  const unidentified = () => makeParcel({ pnu: '', address: '', parcelId: '' });

  it("'each' — 결과 집계에서는 각각 1건이다", () => {
    expect(countUniqueParcels([unidentified(), unidentified()], 'each')).toBe(2);
  });

  it("'exclude' — 달성 가능성 판정에서는 세지 않는다", () => {
    expect(countUniqueParcels([unidentified(), unidentified()], 'exclude')).toBe(0);
  });

  it('식별 가능한 필지는 두 정책이 같다', () => {
    const ps = [makeParcel({ pnu: 'PNU_A' }), makeParcel({ pnu: 'PNU_B' })];
    expect(countUniqueParcels(ps, 'each')).toBe(2);
    expect(countUniqueParcels(ps, 'exclude')).toBe(2);
  });

  it('countUniqueSelected는 결과 집계 정책을 쓴다', () => {
    expect(countUniqueSelected([unidentified(), unidentified()])).toBe(2);
  });
});

/**
 * PROJ1-1-37이 고친 `allUsedKeys`의 `Set<string | null>` 문제.
 *
 * `new Set([null, 'a']).has(null)`은 `true`다. 그래서 식별 불가능한 필지가 **하나만**
 * 이미 선택돼 있어도, 마스터의 다른 식별 불가능 필지가 **전부** "이미 선택됨"으로
 * 판정돼 대체 후보에서 빠졌다. 타입 검사는 이것을 잡지 못한다 — 완전히 합법이다.
 *
 * 리뷰가 실측한 바로는 이 필터를 되돌려도 237건이 전부 통과했다.
 * **이번 작업의 가장 큰 산출물 영향 수정이 무보호였다.**
 */
describe('대체 보충 — 식별 불가능한 후보가 서로를 밀어내지 않는다', () => {
  beforeEach(() => {
    useExtractionStore.setState({ result: null, config: { ...useExtractionStore.getState().config } });
  });

  it('이미 선정된 키 없는 필지가 나머지 후보를 밀어내지 않는다', () => {
    // 마스터: 식별 불가능한 적격 필지 3건.
    // 공익 추출로 1건이 뽑혀 `taggedPublic`에 들어가면, 그 필지의 키가 `null`이라
    // `allUsedKeys`에 `null`이 담긴다. 그러면 `has(null) === true`가 되어
    // **나머지 2건이 전부 대체 후보에서 빠진다.**
    const unidentified = Array.from({ length: 3 }, () =>
      makeParcel({ pnu: '', address: '', parcelId: '', ri: 'A리', area: 1000 }),
    );
    // 부적격 대표필지 → 대체 보충 경로를 연다
    const badRep = makeParcel({ pnu: 'REP_BAD', ri: 'A리', isEligible: false, area: 1000 });

    useExtractionStore.setState({
      config: {
        ...useExtractionStore.getState().config,
        totalTarget: 2,
        publicPaymentTarget: 1, // 키 없는 필지 1건이 선정돼 allUsedKeys에 null이 들어간다
        perRiTarget: 1,
        maxPerFarmer: 10,
        randomSeed: 42,
        enableLandCategoryFilter: false,
        underfillPolicy: 'skip',
      },
    });

    useExtractionStore.getState().runExtraction(unidentified, [badRep]);

    const result = useExtractionStore.getState().result;
    expect(result).not.toBeNull();

    // 부적격 대표필지 1건을 대체해야 한다. null이 Set에 들어가면 후보가 0건이 되어
    // 하나도 못 채운다.
    const supplemented = result!.selectedParcels.filter(
      (p) => p.parcelCategory === 'representative',
    );
    expect(supplemented).toHaveLength(1);
  });
});
