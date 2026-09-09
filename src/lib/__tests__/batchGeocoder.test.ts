import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeocodeFailureKind, PnuPrefetchResult } from '../kakaoGeocoder';
import type { LatLng, Parcel } from '../../types';
import { makeParcel } from './factories';

/**
 * `batchGeocoder`는 653줄로 지오코딩 경로 전체를 지고 있는데 **테스트가 한 건도
 * 없었다.** PROJ1-1-42 리뷰어가 결함을 재현하려 일회용 모킹 하네스를 직접 만들어야
 * 했고, 그 결함(PROJ1-1-43)이 여기서 처음 고정된다.
 *
 * 네트워크·IndexedDB에 닿는 것은 `kakaoGeocoder` 하나뿐이라 그것만 대신하면
 * 나머지 로직은 node에서 그대로 돈다. 오류 클래스는 `instanceof`로 분기하므로
 * **진짜를 쓴다** — 가짜로 만들면 분기가 전부 else로 떨어져 테스트가 거짓 통과한다.
 */

const { RateLimitError, GeocodeServiceError } = await vi.importActual<
  typeof import('../kakaoGeocoder')
>('../kakaoGeocoder');

type PrefetchOptions = NonNullable<
  Parameters<typeof import('../kakaoGeocoder')['prefetchPolygonsByPnu']>[1]
>;
type HealthResult = Awaited<
  ReturnType<typeof import('../kakaoGeocoder')['checkGeocodingService']>
>;

/** 주소 → 좌표. 이 함수를 갈아 끼워 서버 동작을 흉내낸다 */
let geocodeImpl: (address: string) => Promise<LatLng | null>;
/** 주소 지오코딩이 **실제로 나간** 주소들. dedup·캐시가 네트워크를 줄였는지 본다 */
let geocodeCalls: string[];

/**
 * PNU → 좌표 스냅 캐시.
 *
 * 실제 모듈에서는 `prefetchPolygonsByPnu`가 이 캐시에 채워 넣고 `getSnappedCoord`가
 * 읽는다. 둘을 서로 무관한 고정값으로 모킹하면 **"조회한 뒤에야 스냅이 생긴다"는
 * 순서가 사라져**, Phase 0를 통째로 지워도 스냅이 처음부터 있는 것처럼 보인다.
 * 같은 Map을 공유시켜 그 순서를 하네스가 지키게 한다.
 */
let snapStore: Map<string, LatLng>;
/** Phase 0 조회. snapStore에 채워 넣는 것까지가 흉내의 일부다 */
let prefetchImpl: (pnus: string[], options?: PrefetchOptions) => Promise<PnuPrefetchResult>;
/** Phase 0 조회에 실제로 넘어간 PNU 목록 (호출당 한 배열) */
let prefetchCalls: string[][];
/** 주소 캐시 회수. 인자는 `normalizeAddressLotNumber`를 거친 주소다 */
let cachedCoordsImpl: (address: string) => LatLng | null;
let healthImpl: () => Promise<HealthResult>;
/** 사전 헬스체크가 몇 번 나갔는가 (캐시 회수가 네트워크보다 먼저인지 본다) */
let healthCalls: number;

vi.mock('../kakaoGeocoder', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../kakaoGeocoder')>();
  return {
    ...actual,
    isGeocodingAvailable: () => true,
    warmupCache: async () => 0,
    getCachedCoords: (address: string) => cachedCoordsImpl(address),
    getSnappedCoord: (pnu: string) => snapStore.get(pnu) ?? null,
    prefetchPolygonsByPnu: (pnus: string[], options?: PrefetchOptions) => {
      prefetchCalls.push([...pnus]);
      return prefetchImpl(pnus, options);
    },
    checkGeocodingService: () => {
      healthCalls++;
      return healthImpl();
    },
    geocodeAddress: (address: string) => {
      geocodeCalls.push(address);
      return geocodeImpl(address);
    },
  };
});

/** Phase 0가 아무것도 하지 않았을 때의 반환값 */
const NO_PREFETCH: PnuPrefetchResult = {
  snapped: 0, failedRi: [], serviceDown: false, failureKind: null, lastError: null,
};

/** Phase 0가 서버 장애로 중단했을 때의 반환값 */
function downPrefetch(kind: GeocodeFailureKind, lastError: string, failedRi: string[] = []): PnuPrefetchResult {
  return { snapped: 0, failedRi, serviceDown: true, failureKind: kind, lastError };
}

