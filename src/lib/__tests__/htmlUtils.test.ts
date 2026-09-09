import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../htmlUtils';

/**
 * 문자열로 HTML을 조립하는 곳(`parcelPopup`, `MarkerInfoWindow`)의 **유일한 방어선**이다.
 * 여기 있는 다섯 문자 중 하나라도 빠지면 그 자리에서 XSS가 열린다.
 *
 * `&`를 **가장 먼저** 치환해야 한다는 것이 이 함수의 유일한 순서 제약이다.
 * 나중에 하면 앞서 만든 `&lt;`의 `&`까지 다시 치환해 `&amp;lt;`가 되어
 * 화면에 이스케이프 문자열이 그대로 보인다.
 */
describe('escapeHtml', () => {
  it('HTML 특수문자 다섯 개를 모두 치환한다', () => {
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('>')).toBe('&gt;');
    expect(escapeHtml('"')).toBe('&quot;');
    expect(escapeHtml("'")).toBe('&#039;');
  });

  it('한 문자열 안에 여러 번 나와도 전부 치환한다 (전역 치환)', () => {
    expect(escapeHtml('<<>>')).toBe('&lt;&lt;&gt;&gt;');
  });

  it('스크립트 태그를 무해한 텍스트로 만든다', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
    );
  });

  it('속성 탈출 시도(따옴표 닫기)를 막는다', () => {
    expect(escapeHtml('" onmouseover="alert(1)')).toBe(
      '&quot; onmouseover=&quot;alert(1)',
    );
    expect(escapeHtml("' onmouseover='alert(1)")).toBe(
      '&#039; onmouseover=&#039;alert(1)',
    );
  });

  it('`&`를 먼저 치환해 이중 이스케이프가 생기지 않는다', () => {
    // 순서가 틀리면 '&amp;lt;'가 나온다.
    expect(escapeHtml('<')).not.toContain('&amp;');
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('일반 텍스트와 빈 문자열은 그대로 둔다', () => {
    expect(escapeHtml('')).toBe('');
    expect(escapeHtml('경상북도 봉화군 봉화읍 내성리 100-1')).toBe(
      '경상북도 봉화군 봉화읍 내성리 100-1',
    );
  });
});
