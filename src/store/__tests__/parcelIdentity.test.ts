import { beforeEach, describe, expect, it } from 'vitest';
import {
  countUniqueSelected,
  dedupeSelected,
  useExtractionStore,
} from '../extractionStore';
import { countUniqueParcels } from '../../lib/parcelKey';
import { isPublicPayment, isRepresentative } from '../../lib/parcelCategory';
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
    // `=== 'representative'`로 비교하면 안 된다 — 경영체번호가 있는 대표필지는
    // `'both'`(공익직불제 혼용)라 놓친다. 판정은 헬퍼를 거친다.
    const supplemented = result!.selectedParcels.filter(isRepresentative);
    expect(supplemented).toHaveLength(1);
  });
});

/**
 * PROJ1-1-39. `selectedKeySet`만 `null`을 거르지 않았다.
 *
 * 형제 두 줄(`selectedFarmerKeySet`)도, `allUsedKeys`도, `exemptKeys`도 전부 거르는데
 * 여기만 빠져 있었다. `new Set([null]).has(null)`이 `true`라서, 공익 추출에 뽑힌
 * 필지 중 키 없는 것이 하나라도 있으면 **무관한 키 없는 적격 대표필지가 전부**
 * `repDirect`에서 빠진다. 경고도 콘솔 메시지도 안 뜬다.
 */
describe('적격 대표필지 추가 — 무관한 필지의 데이터 품질에 좌우되지 않는다', () => {
  beforeEach(() => {
    useExtractionStore.setState({
      result: null,
      config: { ...useExtractionStore.getState().config },
    });
  });

  /**
   * 경영체번호를 갈라 둔다. 같으면 `parcelFarmerKey`(`farmerId_ri_parcelId`)가
   * 둘 다 `F001_A리_`로 충돌해 마스터가 대표필지로 태깅되고, 그러면 대표필지 행이
   * 사라졌는데도 `isRepresentative` 집계가 1이 되어 **테스트가 거짓 통과한다.**
   * 실제로 이 함정에 한 번 걸렸다.
   */
  const setup = (masterKeyed: boolean) => {
    const master = makeParcel(
      masterKeyed
        ? { farmerId: 'F_MASTER', pnu: 'PNU_MASTER', ri: 'A리', area: 1000 }
        : { farmerId: 'F_MASTER', pnu: '', address: '', parcelId: '', ri: 'A리', area: 1000 },
    );
    // 키 없는 적격 대표필지. 마스터와는 아무 관계가 없다.
    const rep = makeParcel({
      farmerId: 'F_REP',
      pnu: '',
      address: '',
      parcelId: '',
      ri: 'A리',
      area: 1000,
    });

    useExtractionStore.setState({
      config: {
        ...useExtractionStore.getState().config,
        totalTarget: 10,
        publicPaymentTarget: 10,
        perRiTarget: 5,
        maxPerFarmer: 10,
        randomSeed: 42,
        enableLandCategoryFilter: false,
        underfillPolicy: 'skip',
      },
    });
    useExtractionStore.getState().runExtraction([master], [rep]);
    return { result: useExtractionStore.getState().result!, rep };
  };

  it('마스터에 키가 있으면 대표필지가 결과에 들어간다', () => {
    const { result, rep } = setup(true);
    expect(result.selectedParcels.map((p) => p.rowUid)).toContain(rep.rowUid);
    expect(result.selectedParcels.filter(isRepresentative)).toHaveLength(1);
  });

  /**
   * **이것이 이 티켓의 CRITICAL이다.** 마스터의 데이터 품질만 바뀌었을 뿐
   * 대표필지는 그대로인데 대표필지가 결과에서 사라졌다.
   *
   * 실측(수정 전): 마스터에 키가 있으면 2행 `["public-payment","representative"]`,
   * 키가 없으면 **1행 `["public-payment"]`** — 대표필지 증발.
   * 그런데 `representativeSummary.limited`는 그대로 1이라 **화면 숫자와 산출물이
   * 어긋난다.** 경고도 콘솔 메시지도 뜨지 않는다.
   */
  it('마스터에 키가 없어도 대표필지가 사라지지 않는다', () => {
    const { result, rep } = setup(false);
    expect(result.selectedParcels.map((p) => p.rowUid)).toContain(rep.rowUid);
    expect(result.selectedParcels.filter(isRepresentative)).toHaveLength(1);
  });

  /** 화면이 "1건 포함"이라고 말하면 산출물에도 1건이 있어야 한다. */
  it('화면의 대표필지 수와 산출물의 대표필지 수가 같다', () => {
    const { result } = setup(false);
    expect(result.selectedParcels.filter(isRepresentative)).toHaveLength(
      result.representativeSummary!.limited,
    );
  });
});

