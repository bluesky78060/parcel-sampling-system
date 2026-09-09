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
    useParcelStore.getState().updateParcels((prev) => [...prev, second]);

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

/**
 * PROJ1-1-49. 위 재현들은 **이 파일의 두 함수가 규칙을 지키는지**를 볼 뿐이다.
 * 다음에 추가될 async 핸들러가 낡은 배열을 넘기는 것은 아무 테스트도 막지 못했다 —
 * 그것은 관례였다.
 *
 * 관례를 시그니처로 옮긴 뒤에는 **타입이 그것을 막는다.** 아래는 그 사실을
 * 못 박는 자리다. 런타임 단언이 아니라 `tsc --noEmit`이 검사한다
 * (`tsconfig.app.json`의 `include`가 `src`이므로 이 파일도 대상이다).
 *
 * 값 전달을 다시 허용하면 `@ts-expect-error`가 쓸모없어져
 * **`tsc`가 "Unused '@ts-expect-error' directive"로 실패한다.** 즉 이 블록은
 * 되돌림을 잡는 변이 탐지기다.
 */
describe('스토어 시그니처가 낡은 배열 전달을 막는다 (타입 수준)', () => {
  it('배열을 직접 넘기면 컴파일되지 않는다', () => {
    const stale = [makeParcel({ parcelId: '낡음' })];
    const st = useParcelStore.getState();

    // @ts-expect-error 낡은 배열을 그대로 넘기는 것이 이 티켓이 막으려는 것이다
    const passArrayToUpdateParcels = () => st.updateParcels(stale);
    // @ts-expect-error 대표필지 쪽도 같은 이유로 함수형만 받는다
    const passArrayToUpdateRep = () => st.updateRepresentativeParcels(stale);

    // 위 두 줄은 타입 검사만이 목적이다. 실제로 부르지 않는다 —
    // 부르면 런타임에서 "stale is not a function"으로 죽을 뿐,
    // 이 블록이 지키려는 것(타입)과는 무관하다.
    expect(typeof passArrayToUpdateParcels).toBe('function');
    expect(typeof passArrayToUpdateRep).toBe('function');

    // 함수형은 당연히 통과한다.
    st.updateParcels((prev) => prev);
    st.updateRepresentativeParcels((prev) => prev);
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

  /**
   * **`generated`만 합치고 `skipped`·`errors`는 공익 쪽에서만 오던 문제.**
   *
   * 화면(`AnalyzePage`)은 이 요약을 그대로 찍는다 — 생성 n건 / 기존 유지 n건 /
   * 매핑 실패 n건. 대표필지가 **매핑조차 안 됐는데** "생성 1건, 오류 없음"이
   * 뜨면 담당자는 PNU가 다 채워진 줄 알고 다음 단계로 넘어간다.
   *
   * 이 함수는 새로 만든 **유일한 기입 지점**이므로 여기서 비대칭을 닫는다.
   * 위의 `대표필지 생성분을 합쳐서 보고한다`는 `generated`만 단언해
   * 비대칭을 절반만 못 박고 있었다.
   */
  it('대표필지의 건너뜀·오류를 삼키지 않는다', () => {
    useParcelStore.setState({
      allParcels: [makeParcel({ pnu: '' })], // 정상 — 생성된다
      representativeParcels: [
        // 매핑 불가 — errors에 잡혀야 한다
        makeParcel({
          pnu: '', eubmyeondong: '없는면', ri: '없는리',
          address: '없는면 없는리 1', parcelCategory: 'representative',
        }),
        // 이미 PNU 보유 — skipped에 잡혀야 한다
        makeParcel({ pnu: '기존PNU', parcelCategory: 'representative' }),
      ],
    });

    const summary = generatePnuAndCommit(false);

    expect(summary.generated).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.errors).toEqual(['(없는면, 없는리) 매핑 없음']);
  });

  /** 양쪽 오류를 합치되, 같은 리가 양쪽에 있으면 한 줄로 접는다. */
  it('공익·대표필지 양쪽 오류를 합치고 중복을 접는다', () => {
    const unknown = (over = {}) =>
      makeParcel({
        pnu: '', eubmyeondong: '없는면', ri: '없는리',
        address: '없는면 없는리 1', ...over,
      });
    useParcelStore.setState({
      allParcels: [unknown()],
      representativeParcels: [
        unknown({ parcelCategory: 'representative' }), // 공익 쪽과 같은 리 — 접힌다
        makeParcel({
          pnu: '', eubmyeondong: '딴면', ri: '딴리',
          address: '딴면 딴리 1', parcelCategory: 'representative',
        }),
      ],
    });

    const summary = generatePnuAndCommit(false);

    expect(summary.generated).toBe(0);
    expect(summary.errors).toEqual([
      '(없는면, 없는리) 매핑 없음',
      '(딴면, 딴리) 매핑 없음',
    ]);
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
