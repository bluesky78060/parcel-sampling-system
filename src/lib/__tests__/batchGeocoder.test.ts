import { beforeEach, describe, expect, it, vi } from 'vitest';
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

/** 주소 → 좌표. 이 함수를 갈아 끼워 서버 동작을 흉내낸다 */
let geocodeImpl: (address: string) => Promise<LatLng | null>;

vi.mock('../kakaoGeocoder', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../kakaoGeocoder')>();
  return {
    ...actual,
    isGeocodingAvailable: () => true,
    warmupCache: async () => 0,
    getCachedCoords: () => null,
    getSnappedCoord: () => null,
    prefetchPolygonsByPnu: async () => ({ ok: true, failedRi: [] }),
    checkGeocodingService: async () => ({ ok: true }),
    geocodeAddress: (address: string) => geocodeImpl(address),
  };
});

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

const run = (parcels: Parcel[], force: boolean) =>
  batchGeocode(parcels, { force, skipHealthCheck: true, concurrency: 5, maxRetries: 0 });

beforeEach(() => {
  geocodeImpl = async () => AT(37.0);
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
    expect(out[0].coords ?? null).toBeNull();
  });
});