/**
 * PROJ1-1-39. `masterCandidates`가 키 없는 후보를 무조건 통과시키고, 보충 루프도
 * `if (k !== null)` 안에서만 중복을 본다. 그래서 **이미 `taggedPublic`에 들어 있는
 * 키 없는 마스터 행이 대체 보충으로 다시 담긴다.**
 *
 * `dedupeSelected`는 키 없는 필지를 접지 않고(의도된 규칙), `countUniqueSelected`는
 * `'each'`라 2건으로 센다. 700 목표가 실제 699필지 + 중복 1행으로 채워진다.
 */
describe('대체 보충 — 같은 행을 두 번 싣지 않는다', () => {
  beforeEach(() => {
    useExtractionStore.setState({
      result: null,
      config: { ...useExtractionStore.getState().config },
    });
  });

  it('공익에 이미 뽑힌 키 없는 행이 대체 보충으로 다시 담기지 않는다', () => {
    const unidentified = Array.from({ length: 3 }, () =>
      makeParcel({ pnu: '', address: '', parcelId: '', ri: 'A리', area: 1000 }),
    );
    const badRep = makeParcel({ pnu: 'REP_BAD', ri: 'A리', isEligible: false, area: 1000 });

    useExtractionStore.setState({
      config: {
        ...useExtractionStore.getState().config,
        totalTarget: 10,
        publicPaymentTarget: 10,
        perRiTarget: 3,
        maxPerFarmer: 10,
        randomSeed: 42,
        enableLandCategoryFilter: false,
        underfillPolicy: 'skip',
      },
    });
    useExtractionStore.getState().runExtraction(unidentified, [badRep]);

    const rows = useExtractionStore.getState().result!.selectedParcels;
    const uids = rows.map((p) => p.rowUid);
    // 마스터 행이 3개뿐인데 결과가 4행이면 한 행이 두 번 실린 것이다
    expect(new Set(uids).size).toBe(uids.length);
    expect(rows.length).toBeLessThanOrEqual(3);
  });
});

/**
 * 대체 보충 루프는 담은 것을 **바로** 집합에 반영해야 한다.
 *
 * 마스터에는 같은 지번이 작물별로 여러 행 있다. 루프 전에 만든 집합만 보면 그 쌍이
 * 둘 다 담기고 뒤의 `dedupeSelected`가 하나로 접는다 — **대체 복사 200건이 조용히
 * 100건이 됐고 "대체 부족" 경고도 안 떴다.**
 *
 * 이 규칙은 코드 주석에만 있었고 테스트가 없었다(PROJ1-1-39 변이 검증에서 발견).
 */
describe('대체 보충 — 담은 것을 바로 반영한다', () => {
  beforeEach(() => {
    useExtractionStore.setState({
      result: null,
      config: { ...useExtractionStore.getState().config },
    });
  });

  it('같은 필지의 다른 작물 행을 두 번 담지 않는다', () => {
    // 같은 지번(=같은 필지 키)의 두 행 — 작물만 다르다
    const dupA1 = makeParcel({ pnu: 'PNU_A', ri: 'A리', area: 1000, cropType: '벼' });
    const dupA2 = makeParcel({ pnu: 'PNU_A', ri: 'A리', area: 1000, cropType: '콩' });
    const distinctB = makeParcel({ pnu: 'PNU_B', ri: 'A리', area: 1000 });
    // 부적격 대표필지 2건 → 대체 2건을 채워야 한다
    const badReps = [
      makeParcel({ pnu: 'REP_X', ri: 'A리', isEligible: false, area: 1000 }),
      makeParcel({ pnu: 'REP_Y', ri: 'A리', isEligible: false, area: 1000 }),
    ];

    useExtractionStore.setState({
      config: {
        ...useExtractionStore.getState().config,
        totalTarget: 10,
        // `publicPaymentTarget: 0`이면 `extractParcels`가 아예 호출되지 않는다
        // (extractionStore의 `publicTarget > 0` 분기). 보충 루프만 격리해 본다.
        // 그래서 `perRiTarget`은 여기서 아무 의미가 없다 — 적지 않는다.
        publicPaymentTarget: 0,
        maxPerFarmer: 10,
        randomSeed: 42,
        enableLandCategoryFilter: false,
        underfillPolicy: 'skip',
      },
    });
    useExtractionStore.getState().runExtraction([dupA1, dupA2, distinctB], badReps);

    const rows = useExtractionStore.getState().result!.selectedParcels;
    // PNU_A를 두 행 담으면 dedupe가 하나로 접어 결국 1건이 된다 —
    // 그러면 부적격 2건을 대체한다고 해 놓고 실제로는 1건만 나간다
    expect(rows.filter((p) => p.pnu === 'PNU_A')).toHaveLength(1);
    expect(rows.map((p) => p.pnu).sort()).toEqual(['PNU_A', 'PNU_B']);
  });
});

