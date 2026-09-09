import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeEnvValue, readEnvKey } from '../envKeys';
import { getVworldKey } from '../kakaoGeocoder';

const KEY = 'EF3461DD-F7B1-4E6B-8A6B-2DFBA5196EF0';

afterEach(() => {
  vi.unstubAllEnvs();
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

describe('getVworldKey — URL에 실릴 값', () => {
  it('조합 오염된 시크릿에서도 key= 뒤에 +가 붙지 않는다', () => {
    vi.stubEnv('VITE_VWORLD_KEY', `" ${KEY}"`);
    const key = getVworldKey();
    expect(key).toBe(KEY);
    // 장애의 실제 증상: 공백이 남으면 encodeURIComponent가 %20(쿼리에선 +)로 싣는다.
    expect(new URLSearchParams({ key }).toString()).toBe(`key=${KEY}`);
  });
});