const { batchGeocode } = await import('../batchGeocoder');

const AT = (lat: number): LatLng => ({ lat, lng: 128.9 });

/** 좌표를 이미 가진 필지 n건. PNU를 비워 Phase 0를 타지 않게 한다 */
function withCoords(n: number): Parcel[] {
  return Array.from({ length: n }, (_, i) =>
    makeParcel({
      pnu: '',
      parcelId: `${100 + i}`,
      address: `경상북도 봉화군 봉화읍 내성리 ${100 + i}`,
      coords: AT(36.1),
    }),
  );
}

/**
 * 같은 주소를 가진 필지 n건. `makeParcel`은 주소를 `parcelId`에서 파생시키므로
 * 기본 팩토리로는 주소가 전부 달라 **dedup 팬아웃 경로가 한 번도 돌지 않는다.**
 */
function sameAddress(n: number, address: string, coords: LatLng | null = null): Parcel[] {
  return Array.from({ length: n }, (_, i) =>
    makeParcel({ pnu: '', parcelId: `${900 + i}`, address, coords }),
  );
}

/**
 * PNU 19자리 = [시도2][시군구3][읍면동3][리2][산1][본번4][부번4].
 * 앞 10자리(`4792002521` = 경북 봉화군 봉화읍 내성리)가 리 코드다.
 */
const PNU_A = '4792002521104000000';
const PNU_B = '4792002521104010000';

/** PNU를 가진 필지. Phase 0를 타는 유일한 조건이다 */
function withPnu(pnus: string[], coords: LatLng | null = null): Parcel[] {
  return pnus.map((pnu, i) =>
    makeParcel({
      pnu,
      parcelId: `${400 + i}`,
      address: `경상북도 봉화군 봉화읍 내성리 ${400 + i}`,
      coords,
    }),
  );
}

const run = (parcels: Parcel[], force: boolean) =>
  batchGeocode(parcels, { force, skipHealthCheck: true, concurrency: 5, maxRetries: 0 });

/** 사전 헬스체크를 실제로 태우는 실행 (캐시 우선순위·auth 재분류 검증용) */
const runWithHealthCheck = (parcels: Parcel[], force: boolean) =>
  batchGeocode(parcels, { force, skipHealthCheck: false, concurrency: 5, maxRetries: 0 });

beforeEach(() => {
  geocodeCalls = [];
  prefetchCalls = [];
  healthCalls = 0;
  snapStore = new Map();
  geocodeImpl = async () => AT(37.0);
  cachedCoordsImpl = () => null;
  prefetchImpl = async () => NO_PREFETCH;
  healthImpl = async () => ({ ok: true, kind: null, message: null });
});

describe('batchGeocode — 기본 동작', () => {
  it('좌표를 채운다', async () => {
    const parcels = [makeParcel({ pnu: '', address: '경상북도 봉화군 봉화읍 내성리 1', coords: null })];
    const { parcels: out } = await run(parcels, false);
    expect(out[0].coords).toEqual(AT(37.0));
  });

  it('rowUid를 보존한다', async () => {
    const parcels = withCoords(3);
    const { parcels: out } = await run(parcels, true);
    expect(out.map((p) => p.rowUid)).toEqual(parcels.map((p) => p.rowUid));
  });

  it('force가 아니면 좌표 있는 필지를 건드리지 않는다', async () => {
    geocodeImpl = async () => AT(99);
    const { parcels: out } = await run(withCoords(3), false);
    expect(out.every((p) => p.coords?.lat === 36.1)).toBe(true);
  });

  it('force면 좌표 있는 필지도 다시 변환한다', async () => {
    geocodeImpl = async () => AT(99);
    const { parcels: out } = await run(withCoords(3), true);
    expect(out.every((p) => p.coords?.lat === 99)).toBe(true);
  });
});

/**
 * **PROJ1-1-43.** 재변환(`force=true`)은 캐시를 비운 뒤 전체를 다시 돌린다.
 * 그때 실패하면 `batchGeocoder`가 좌표에 `null`을 기입했는데, **실패 종류를
 * 구분하지 않았다.**
 *
 * | 실패 종류 | 데이터에 대해 말해 주는 것 | 낡은 좌표를 |
 * |---|---|---|
 * | `notFound` | 서버가 답했고 그 주소에 좌표가 없다 | 지우는 게 맞다 |
 * | `quota`·`unreachable`·`auth` | **아무것도 없다.** 서버 사정이다 | 지켜야 한다 |
 *
 * 캐시를 이미 비운 뒤라 **되돌릴 방법이 없다.** 특히 `notFound`가 아닌 실패는
 * `serviceDown`이 false일 수도 있어 화면이 "변환 완료"라고 말한다.
 */
