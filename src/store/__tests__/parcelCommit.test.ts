import { beforeEach, describe, expect, it } from 'vitest';
import { useParcelStore } from '../parcelStore';
import { generatePnuAndCommit, runGeocodingAndCommit } from '../parcelCommit';
import { makeParcel } from '../../lib/__tests__/factories';
import type { LatLng, Parcel } from '../../types';

/**
 * PROJ1-1-44. 좌표 변환이 도는 동안 채워진 PNU가 통째로 사라지던 사고.
 *
 * `updateParcels`는 병합이 아니라 전체 교체(`set({ allParcels })`)다. 그래서
 * 좌표 변환이 **시작 시점에 읽어 둔 배열**로 교체하면, 기다리는 수 분 동안
 * 다른 경로가 써 넣은 것이 전부 없어진다.
 *
 * ## 이 테스트가 재현하는 것
 *
 * 화면의 버튼 클릭이 아니라 **스토어 쓰기의 순서**를 재현한다. 이 저장소는
 * `environment: 'node'`라 DOM이 없어 컴포넌트를 렌더할 수 없다. 대신 유실이
 * 실제로 일어나는 층 — `runGeocodingAndCommit`과 `generatePnuAndCommit` —
 * 을 직접, 화면과 같은 순서로 돌린다. 둘 다 화면이 호출하는 그 함수다.
 */

const BONGHWA: LatLng = { lat: 36.893, lng: 128.732 };

/** makeParcel 기본값(봉화읍 내성리 100번지)으로 생성되는 PNU. */
const EXPECTED_PNU = '4792025031' + '1' + '0100' + '0000';

/**
 * 원하는 시점까지 멈춰 있는 지오코딩 실행기.
 *
 * 4만 필지 변환이 수 분 걸리는 구간을 대신한다. `release()`를 부를 때까지
 * `await`에 머물러 있고, 그 사이에 다른 쓰기를 끼워 넣을 수 있다.
 *
 * **보내진 배열을 그대로 붙잡아 좌표만 얹어 돌려준다** — 실제
 * `batchGeocode`도 그렇게 동작한다(입력 필지를 스프레드해 coords를 채운다).
 * 즉 지오코딩 결과에는 시작 시점의 낡은 필드값이 들어 있다.
 */
function gatedGeocoder(coords: LatLng | null = BONGHWA) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const start = async (parcels: Parcel[]): Promise<Parcel[]> => {
    const sent = parcels.map((p) => ({ ...p }));
    await gate;
    return sent.map((p) => ({ ...p, coords }));
  };

  return { start, release: () => release() };
}

beforeEach(() => {
  useParcelStore.setState({
    allParcels: [],
    sampledByYear: {},
    representativeParcels: [],
    duplicateResult: null,
    statistics: null,
  });
});