/**
 * PROJ1-1-39 리뷰가 실측으로 찾은 무보호 가드 둘. 되돌려도 278건이 전부 통과했다.
 */
describe('무보호였던 가드', () => {
  beforeEach(() => {
    useExtractionStore.setState({
      result: null,
      config: { ...useExtractionStore.getState().config },
    });
  });

  /**
   * `repNotInPublic`의 `farmerKey` 절. PNU가 서로 달라 `matchKey`로는 안 걸리지만
   * 같은 농가·리·지번이면 같은 필지로 본다 — 대표필지 파일과 마스터 파일의 PNU 표기가
   * 다를 수 있어서 둔 폴백이다. 이것이 없으면 **같은 필지가 공익 행과 대표 행으로
   * 두 번 실린다.**
   */
  it('PNU가 달라도 농가·리·지번이 같으면 대표필지를 두 번 싣지 않는다', () => {
    const master = makeParcel({
      farmerId: 'F1',
      ri: 'A리',
      parcelId: '100',
      pnu: 'PNU_MASTER',
      area: 1000,
    });
    // 같은 필지인데 대표필지 파일에는 PNU가 다르게 적혀 있다
    const rep = makeParcel({
      farmerId: 'F1',
      ri: 'A리',
      parcelId: '100',
      pnu: 'PNU_REP_DIFFERENT',
      area: 1000,
    });

    useExtractionStore.setState({
      config: {
        ...useExtractionStore.getState().config,
        totalTarget: 10,
        publicPaymentTarget: 10,
        perRiTarget: 5,
        maxPerFarmer: 10,
        randomSeed: 42,
        enableLandCategoryFilter: false,
        underfillPolicy: 'skip',
      },
    });
    useExtractionStore.getState().runExtraction([master], [rep]);

    const rows = useExtractionStore.getState().result!.selectedParcels;
    // 태깅만 되어야 한다 — 행이 새로 생기면 안 된다
    expect(rows).toHaveLength(1);
    expect(isRepresentative(rows[0])).toBe(true);
  });

  /**
   * `exemptKeys`는 **`repDirect`(공익에 안 뽑혀 따로 추가된 대표필지)만** 면제한다.
   * `taggedPublic`은 사용자 지정이긴 하나 **농가별 슬라이스를 이미 거쳐** 뽑힌 것이라
   * 면제할 이유가 없다. 거기까지 면제하면 한 농가에 몰려도 상한 경고가 안 뜬다.
   */
  it('공익에서 뽑힌 대표필지는 농가 상한 면제 대상이 아니다', () => {
    // 한 농가에 여러 필지. 상한이 1이라 공익 추출은 1건만 뽑는다.
    const master = Array.from({ length: 4 }, (_, i) =>
      makeParcel({ farmerId: 'F_HEAVY', ri: 'A리', parcelId: `${100 + i}`, area: 1000 }),
    );
    // 마스터의 100번과 같은 필지 → 공익 추출에 우선 선택되어 taggedPublic이 된다
    const repInPublic = makeParcel({
      farmerId: 'F_HEAVY',
      ri: 'A리',
      parcelId: '100',
      area: 1000,
    });
    // 부적격 대표필지 → 대체 보충이 F_HEAVY의 다른 필지를 끌어와 상한을 넘긴다
    const badRep = makeParcel({
      farmerId: 'F_OTHER',
      ri: 'A리',
      parcelId: '900',
      isEligible: false,
      area: 1000,
    });

    useExtractionStore.setState({
      config: {
        ...useExtractionStore.getState().config,
        totalTarget: 10,
        publicPaymentTarget: 10,
        perRiTarget: 5,
        maxPerFarmer: 1,
        randomSeed: 42,
        enableLandCategoryFilter: false,
        underfillPolicy: 'skip',
      },
    });
    useExtractionStore.getState().runExtraction(master, [repInPublic, badRep]);

    const v = useExtractionStore.getState().result!.validation;
    const overLimit = [...v.warnings, ...v.errors].filter(
      (m) => m.code === 'FARMER_OVER_LIMIT',
    );
    expect(overLimit.length).toBeGreaterThan(0);
  });
});