describe('batchGeocode — 재변환 실패 시 좌표 보존', () => {
  it('notFound면 낡은 좌표를 지운다 (재변환의 초기화 기능)', async () => {
    geocodeImpl = async () => null; // 서버가 답했고 좌표가 없다
    const { parcels: out, diagnostics } = await run(withCoords(5), true);
    expect(out.every((p) => p.coords === null)).toBe(true);
    expect(diagnostics.notFound).toBe(5);
  });

  it('한도 초과면 낡은 좌표를 지키지 않으면 안 된다', async () => {
    geocodeImpl = async () => {
      throw new RateLimitError('한도 초과');
    };
    const { parcels: out, diagnostics } = await run(withCoords(5), true);
    expect(out.every((p) => p.coords?.lat === 36.1)).toBe(true);
    expect(diagnostics.quotaBlocked).toBe(5);
  });

  it('서버 미응답이면 낡은 좌표를 지킨다', async () => {
    geocodeImpl = async () => {
      throw new GeocodeServiceError('서버 무응답', 'unreachable');
    };
    const { parcels: out } = await run(withCoords(5), true);
    expect(out.every((p) => p.coords?.lat === 36.1)).toBe(true);
  });

  it('인증 거부면 낡은 좌표를 지킨다', async () => {
    geocodeImpl = async () => {
      throw new GeocodeServiceError('인증 거부', 'auth');
    };
    const { parcels: out } = await run(withCoords(5), true);
    expect(out.every((p) => p.coords?.lat === 36.1)).toBe(true);
  });

  /** 실패 종류가 섞여도 각각 제 규칙을 따른다 */
  it('일부는 좌표 없음, 일부는 서버 오류면 앞엣것만 지운다', async () => {
    const parcels = withCoords(4);
    geocodeImpl = async (address) => {
      if (address.includes('100') || address.includes('101')) return null;
      throw new GeocodeServiceError('서버 무응답', 'unreachable');
    };
    const { parcels: out } = await run(parcels, true);
    expect(out[0].coords).toBeNull();
    expect(out[1].coords).toBeNull();
    expect(out[2].coords?.lat).toBe(36.1);
    expect(out[3].coords?.lat).toBe(36.1);
  });

  it('좌표가 원래 없던 필지는 실패해도 그대로 null이다', async () => {
    const parcels = [
      makeParcel({ pnu: '', parcelId: '100', address: '경상북도 봉화군 봉화읍 내성리 100', coords: null }),
    ];
    geocodeImpl = async () => {
      throw new GeocodeServiceError('서버 무응답', 'unreachable');
    };
    const { parcels: out } = await run(parcels, true);
    expect(out[0].coords).toBeNull();
  });

  /**
   * `coords`가 없는 필지도 **`null`로 정규화해서** 내보낸다. 같은 모듈이 `null`과
   * `undefined` 두 가지 부재 표현을 내보내면 소비자가 둘 다 다뤄야 한다.
   */
  it('coords 키가 아예 없던 필지도 null로 나온다', async () => {
    const p = makeParcel({ pnu: '', parcelId: '100', address: '경상북도 봉화군 봉화읍 내성리 100' });
    delete (p as { coords?: unknown }).coords;
    geocodeImpl = async () => {
      throw new GeocodeServiceError('서버 무응답', 'unreachable');
    };
    const { parcels: out } = await batchGeocode([p], {
      force: true, skipHealthCheck: true, concurrency: 5, maxRetries: 0,
    });
    expect(out[0].coords).toBeNull();
  });
});

/**
 * 재시도 루프. **성공하면 앞선 시도의 실패 판정을 전부 거둔다** — 이 불변식 위에
 * 좌표 보존 가드의 `coords === null` 항이 등가라는 판정이 서 있다(PROJ1-1-43 P5).
 * 하네스가 전부 `maxRetries: 0`이라 루프가 두 번 도는 경우가 없었다.
 */
