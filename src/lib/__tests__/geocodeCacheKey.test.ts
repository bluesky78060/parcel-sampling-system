import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LatLng } from '../../types';
import { normalizeAddress, normalizeAddressLotNumber } from '../addressParser';

/**
 * **캐시 키는 한 공식이어야 한다.**
 *
 * `geocodeAddress`는 `normalizeAddress(normalizeAddressLotNumber(addr))`로 쓰는데
 * `getCachedCoords`와 `geocodeParcel`의 스냅 좌표 쓰기는 `normalizeAddress(addr)`만
 * 썼다. 0패딩 주소(`… 운계리 0165-0001`)에서 키가 갈려 **전량 캐시 미스**가 난다.
 *
 * 오류가 아니라 성능 저하로만 나타나므로 아무도 눈치채지 못한다. 지금은 호출부
 * (`batchGeocoder`)가 `normalizeAddressLotNumber`로 감싸서 막고 있을 뿐이라,
 * 다음에 이 함수를 부르는 사람이 래핑을 잊으면 조용히 되살아난다.
 */

const IDB = new Map<string, LatLng>();

vi.mock('../geocodeCache', () => ({
  getFromIDB: async (k: string) => IDB.get(k) ?? null,
  setToIDB: async (k: string, c: LatLng) => { IDB.set(k, c); },
  loadAllFromIDB: async () => new Map(IDB),
  bulkSetToIDB: async () => {},
  clearIDBCache: async () => { IDB.clear(); },
  getIDBCacheSize: async () => IDB.size,
}));

/** VWORLD 지오코딩 응답을 흉내낸다. `null`이면 결과 없음. */
let jsonpPoint: LatLng | null = null;

vi.mock('../jsonp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../jsonp')>();
  return {
    ...actual,
    jsonp: async () =>
      jsonpPoint
        ? { response: { status: 'OK', result: { point: { x: String(jsonpPoint.lng), y: String(jsonpPoint.lat) } } } }
        : { response: { status: 'NOT_FOUND' } },
  };
});

const {
  geocodeAddress,
  geocodeParcel,
  getCachedCoords,
  clearGeocodeCache,
} = await import('../kakaoGeocoder');

/** 0패딩 지번. 이 표기에서만 두 키가 갈린다. */
const PADDED = '경상북도 봉화군 상운면 운계리 0165-0001';
const APPROX: LatLng = { lat: 36.9, lng: 128.9 };