describe('runGeocodingAndCommit — 실행 중 다른 쓰기와의 경합', () => {
  /**
   * 재현 시나리오 그대로.
   *
   * 1. PNU가 비어 있는 필지로 좌표 변환을 시작한다
   * 2. 변환이 끝나기 전에 PNU 생성이 스토어를 갈아끼운다
   * 3. 변환이 끝나 좌표를 기입한다
   *
   * 3에서 시작 시점 배열을 쓰면 2가 통째로 지워진다.
   */
  it('대기 중에 채워진 PNU를 좌표 기입이 덮어쓰지 않는다', async () => {
    useParcelStore.setState({ allParcels: [makeParcel({ pnu: '' })] });

    const geo = gatedGeocoder();
    const running = runGeocodingAndCommit(geo.start);

    // 좌표 변환이 아직 도는 동안 PNU 생성 버튼이 눌린다
    const pnuSummary = generatePnuAndCommit(false);
    expect(pnuSummary.generated).toBe(1);
    expect(useParcelStore.getState().allParcels[0].pnu).toBe(EXPECTED_PNU);

    geo.release();
    await running;

    const after = useParcelStore.getState().allParcels;
    // 유실 지점: 생성한 PNU가 살아 있어야 한다
    expect(after[0].pnu).toBe(EXPECTED_PNU);
    // 좌표도 함께 반영돼야 한다 — PNU를 지키느라 좌표를 버리면 안 된다
    expect(after[0].coords).toEqual(BONGHWA);
  });

  /** 대표필지도 같은 경로로 교체된다(`setRepresentativeParcels`). */
  it('대표필지에 채워진 PNU도 덮어쓰지 않는다', async () => {
    useParcelStore.setState({
      allParcels: [makeParcel({ pnu: '' })],
      representativeParcels: [makeParcel({ pnu: '', parcelCategory: 'representative' })],
    });

    const geo = gatedGeocoder();
    const running = runGeocodingAndCommit(geo.start);

    generatePnuAndCommit(false);
    geo.release();
    await running;

    const rep = useParcelStore.getState().representativeParcels;
    expect(rep[0].pnu).toBe(EXPECTED_PNU);
    expect(rep[0].coords).toEqual(BONGHWA);
  });

  /**
   * PNU만이 아니라 **대기 중에 추가된 필지**도 남아야 한다.
   *
   * PNU만 검사하면 "결과 배열에 PNU를 다시 얹는" 식의 반쪽 수정이 통과한다.
   * 스토어를 사용 시점에 읽는지가 진짜 조건이므로 길이도 함께 본다.
   */
  it('대기 중에 늘어난 필지가 사라지지 않는다', async () => {
    const first = makeParcel({ parcelId: '100' });
    useParcelStore.setState({ allParcels: [first] });

    const geo = gatedGeocoder();
    const running = runGeocodingAndCommit(geo.start);

    const second = makeParcel({ parcelId: '200' });
    useParcelStore.getState().updateParcels([first, second]);

    geo.release();
    await running;

    const after = useParcelStore.getState().allParcels;
    expect(after).toHaveLength(2);
    expect(after.map((p) => p.parcelId).sort()).toEqual(['100', '200']);
    // 보내진 쪽(first)은 좌표를 받고, 나중에 들어온 쪽은 좌표가 없다
    expect(after.find((p) => p.parcelId === '100')?.coords).toEqual(BONGHWA);
    expect(after.find((p) => p.parcelId === '200')?.coords).toBeUndefined();
  });

  /** 반환값도 스토어와 같아야 한다 — 화면이 이것으로 먼 리를 계산한다. */
  it('반환한 배열이 스토어에 실제로 들어간 배열과 같다', async () => {
    useParcelStore.setState({ allParcels: [makeParcel({ pnu: '' })] });

    const geo = gatedGeocoder();
    const running = runGeocodingAndCommit(geo.start);
    generatePnuAndCommit(false);
    geo.release();
    const returned = await running;

    expect(returned).toEqual(useParcelStore.getState().allParcels);
  });

  it('지오코딩 대상이 없으면 아무것도 쓰지 않고 null을 돌려준다', async () => {
    useParcelStore.setState({ allParcels: [makeParcel({ isEligible: false })] });
    const before = useParcelStore.getState().allParcels;

    const returned = await runGeocodingAndCommit(async () => {
      throw new Error('대상이 없으면 실행기를 부르면 안 된다');
    });

    expect(returned).toBeNull();
    expect(useParcelStore.getState().allParcels).toBe(before);
  });

  /**
   * 좌표를 못 찾은 결과(`coords: null`)는 그대로 반영한다.
   * `applyGeocodedCoords`의 계약이며, 재변환이 낡은 좌표를 지우는 경로다.
   */
  it('좌표를 못 찾은 결과도 반영한다', async () => {
    useParcelStore.setState({ allParcels: [makeParcel({ coords: BONGHWA })] });

    const geo = gatedGeocoder(null);
    const running = runGeocodingAndCommit(geo.start);
    geo.release();
    await running;

    expect(useParcelStore.getState().allParcels[0].coords).toBeNull();
  });
});

describe('generatePnuAndCommit', () => {
  /**
   * 방향만 반대인 같은 사고. 지오코딩이 스토어에 좌표를 넣은 뒤 화면이
   * 리렌더되기 전에 PNU 생성이 돌면, 낡은 스냅샷을 쓸 경우 좌표가 사라진다.
   */
  it('직전에 기입된 좌표를 지우지 않는다', async () => {
    useParcelStore.setState({ allParcels: [makeParcel({ pnu: '' })] });

    const geo = gatedGeocoder();
    const running = runGeocodingAndCommit(geo.start);
    geo.release();
    await running;

    generatePnuAndCommit(false);

    const after = useParcelStore.getState().allParcels;
    expect(after[0].coords).toEqual(BONGHWA);
    expect(after[0].pnu).toBe(EXPECTED_PNU);
  });

  it('기존 PNU가 있으면 건드리지 않는다 (overwrite=false)', () => {
    useParcelStore.setState({ allParcels: [makeParcel({ pnu: '기존PNU' })] });

    const summary = generatePnuAndCommit(false);

    expect(summary.generated).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(useParcelStore.getState().allParcels[0].pnu).toBe('기존PNU');
  });

  it('overwrite=true면 기존 PNU를 다시 만든다', () => {
    useParcelStore.setState({ allParcels: [makeParcel({ pnu: '기존PNU' })] });

    const summary = generatePnuAndCommit(true);

    expect(summary.generated).toBe(1);
    expect(useParcelStore.getState().allParcels[0].pnu).toBe(EXPECTED_PNU);
  });

  it('대표필지 생성분을 합쳐서 보고한다', () => {
    useParcelStore.setState({
      allParcels: [makeParcel({ pnu: '' })],
      representativeParcels: [makeParcel({ pnu: '', parcelCategory: 'representative' })],
    });

    const summary = generatePnuAndCommit(false);

    expect(summary.generated).toBe(2);
    expect(useParcelStore.getState().representativeParcels[0].pnu).toBe(EXPECTED_PNU);
  });

  it('매핑에 없는 리는 오류로 모으고 중복을 접는다', () => {
    const unknown = () =>
      makeParcel({ pnu: '', eubmyeondong: '없는면', ri: '없는리', address: '없는면 없는리 1' });
    useParcelStore.setState({ allParcels: [unknown(), unknown()] });

    const summary = generatePnuAndCommit(false);

    expect(summary.generated).toBe(0);
    expect(summary.errors).toEqual(['(없는면, 없는리) 매핑 없음']);
  });
});