/**
 * PROJ1-1-41. 사용자 보고: "경영체번호가 있는 필지는 공익직불제와 혼용이 가능한데
 * 대표필지로만 되어 있네."
 *
 * `repDirect`·`repSupplements`를 `'representative'`로 **무조건 덮어쓰면**
 * `isPublicPayment`가 false가 되어 공익직불제 시트에서 사라진다 —
 * **담당자에게 나가는 제출 파일의 행 수가 조용히 줄어든다.**
 * 같은 위험이 `taggedPublic`에는 이미 주석으로 적혀 있었는데 여기만 빠져 있었다.
 */
describe('대표필지와 공익직불제의 혼용', () => {
  beforeEach(() => {
    useExtractionStore.setState({
      result: null,
      config: { ...useExtractionStore.getState().config },
    });
  });

  const config = {
    totalTarget: 10,
    publicPaymentTarget: 10,
    perRiTarget: 5,
    maxPerFarmer: 10,
    randomSeed: 42,
    enableLandCategoryFilter: false,
    underfillPolicy: 'skip' as const,
  };

  const runWith = (master: Parcel[], reps: Parcel[]) => {
    useExtractionStore.setState({
      config: { ...useExtractionStore.getState().config, ...config },
    });
    useExtractionStore.getState().runExtraction(master, reps);
    return useExtractionStore.getState().result!.selectedParcels;
  };

  it('경영체번호가 있는 적격 대표필지는 양쪽 시트에 실린다', () => {
    const master = makeParcel({ farmerId: 'F_M', pnu: 'PNU_M', ri: 'A리', area: 1000 });
    // 공익 추출에 안 뽑히는 별개 대표필지 (repDirect 경로)
    const rep = makeParcel({ farmerId: 'F_R', pnu: 'PNU_R', ri: 'A리', area: 1000 });

    const rows = runWith([master], [rep]);
    const repRow = rows.find((p) => p.pnu === 'PNU_R')!;
    expect(repRow).toBeDefined();
    expect(repRow.parcelCategory).toBe('both');
    expect(isRepresentative(repRow)).toBe(true);
    expect(isPublicPayment(repRow)).toBe(true); // ← 공익직불제 시트에 실린다
  });

  it('경영체번호가 없는 대표필지는 대표필지 시트에만 남는다', () => {
    const master = makeParcel({ farmerId: 'F_M', pnu: 'PNU_M', ri: 'A리', area: 1000 });
    const rep = makeParcel({ farmerId: '', pnu: 'PNU_R', ri: 'A리', area: 1000 });

    const rows = runWith([master], [rep]);
    const repRow = rows.find((p) => p.pnu === 'PNU_R')!;
    expect(repRow.parcelCategory).toBe('representative');
    expect(isPublicPayment(repRow)).toBe(false); // ← 공익직불제 대상이 아니다
  });

  it('대체 보충분도 경영체번호가 있으면 혼용이다', () => {
    const master = [
      makeParcel({ farmerId: 'F_A', pnu: 'PNU_A', ri: 'A리', area: 1000 }),
      makeParcel({ farmerId: 'F_B', pnu: 'PNU_B', ri: 'A리', area: 1000 }),
    ];
    const badRep = makeParcel({
      farmerId: 'F_X',
      pnu: 'REP_BAD',
      ri: 'A리',
      isEligible: false,
      area: 1000,
    });

    // 공익 목표를 1로 줄여 마스터 한 건을 대체 후보로 남긴다.
    // 목표가 크면 마스터가 전부 공익에 뽑혀 보충할 후보가 없다.
    useExtractionStore.setState({
      config: { ...useExtractionStore.getState().config, ...config, publicPaymentTarget: 1, perRiTarget: 1 },
    });
    useExtractionStore.getState().runExtraction(master, [badRep]);
    const rows = useExtractionStore.getState().result!.selectedParcels;
    const supplements = rows.filter(isRepresentative);
    expect(supplements.length).toBeGreaterThan(0);
    for (const s of supplements) {
      expect(s.parcelCategory).toBe('both');
      expect(isPublicPayment(s)).toBe(true);
    }
  });

  /**
   * **행 수 대조.** 분류만 바뀌는 것이므로 총 선정 건수와 대표필지 시트 행 수는
   * 그대로여야 하고, 공익직불제 시트만 늘어야 한다.
   */
  it('총 건수와 대표필지 시트는 그대로이고 공익직불제 시트만 늘어난다', () => {
    const master = makeParcel({ farmerId: 'F_M', pnu: 'PNU_M', ri: 'A리', area: 1000 });
    const repWithId = makeParcel({ farmerId: 'F_R', pnu: 'PNU_R', ri: 'A리', area: 1000 });
    const repNoId = makeParcel({ farmerId: '', pnu: 'PNU_N', ri: 'A리', area: 1000 });

    const rows = runWith([master], [repWithId, repNoId]);
    expect(rows).toHaveLength(3); // 행이 늘지 않는다
    // 대표필지 시트: 두 대표필지 모두
    expect(rows.filter(isRepresentative)).toHaveLength(2);
    // 공익직불제 시트: 마스터 + 번호 있는 대표필지 (번호 없는 것은 빠진다)
    expect(rows.filter(isPublicPayment)).toHaveLength(2);
  });
});