beforeEach(async () => {
  vi.stubEnv('VITE_VWORLD_KEY', 'TESTKEY-0000');
  jsonpPoint = APPROX;
  await clearGeocodeCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('normalizeAddress ∘ normalizeAddressLotNumber 는 멱등이다', () => {
  /**
   * 호출부(`batchGeocoder` 353·383행)는 이미 `normalizeAddressLotNumber`로 감싸서
   * 부른다. 정규화를 함수 **안**으로 옮기면 그 경로에서 이중 적용이 되므로,
   * 멱등성이 깨지면 지금 동작하는 경로가 망가진다. 그래서 실제로 확인한다.
   */
  it.each([
    '경상북도 봉화군 상운면 운계리 0165-0001',
    '경상북도 봉화군 상운면 운계리 0165-00',
    '경상북도 봉화군 상운면 운계리 165-0',
    '경상북도 봉화군 봉화읍 적덕리 산 0056',
    '경상북도 봉화군 봉화읍 적덕리 산0056',
    '경상북도 봉화군 봉화읍 문단리 1043-2',
    '경상북도 봉화군 봉화읍 내성리 183-2 목련맨션 103호',
    '경상북도 봉화군 봉화읍 거촌리 127번지',
    '경상북도 봉화군 봉화읍 내성리',
    '',
  ])('normalizeAddressLotNumber 2회 = 1회: %s', (addr) => {
    const once = normalizeAddressLotNumber(addr);
    expect(normalizeAddressLotNumber(once)).toBe(once);
  });

  it('합성 정규화도 2회 = 1회', () => {
    const f = (s: string) => normalizeAddress(normalizeAddressLotNumber(s));
    const once = f(PADDED);
    expect(f(once)).toBe(once);
    expect(once).toBe('경상북도봉화군상운면운계리1651');
  });
});

describe('getCachedCoords — geocodeAddress가 쓴 키로 읽힌다', () => {
  it('0패딩 주소: 원본 표기 그대로 넣어도 캐시에 적중한다', async () => {
    const coord = await geocodeAddress(PADDED);
    expect(coord).toEqual(APPROX);

    // 네트워크를 끊는다. 이후 좌표가 나온다면 캐시에서 온 것이다.
    jsonpPoint = null;

    expect(getCachedCoords(PADDED)).toEqual(APPROX);
  });

  it('호출부가 미리 정규화해 넘겨도 같은 결과 — 이중 적용이 안전하다', async () => {
    await geocodeAddress(PADDED);
    expect(getCachedCoords(normalizeAddressLotNumber(PADDED))).toEqual(APPROX);
  });

  it('0패딩이 없는 주소는 예전과 동일하게 동작한다', async () => {
    const plain = '경상북도 봉화군 봉화읍 문단리 1043-2';
    await geocodeAddress(plain);
    expect(getCachedCoords(plain)).toEqual(APPROX);
  });

  /**
   * 세 함수를 **일관되게 틀린** 키(`normalizeAddress`만)로 바꿔도 위 테스트들은
   * 전부 통과한다 — 셋이 서로 맞기만 하면 되기 때문이다. 그러면 0패딩 표기 차이가
   * 그대로 남아 같은 필지가 두 항목이 되고, `batchGeocoder`의 dedup 키
   * (`normalizeAddress(normalizeAddressLotNumber(...))`)와도 다시 갈린다.
   *
   * 그 변이를 죽이려면 **키가 표기를 흡수한다**는 것을 직접 고정해야 한다.
   */
  it('같은 필지의 다른 0패딩 표기는 캐시를 공유한다', async () => {
    await geocodeAddress(PADDED);
    jsonpPoint = null;

    expect(getCachedCoords('경상북도 봉화군 상운면 운계리 165-1')).toEqual(APPROX);
    // batchGeocoder가 dedup에 쓰는 키와도 같아야 한다
    expect(getCachedCoords(normalizeAddress(normalizeAddressLotNumber(PADDED)))).toEqual(APPROX);
  });

  it('캐시에 없으면 null', () => {
    expect(getCachedCoords('경상북도 봉화군 봉화읍 내성리 999-9')).toBeNull();
  });
});

describe('geocodeParcel — 스냅 좌표가 geocodeAddress와 같은 키로 저장된다', () => {
  /** 봉화군 안의 작은 사각 폴리곤. PNU가 일치할 때만 스냅된다. */
  const PNU = '4792035027100990011';
  const SNAP_LAT = 36.905;
  const SNAP_LNG = 128.905;

  function stubPolygonFetch(pnu: string) {
    const d = 0.0002;
    const ring = [
      [SNAP_LNG - d, SNAP_LAT - d],
      [SNAP_LNG + d, SNAP_LAT - d],
      [SNAP_LNG + d, SNAP_LAT + d],
      [SNAP_LNG - d, SNAP_LAT + d],
      [SNAP_LNG - d, SNAP_LAT - d],
    ];
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({
        response: {
          result: {
            featureCollection: {
              features: [
                { properties: { pnu }, geometry: { type: 'Polygon', coordinates: [ring] } },
              ],
            },
          },
        },
      }),
    }));
  }

  it('스냅된 좌표를 0패딩 원본 주소로 다시 읽을 수 있다', async () => {
    stubPolygonFetch(PNU);

    const snapped = await geocodeParcel(PADDED, PNU);
    expect(snapped).not.toBeNull();
    // 스냅이 실제로 일어났는지 — approx와 달라야 한다
    expect(snapped!.lat).toBeCloseTo(SNAP_LAT, 6);
    expect(snapped!.lng).toBeCloseTo(SNAP_LNG, 6);
    expect(snapped!.lat).not.toBeCloseTo(APPROX.lat, 6);

    // 네트워크를 끊고 캐시만으로 조회
    jsonpPoint = null;
    vi.unstubAllGlobals();

    const cached = getCachedCoords(PADDED);
    expect(cached).not.toBeNull();
    expect(cached!.lat).toBeCloseTo(SNAP_LAT, 6);
    expect(cached!.lng).toBeCloseTo(SNAP_LNG, 6);

    // geocodeAddress도 같은 키를 보므로 스냅된 좌표를 돌려준다
    expect(await geocodeAddress(PADDED)).toEqual(cached);
  });

  it('PNU가 없으면 스냅하지 않고 approx를 돌려준다', async () => {
    const coord = await geocodeParcel(PADDED);
    expect(coord).toEqual(APPROX);
  });
});