describe('batchGeocode — 재시도', () => {
  it('첫 시도가 실패해도 재시도가 성공하면 좌표를 얻는다', async () => {
    let calls = 0;
    geocodeImpl = async () => {
      if (++calls === 1) throw new GeocodeServiceError('일시 장애', 'unreachable');
      return AT(37.0);
    };
    const { parcels: out, diagnostics } = await batchGeocode(withCoords(1), {
      force: true, skipHealthCheck: true, concurrency: 1, maxRetries: 1,
    });
    expect(calls).toBe(2);
    expect(out[0].coords).toEqual(AT(37.0));
    // 성공했으므로 실패로 세면 안 된다
    expect(diagnostics.unreachable).toBe(0);
    expect(diagnostics.attemptedFailures).toBe(0);
  });

  /**
   * **이것이 리셋이 진짜로 막는 것이다.** `geocodeAddress`는 "좌표 없음"을 throw가
   * 아니라 `null`로 알리고 그 경로도 같은 자리를 지난다. 앞 시도의 실패 판정을
   * 안 거두면 **정상 "결과 없음"이 서버 오류로 집계되고**, 좌표 보존 가드까지
   * 타서 지워야 할 낡은 좌표가 남는다.
   *
   * 리셋을 지워도 15건이 전부 통과했다 — 성공(좌표 있음) 조합만 있었기 때문이다.
   */
  it('첫 시도가 예외이고 재시도가 좌표 없음이면 notFound로 센다', async () => {
    let calls = 0;
    geocodeImpl = async () => {
      if (++calls === 1) throw new GeocodeServiceError('일시 장애', 'unreachable');
      return null; // 서버가 답했고 이 주소에 좌표가 없다
    };
    const { parcels: out, diagnostics } = await batchGeocode(withCoords(1), {
      force: true, skipHealthCheck: true, concurrency: 1, maxRetries: 1,
    });
    expect(calls).toBe(2);
    expect(diagnostics.notFound).toBe(1);
    expect(diagnostics.unreachable).toBe(0);
    // 데이터 문제이므로 낡은 좌표를 지운다
    expect(out[0].coords).toBeNull();
  });

  it('재시도도 실패하면 낡은 좌표를 지킨다', async () => {
    let calls = 0;
    geocodeImpl = async () => {
      calls++;
      throw new GeocodeServiceError('서버 무응답', 'unreachable');
    };
    const { parcels: out } = await batchGeocode(withCoords(1), {
      force: true, skipHealthCheck: true, concurrency: 1, maxRetries: 1,
    });
    expect(calls).toBe(2);
    expect(out[0].coords?.lat).toBe(36.1);
  });
});

/**
 * 서버가 죽었다고 판단하면 남은 배치를 포기한다. **`diagnostics.serviceDown`을
 * 단언하는 테스트가 하나도 없었다** — 조기 중단을 무력화해도 전부 통과했다.
 */
describe('batchGeocode — 서버 장애 판정', () => {
  it('연속 실패가 임계치를 넘으면 serviceDown으로 중단한다', async () => {
    geocodeImpl = async () => {
      throw new GeocodeServiceError('서버 무응답', 'unreachable');
    };
    // 배치를 여러 개 만들어야 임계치(연속 2배치)에 도달한다
    const { parcels: out, diagnostics } = await batchGeocode(withCoords(12), {
      force: true, skipHealthCheck: true, concurrency: 2, maxRetries: 0,
    });
    expect(diagnostics.serviceDown).toBe(true);
    expect(diagnostics.failureKind).toBe('unreachable');
    expect(diagnostics.message).toBeTruthy();
    // 중단해도 이미 확보한 좌표는 지킨다
    expect(out.every((p) => p.coords?.lat === 36.1)).toBe(true);
  });

  it('성공하면 serviceDown이 아니다', async () => {
    const { diagnostics } = await run(withCoords(3), true);
    expect(diagnostics.serviceDown).toBe(false);
    expect(diagnostics.failureKind).toBeNull();
  });
});

/**
 * **주소 dedup 팬아웃.** 같은 주소를 가진 필지들을 한 번만 조회하고, 그 결과를
 * 그룹 전원에게 복사한다.
 *
 * 이 저장소가 최근 고친 결함이 "한 필지의 좌표가 다른 필지에 잘못 기입되는" 것인데,
 * 여기는 **의도적으로** 그것을 한다(같은 주소 = 같은 좌표). 의도한 복사와 결함인
 * 복사가 코드 모양으로는 구별되지 않으므로, 이쪽이 무보호면 다음 회귀를 가려낼 수
 * 없다. 실제로 `entry.allIndices`를 `[entry.representative]`로 되돌려도 기존
 * 15건이 전부 통과했다 — 하네스의 필지가 전부 주소가 달라
 * `allIndices.length === 1`이었기 때문이다.
 *
 * 팬아웃은 **좌표 기입**과 **건수 집계** 두 군데에 있고, 서로 다른 변이다.
 */