/**
 * PROJ1-1-41 리뷰가 지적한 **세 번째 경로**. 사용자 결정(2026-09-08)으로 현행을 확정했다.
 *
 * `taggedPublic`(공익 추출이 실제로 뽑은 대표필지)은 `markAsRepresentative`가 처리하고
 * **경영체번호를 보지 않는다.** 번호가 비어도 이미 700 안에 들어간 행이므로 공익직불제
 * 시트에 있는 것이 맞다 — 빼면 제출 파일의 행 수가 줄어든다. 번호가 빈 것은
 * `FARMER_ID_MISSING` 경고가 따로 알린다.
 *
 * "세 경로를 통일한다"며 이것을 `representativeCategoryOf`로 옮기면 그 결함이
 * 정확히 되살아난다. 그 통일이 조용히 들어오지 못하게 못 박아 둔다.
 */
describe('공익 추출이 뽑은 대표필지는 번호가 없어도 공익직불제 시트에 남는다', () => {
  beforeEach(() => {
    useExtractionStore.setState({
      result: null,
      config: { ...useExtractionStore.getState().config },
    });
  });

  it('번호 없는 대표필지가 공익에 뽑히면 both다', () => {
    // 마스터와 대표필지가 같은 필지(PNU 일치) → 공익 추출이 뽑으면 taggedPublic이 된다
    const shared = makeParcel({ farmerId: '', pnu: 'PNU_SHARED', ri: 'A리', area: 1000 });
    const rep = makeParcel({ farmerId: '', pnu: 'PNU_SHARED', ri: 'A리', area: 1000 });

    useExtractionStore.setState({
      config: {
        ...useExtractionStore.getState().config,
        totalTarget: 10,
        publicPaymentTarget: 10,
        perRiTarget: 5,
        maxPerFarmer: 10,
        randomSeed: 42,
        enableLandCategoryFilter: false,
        underfillPolicy: 'skip',
      },
    });
    useExtractionStore.getState().runExtraction([shared], [rep]);

    const row = useExtractionStore
      .getState()
      .result!.selectedParcels.find((p) => p.pnu === 'PNU_SHARED')!;
    expect(row.parcelCategory).toBe('both');
    expect(isPublicPayment(row)).toBe(true); // ← 공익직불제 시트에 남는다
    expect(isRepresentative(row)).toBe(true);
  });
});
