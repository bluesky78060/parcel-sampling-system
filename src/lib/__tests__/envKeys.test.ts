import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeEnvValue, readEnvKey } from '../envKeys';
import { getVworldKey } from '../kakaoGeocoder';

const KEY = 'EF3461DD-F7B1-4E6B-8A6B-2DFBA5196EF0';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('normalizeEnvValue — 조합 오염', () => {
  /**
   * 2026-09-06 장애 재발 케이스. 예전 구현은 `trim()` → 따옴표 제거 **한 방향**이라
   * 따옴표 **안쪽**의 앞 공백이 그대로 살아남았다. 당시 "8개 입력 전수 확인"이라
   * 적었지만 8개가 전부 단일 오염이라 이 조합이 표본에서 빠져 있었다.
   */
  it('따옴표 안쪽 앞 공백 — 예전 구현이 놓치던 바로 그 조합', () => {
    expect(normalizeEnvValue(`" ${KEY}"`)).toBe(KEY);
  });

  it('따옴표 안쪽 뒤 공백', () => {
    expect(normalizeEnvValue(`"${KEY} "`)).toBe(KEY);
  });

  it('따옴표 안쪽 양쪽 공백 + 바깥 공백', () => {
    expect(normalizeEnvValue(`  ' ${KEY} '  `)).toBe(KEY);
  });

  it('작은따옴표 안쪽 앞 공백', () => {
    expect(normalizeEnvValue(`' ${KEY}'`)).toBe(KEY);
  });

  it('중첩 따옴표', () => {
    expect(normalizeEnvValue(`"'${KEY}'"`)).toBe(KEY);
  });

  // 예전 구현도 통과하던 단일 오염 — 회귀 방지용으로 남긴다.
  it.each([
    [` ${KEY}`, '앞 공백'],
    [`${KEY} `, '뒤 공백'],
    [`"${KEY}"`, '큰따옴표'],
    [`'${KEY}'`, '작은따옴표'],
    [`\n${KEY}\n`, '개행'],
    [`"${KEY}`, '짝 안 맞는 따옴표'],
    [KEY, '오염 없음'],
  ])('단일 오염: %s (%s)', (raw) => {
    expect(normalizeEnvValue(raw)).toBe(KEY);
  });

  it('값이 없으면 빈 문자열', () => {
    expect(normalizeEnvValue(undefined)).toBe('');
    expect(normalizeEnvValue(null)).toBe('');
    expect(normalizeEnvValue('')).toBe('');
    expect(normalizeEnvValue('   ')).toBe('');
    expect(normalizeEnvValue('""')).toBe('');
  });

  it('키 가운데의 공백은 건드리지 않는다 — 잘못된 키를 조용히 고쳐 감추지 않는다', () => {
    expect(normalizeEnvValue(' AAA BBB ')).toBe('AAA BBB');
  });
});

/**
 * 예전 상한은 8이었다. 임의로 고른 수라 넘어서는 순간 **경고 없이 오염된 값을
 * 반환한다** — 2026-09-06 장애와 같은 "화면에 안 드러나는" 실패 모드다.
 * 상한을 `v.length`로 바꾸면 "매 회 최소 한 글자가 줄어든다"는 사실에서
 * 종료가 증명되고 미수렴이 원천적으로 사라진다. 여기서 고정하는 것은 그 사실이다.
 */
describe('normalizeEnvValue — 깊이에 상관없이 고정점에 닿는다', () => {
  it.each([1, 5, 8, 9, 12, 40])('따옴표 %i겹', (depth) => {
    expect(normalizeEnvValue('"'.repeat(depth) + KEY + '"'.repeat(depth))).toBe(KEY);
  });

  it('따옴표+공백을 번갈아 40겹', () => {
    expect(normalizeEnvValue(` " `.repeat(40) + KEY + ` " `.repeat(40))).toBe(KEY);
  });

  it('결과는 언제나 고정점이다 — 한 번 더 돌려도 변하지 않는다', () => {
    for (let depth = 0; depth <= 40; depth++) {
      const once = normalizeEnvValue(`'"`.repeat(depth) + KEY + `"'`.repeat(depth));
      expect(normalizeEnvValue(once)).toBe(once);
      expect(once).toBe(KEY);
    }
  });
});

describe('readEnvKey — 세 키 모두 같은 정규화를 거친다', () => {
  it.each(['VITE_VWORLD_KEY', 'VITE_KAKAO_JS_KEY', 'VITE_KAKAO_REST_KEY'] as const)(
    '%s',
    (name) => {
      vi.stubEnv(name, `" ${KEY}"`);
      expect(readEnvKey(name)).toBe(KEY);
    },
  );

  it('미설정이면 빈 문자열', () => {
    vi.stubEnv('VITE_VWORLD_KEY', '');
    expect(readEnvKey('VITE_VWORLD_KEY')).toBe('');
  });
});