describe('batchGeocode — 주소 dedup 팬아웃', () => {
  const ADDR = '경상북도 봉화군 봉화읍 내성리 200';

  it('같은 주소 3건을 한 번만 조회하고 세 건 모두에 좌표를 채운다', async () => {
    const { parcels: out, diagnostics } = await run(sameAddress(3, ADDR), false);
    expect(geocodeCalls).toEqual([ADDR]);
    expect(out.map((p) => p.coords)).toEqual([AT(37.0), AT(37.0), AT(37.0)]);
    expect(diagnostics.addressResolved).toBe(3);
  });

  /** 0패딩 표기가 달라도 `normalizeAddressLotNumber`가 같은 그룹으로 묶는다 */
  it('0패딩 표기 차이는 중복 호출로 새지 않는다', async () => {
    const parcels = [
      makeParcel({ pnu: '', parcelId: '165-1', address: '경상북도 봉화군 봉화읍 운계리 0165-0001', coords: null }),
      makeParcel({ pnu: '', parcelId: '165-1b', address: '경상북도 봉화군 봉화읍 운계리 165-1', coords: null }),
    ];
    const { parcels: out } = await run(parcels, false);
    expect(geocodeCalls).toEqual(['경상북도 봉화군 봉화읍 운계리 0165-0001']);
    expect(out.map((p) => p.coords)).toEqual([AT(37.0), AT(37.0)]);
  });

  /**
   * 대표필지가 배열 앞쪽이 아닐 때 **제 자리에** 복사되는지 본다.
   * "전원에게 복사한다"만 보면 인덱스가 어긋나도 통과한다.
   */
  it('그룹이 흩어져 있어도 그 인덱스에만 복사한다', async () => {
    const parcels = [
      makeParcel({ pnu: '', parcelId: '801', address: '경상북도 봉화군 봉화읍 내성리 801', coords: null }),
      makeParcel({ pnu: '', parcelId: '802', address: ADDR, coords: null }),
      makeParcel({ pnu: '', parcelId: '803', address: '경상북도 봉화군 봉화읍 내성리 803', coords: null }),
      makeParcel({ pnu: '', parcelId: '804', address: ADDR, coords: null }),
    ];
    geocodeImpl = async (address) => (address === ADDR ? AT(10) : AT(20));
    const { parcels: out } = await run(parcels, false);
    expect(geocodeCalls).toHaveLength(3); // 4건 중 같은 주소 2건이 하나로 묶였다
    expect(out.map((p) => p.coords?.lat)).toEqual([20, 10, 20, 10]);
  });

  it('notFound면 그룹 전원의 낡은 좌표를 지우고 그룹 크기만큼 센다', async () => {
    geocodeImpl = async () => null; // 서버가 답했고 좌표가 없다
    const { parcels: out, diagnostics } = await run(sameAddress(3, ADDR, AT(36.1)), true);
    expect(geocodeCalls).toEqual([ADDR]);
    expect(out.every((p) => p.coords === null)).toBe(true);
    // 고유 주소 1건이 아니라 필지 3건으로 세야 화면의 분모와 맞는다
    expect(diagnostics.notFound).toBe(3);
    expect(diagnostics.attemptedFailures).toBe(3);
  });

  it('서버 미응답이면 그룹 전원의 좌표를 지키고 그룹 크기만큼 센다', async () => {
    geocodeImpl = async () => {
      throw new GeocodeServiceError('서버 무응답', 'unreachable');
    };
    const { parcels: out, diagnostics } = await run(sameAddress(3, ADDR, AT(36.1)), true);
    expect(out.every((p) => p.coords?.lat === 36.1)).toBe(true);
    expect(diagnostics.unreachable).toBe(3);
    expect(diagnostics.attemptedFailures).toBe(3);
  });

  it('한도 초과도 그룹 크기만큼 센다', async () => {
    geocodeImpl = async () => {
      throw new RateLimitError('한도 초과');
    };
    const { parcels: out, diagnostics } = await run(sameAddress(3, ADDR, AT(36.1)), true);
    expect(out.every((p) => p.coords?.lat === 36.1)).toBe(true);
    expect(diagnostics.quotaBlocked).toBe(3);
    expect(diagnostics.attemptedFailures).toBe(3);
  });
});