/**
 * `readEnvKey`가 **존재한다는 것**과 호출부가 **그것을 쓴다는 것**은 다른 사실이다.
 * 실측: `kakaoGeocoder.ts`의 `KAKAO_REST_USABLE`·Kakao 폴백 키, `useKakaoMap.ts`의
 * JS 키 — 세 호출부를 전부 날것 `import.meta.env` 읽기로 되돌려도 기존 476건이
 * **하나도 죽지 않았다.** 위 describe들은 `normalizeEnvValue`/`readEnvKey`만 고정할 뿐
 * "그 통로를 실제로 거치는가"는 아무도 보지 않기 때문이다.
 *
 * `import.meta.env.DEV`가 vitest(node)에서 `true`라 `KAKAO_REST_USABLE`이 관측된다.
 * 다만 그것은 **모듈 최상위 상수**라 import 시점에 굳으므로, 환경변수를 갈아끼운 뒤
 * `vi.resetModules()` + 동적 import로 모듈을 다시 평가해야 값이 바뀐다.
 *
 * **덮지 못한 곳**: `useKakaoMap.ts`의 `VITE_KAKAO_JS_KEY`. 그 키를 읽는
 * `loadKakaoMapSDK`는 export되지 않고 `window`·`document.createElement`를 요구하는데
 * 이 스위트의 환경은 node라 DOM이 없다. jsdom 프로젝트를 따로 붙이기 전까지는
 * 그 호출부만 회귀 방지 밖에 남는다.
 */
describe('호출부가 실제로 readEnvKey를 거치는가', () => {
  const BAD_ADDRESS = '경상북도 봉화군 봉화읍 내성리 1';

  it('공백뿐인 Kakao REST 키는 "키 있음"으로 세지 않는다 — KAKAO_REST_USABLE', async () => {
    vi.stubEnv('VITE_VWORLD_KEY', '');
    vi.stubEnv('VITE_KAKAO_REST_KEY', '   ');
    vi.resetModules();
    const m = await import('../kakaoGeocoder');

    // 날것으로 읽으면 `!!'   '`가 true라 여기서 'kakao'/true가 나온다.
    expect(m.getGeocodingProvider()).toBe(null);
    expect(m.isGeocodingAvailable()).toBe(false);
  });

  it('공백뿐인 Kakao REST 키로는 폴백 요청을 아예 보내지 않는다', async () => {
    vi.stubEnv('VITE_VWORLD_KEY', '');
    vi.stubEnv('VITE_KAKAO_REST_KEY', '   ');
    vi.resetModules();
    const fetchSpy = vi.fn<typeof fetch>().mockImplementation(
      async () => new Response('{"documents":[]}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const m = await import('../kakaoGeocoder');

    await expect(m.geocodeAddress(BAD_ADDRESS)).resolves.toBe(null);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('조합 오염된 Kakao REST 키는 Authorization 헤더에 정규화돼 실린다', async () => {
    vi.stubEnv('VITE_VWORLD_KEY', '');
    vi.stubEnv('VITE_KAKAO_REST_KEY', `" ${KEY}"`);
    vi.resetModules();
    const fetchSpy = vi.fn<typeof fetch>().mockImplementation(
      async () => new Response('{"documents":[]}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const m = await import('../kakaoGeocoder');

    await m.geocodeAddress(BAD_ADDRESS);

    expect(fetchSpy).toHaveBeenCalled();
    const init = fetchSpy.mock.calls[0][1];
    const auth = (init?.headers as Record<string, string>).Authorization;
    // 날것으로 읽으면 `KakaoAK " EF34…"`가 그대로 실려 인증이 깨진다.
    expect(auth).toBe(`KakaoAK ${KEY}`);
  });
});

describe('getVworldKey — URL에 실릴 값', () => {
  it('조합 오염된 시크릿에서도 key= 뒤에 +가 붙지 않는다', () => {
    vi.stubEnv('VITE_VWORLD_KEY', `" ${KEY}"`);
    const key = getVworldKey();
    expect(key).toBe(KEY);
    // 장애의 실제 증상: 공백이 남으면 encodeURIComponent가 %20(쿼리에선 +)로 싣는다.
    expect(new URLSearchParams({ key }).toString()).toBe(`key=${KEY}`);
  });
});