/**
 * **주소 캐시 회수.** 네트워크 루프보다 **앞에서** 걷어낸다 — 그래야 조기 중단이
 * 뒤쪽 배치의 캐시 적중분까지 버리지 않고, 루프 안의 성공이 전부 서버 생존의
 * 증거가 된다. 기입을 통째로 지워도 기존 15건이 전부 통과했다.
 */
describe('batchGeocode — 주소 캐시 회수', () => {
  const ADDR = '경상북도 봉화군 봉화읍 내성리 200';

  it('캐시 적중이면 네트워크를 타지 않고 그룹 전원에 기입한다', async () => {
    cachedCoordsImpl = (address) => (address === ADDR ? AT(50) : null);
    const { parcels: out, diagnostics } = await run(sameAddress(3, ADDR, AT(36.1)), true);
    expect(geocodeCalls).toEqual([]);
    expect(out.every((p) => p.coords?.lat === 50)).toBe(true);
    // 캐시 회수분도 주소로 해결한 것이다 — 화면의 성공 건수에 들어간다
    expect(diagnostics.addressResolved).toBe(3);
    expect(diagnostics.attemptedFailures).toBe(0);
    expect(diagnostics.serviceDown).toBe(false);
  });

  it('캐시 적중분과 미적중분이 섞이면 미적중분만 네트워크로 나간다', async () => {
    const parcels = [
      makeParcel({ pnu: '', parcelId: '300', address: '경상북도 봉화군 봉화읍 내성리 300', coords: null }),
      makeParcel({ pnu: '', parcelId: '301', address: '경상북도 봉화군 봉화읍 내성리 301', coords: null }),
    ];
    cachedCoordsImpl = (address) => (address.endsWith('300') ? AT(50) : null);
    geocodeImpl = async () => AT(60);
    const { parcels: out, diagnostics } = await run(parcels, false);
    expect(geocodeCalls).toEqual(['경상북도 봉화군 봉화읍 내성리 301']);
    expect(out.map((p) => p.coords?.lat)).toEqual([50, 60]);
    expect(diagnostics.addressResolved).toBe(2);
  });

  /** 캐시로 전량이 해결되면 루프 자체가 돌지 않는다 */
  it('남은 주소가 전부 캐시면 배치 루프를 돌지 않는다', async () => {
    cachedCoordsImpl = () => AT(50);
    const parcels = [
      makeParcel({ pnu: '', parcelId: '300', address: '경상북도 봉화군 봉화읍 내성리 300', coords: null }),
      makeParcel({ pnu: '', parcelId: '301', address: '경상북도 봉화군 봉화읍 내성리 301', coords: null }),
    ];
    const { parcels: out, diagnostics } = await run(parcels, false);
    expect(geocodeCalls).toEqual([]);
    expect(out.every((p) => p.coords?.lat === 50)).toBe(true);
    expect(diagnostics.addressResolved).toBe(2);
    expect(diagnostics.notFound).toBe(0);
  });
});

/**
 * **Phase 0 (PNU 일괄 조회).** 하네스가 `pnu: ''`로 통째로 건너뛰고 있어
 * 스냅 기입을 지워도, PNU 해결분을 주소 단계로 흘려보내도 전부 통과했다.
 *
 * Phase 0가 주소보다 먼저 도는 이유는 주소 표기 흔들림에 영향받지 않기 때문이고,
 * 그 값어치는 **PNU로 해결된 필지가 주소 단계로 내려오지 않는 것**에 있다.
 */
describe('batchGeocode — Phase 0 (PNU 일괄 조회)', () => {
  it('스냅된 PNU는 좌표를 얻고 주소 단계로 내려오지 않는다', async () => {
    prefetchImpl = async (pnus) => {
      for (const pnu of pnus) snapStore.set(pnu, AT(35));
      return { ...NO_PREFETCH, snapped: pnus.length };
    };
    const { parcels: out, diagnostics } = await run(withPnu([PNU_A, PNU_B]), false);
    expect(prefetchCalls).toEqual([[PNU_A, PNU_B]]);
    expect(out.every((p) => p.coords?.lat === 35)).toBe(true);
    expect(geocodeCalls).toEqual([]); // ← Phase 1을 통째로 생략했다
    expect(diagnostics.pnuResolved).toBe(2);
    expect(diagnostics.addressResolved).toBe(0);
  });

  it('일부만 스냅되면 나머지만 주소로 내려간다', async () => {
    prefetchImpl = async () => {
      snapStore.set(PNU_A, AT(35));
      return { ...NO_PREFETCH, snapped: 1 };
    };
    const { parcels: out, diagnostics } = await run(withPnu([PNU_A, PNU_B]), false);
    expect(out[0].coords?.lat).toBe(35);
    expect(out[1].coords).toEqual(AT(37.0));
    expect(geocodeCalls).toEqual(['경상북도 봉화군 봉화읍 내성리 401']);
    expect(diagnostics.pnuResolved).toBe(1);
    expect(diagnostics.addressResolved).toBe(1);
  });

  /** 조회는 PNU 종류 단위, 기입은 필지 단위 — 여기도 팬아웃이다 */
  it('같은 PNU 두 필지는 한 번만 조회하고 둘 다 채운다 (빈 PNU는 조회에서 뺀다)', async () => {
    const parcels = [
      makeParcel({ pnu: PNU_A, parcelId: '400', address: '경상북도 봉화군 봉화읍 내성리 400', coords: null }),
      makeParcel({ pnu: PNU_A, parcelId: '401', address: '경상북도 봉화군 봉화읍 내성리 401', coords: null }),
      makeParcel({ pnu: '', parcelId: '402', address: '경상북도 봉화군 봉화읍 내성리 402', coords: null }),
      makeParcel({ pnu: '   ', parcelId: '403', address: '경상북도 봉화군 봉화읍 내성리 403', coords: null }),
    ];
    prefetchImpl = async (pnus) => {
      for (const pnu of pnus) snapStore.set(pnu, AT(35));
      return { ...NO_PREFETCH, snapped: pnus.length };
    };
    const { parcels: out, diagnostics } = await run(parcels, false);
    expect(prefetchCalls).toEqual([[PNU_A]]); // 중복·빈 값 제거
    expect(out.map((p) => p.coords?.lat)).toEqual([35, 35, 37, 37]);
    expect(diagnostics.pnuResolved).toBe(2);
    expect(diagnostics.addressResolved).toBe(2);
  });

  /**
   * 스냅 캐시 회수는 **헬스체크보다 앞이다.** 뒤에 두면 서버가 죽은 날
   * IndexedDB에 남아 있는 좌표까지 못 쓰게 된다 — 화면이 "이미 변환된 건은
   * 건너뜁니다"라고 약속하는데 헬스체크가 그 약속을 깨뜨린다.
   */
  it('전량이 스냅 캐시에 있으면 헬스체크도 조회도 하지 않는다', async () => {
    snapStore.set(PNU_A, AT(34));
    const { parcels: out, diagnostics } = await runWithHealthCheck(withPnu([PNU_A]), false);
    expect(healthCalls).toBe(0);
    expect(prefetchCalls).toEqual([]);
    expect(geocodeCalls).toEqual([]);
    expect(out[0].coords).toEqual(AT(34));
    expect(diagnostics.pnuResolved).toBe(1);
  });

  it('헬스체크가 서버 미응답을 잡아도 회수한 스냅은 유지한다', async () => {
    snapStore.set(PNU_A, AT(34));
    healthImpl = async () => ({ ok: false, kind: 'unreachable', message: '서버 무응답' });
    const { parcels: out, diagnostics } = await runWithHealthCheck(withPnu([PNU_A, PNU_B]), false);
    expect(healthCalls).toBe(1);
    expect(prefetchCalls).toEqual([]); // 사전 확인에서 멈춘다
    expect(geocodeCalls).toEqual([]);
    expect(out[0].coords).toEqual(AT(34));
    expect(out[1].coords).toBeNull();
    expect(diagnostics.pnuResolved).toBe(1);
    expect(diagnostics.serviceDown).toBe(true);
    expect(diagnostics.failureKind).toBe('unreachable');
    expect(diagnostics.detail).toBe('서버 무응답');
  });

  /**
   * 리 진행은 **실제 스냅 수**로 보고한다. 예전에는 리 완료율을 필지 수로 환산한
   * 추정치를 done으로 실었는데, 지적도에 없는 PNU가 많으면 확보 0건에 진행률
   * 100%가 떴다.
   */
  it('리 진행을 note로 알리되 done은 실제 스냅 수다', async () => {
    prefetchImpl = async (pnus, options) => {
      options?.onProgress?.(0, 0, 0); // 리가 0개면 보고하지 않는다
      options?.onProgress?.(1, 2, 0);
      snapStore.set(pnus[0], AT(35));
      options?.onProgress?.(2, 2, 1);
      return { ...NO_PREFETCH, snapped: 1 };
    };
    const notes: Array<[number, number, string | undefined]> = [];
    await batchGeocode(withPnu([PNU_A, PNU_B]), {
      skipHealthCheck: true, concurrency: 5, maxRetries: 0,
      onProgress: (done, total, _failed, note) => {
        if (note) notes.push([done, total, note]);
      },
    });
    expect(notes).toEqual([
      [0, 2, 'PNU 일괄 조회 1/2리'],
      [1, 2, 'PNU 일괄 조회 2/2리'],
    ]);
  });

  /**
   * Phase 0(Data API)가 죽어도 **주소 지오코딩은 살아 있을 수 있다.** 여기서
   * 멈추면 멀쩡한 폴백을 버린다. 그리고 주소를 네트워크로 받아냈다면 장애
   * 판정을 거둔다 — 좌표를 받아놓고 "서버 응답 없음"이라고 표시하면 사용자가
   * 멀쩡한 결과를 버리고 다시 돌린다.
   */
  it('Phase 0가 장애로 중단해도 주소 폴백이 돌고, 성공하면 장애 판정을 거둔다', async () => {
    prefetchImpl = async () => downPrefetch('unreachable', 'Data API 무응답', ['4792002521']);
    const { parcels: out, diagnostics } = await run(withPnu([PNU_A, PNU_B]), false);
    expect(geocodeCalls).toHaveLength(2);
    expect(out.every((p) => p.coords?.lat === 37.0)).toBe(true);
    expect(diagnostics.serviceDown).toBe(false);
    expect(diagnostics.failureKind).toBeNull();
    expect(diagnostics.addressResolved).toBe(2);
  });

  it('Phase 0의 장애 사유는 주소가 좌표를 못 받아내면 진단에 남는다', async () => {
    prefetchImpl = async () => downPrefetch('quota', 'VWORLD 호출 한도를 초과했습니다');
    geocodeImpl = async () => null; // 서버는 답했지만 좌표가 없다 (네트워크 성공 0건)
    const { diagnostics } = await run(withPnu([PNU_A]), false);
    expect(geocodeCalls).toHaveLength(1);
    expect(diagnostics.serviceDown).toBe(true);
    expect(diagnostics.failureKind).toBe('quota');
    expect(diagnostics.detail).toBe('VWORLD 호출 한도를 초과했습니다');
    expect(diagnostics.message).toContain('한도');
    expect(diagnostics.notFound).toBe(1);
  });

  /**
   * VWORLD는 **과부하일 때도** "인증키 정보가 올바르지 않습니다"를 돌려준다.
   * 헬스체크가 통과했다면 키는 유효하므로, 그 문구만 보고 "인증키를 확인하라"고
   * 안내하면 사용자가 고칠 수 없는 조치를 찾아 헤맨다.
   */
  it('헬스체크가 통과했으면 Phase 0의 auth를 unreachable로 바꿔 보고한다', async () => {
    prefetchImpl = async () => downPrefetch('auth', '인증키 정보가 올바르지 않습니다');
    geocodeImpl = async () => null;
    const { diagnostics } = await runWithHealthCheck(withPnu([PNU_A]), false);
    expect(healthCalls).toBe(1);
    expect(diagnostics.serviceDown).toBe(true);
    expect(diagnostics.failureKind).toBe('unreachable');
    expect(diagnostics.message).toContain('서버가 응답하지 않습니다');
  });

  /** 헬스체크를 돌리지 않았으면 키가 유효하다는 근거가 없으므로 그대로 auth다 */
  it('헬스체크를 건너뛰면 Phase 0의 auth를 그대로 보고한다', async () => {
    prefetchImpl = async () => downPrefetch('auth', '인증키 정보가 올바르지 않습니다');
    geocodeImpl = async () => null;
    const { diagnostics } = await run(withPnu([PNU_A]), false);
    expect(healthCalls).toBe(0);
    expect(diagnostics.failureKind).toBe('auth');
    expect(diagnostics.message).toContain('인증키');
  });
});
