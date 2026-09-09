import { describe, it, expect } from 'vitest';
import { createPopupContent } from '../parcelPopup';
import { useSurveyStore } from '../../store/surveyStore';
import { makeParcel } from './factories';

/**
 * `createPopupContent`는 `components/Map/mapUtils`에 있는 동안 **커버리지가 0이었다.**
 * 그 모듈이 leaflet을 top-level import 해 node에서 로드조차 안 되기 때문인데,
 * 이 함수 자체는 leaflet을 하나도 쓰지 않는다. 실측한 결과 연도를
 * `useSurveyStore.getState().surveyYear`로 되돌리는 변이가 테스트 476건을 전부
 * 통과했고, 시그니처까지 함께 되돌리면 lint(12건 기준선 유지)와 tsc도 통과했다.
 * 즉 **어떤 도구도 그 회귀를 잡지 못했다.**
 *
 * 이 파일이 지키는 것은 둘이다.
 * 1. 팝업의 연도가 **인자로 받은 값**이라는 것 (숨은 전역 의존이 없다)
 * 2. 동적 값이 **하나도 빠짐없이** 이스케이프된다는 것 — 필지 주소·경영체명은
 *    사용자가 올린 엑셀에서 그대로 오므로 한 군데만 빠져도 XSS가 열린다
 *
 * 검증하지 못하는 것: 팝업을 실제로 붙이는 훅(`useMarkerLayer`)의 배선.
 * `environment: 'node'`라 leaflet을 못 올린다 — 사람이 읽어서 확인하는 수밖에 없다.
 */
describe('createPopupContent - 조사 연도', () => {
  it('스토어가 아니라 인자로 받은 연도를 라벨에 쓴다', () => {
    const p = makeParcel();

    // 스토어를 정답과 어긋나게 고정해 둔다. 함수가 스토어를 몰래 읽으면
    // 아래 두 기대 중 하나는 반드시 깨진다.
    useSurveyStore.setState({ surveyYear: 2030 });

    expect(createPopupContent(p, false, 2026)).toContain('2026 선택');
    expect(createPopupContent(p, false, 2026)).not.toContain('2030 선택');
    expect(createPopupContent(p, false, 2027)).toContain('2027 선택');
  });

  it('인자가 같으면 스토어가 어떻든 결과가 같다 (순수 함수)', () => {
    const p = makeParcel();

    useSurveyStore.setState({ surveyYear: 2026 });
    const a = createPopupContent(p, true, 2026);
    useSurveyStore.setState({ surveyYear: 2099 });
    const b = createPopupContent(p, true, 2026);

    expect(a).toBe(b);
  });
});

describe('createPopupContent - 분류와 선택 상태', () => {
  it('공익직불제 필지: 배지와 선택 문구', () => {
    const p = makeParcel({ parcelCategory: 'public-payment' });

    expect(createPopupContent(p, false, 2026)).toContain('>공익직불제<');
    // 색은 **선택 상태 칸 전체**로 검증한다. 색 코드만 찾으면 배지가 같은 색을
    // 갖고 있어(공익직불제 배지 #2563eb, 대표필지 배지 #059669) 선택 색을
    // 통째로 회색으로 바꿔도 테스트가 통과한다 — 실제로 그 변이가 생존했다.
    expect(createPopupContent(p, false, 2026)).toContain('<b style="color:#999">미선택</b>');
    expect(createPopupContent(p, true, 2026)).toContain('<b style="color:#2563eb">추출 선택</b>');
  });

  it('대표필지는 `isSelected`와 무관하게 고정 선택으로 표시된다', () => {
    // `isRepresentative`를 거치므로 'both'(공익 추출도 된 대표필지)도 대표필지다.
    for (const cat of ['representative', 'both'] as const) {
      const p = makeParcel({ parcelCategory: cat });
      for (const sel of [true, false]) {
        const html = createPopupContent(p, sel, 2026);
        expect(html).toContain('>대표필지<');
        expect(html).toContain('<b style="color:#059669">고정 선택</b>');
        expect(html).not.toContain('미선택');
        expect(html).not.toContain('추출 선택');
      }
    }
  });
});

describe('createPopupContent - 면적과 채취이력', () => {
  it('면적이 없으면 `-`, 있으면 천단위 구분과 단위', () => {
    expect(createPopupContent(makeParcel({ area: undefined }), false, 2026)).toContain('<td>-</td>');
    const html = createPopupContent(makeParcel({ area: 12345 }), false, 2026);
    expect(html).toContain(`${(12345).toLocaleString()} m²`);
  });

  it('채취이력이 없으면 `없음`, 있으면 연도 목록', () => {
    expect(createPopupContent(makeParcel({ sampledYears: [] }), false, 2026)).toContain('없음');
    expect(createPopupContent(makeParcel({ sampledYears: [2024, 2025] }), false, 2026))
      .toContain('2024, 2025년');
  });
});

/**
 * 팝업은 HTML을 **문자열로 조립**한다. 아래 필드는 전부 사용자가 올린 엑셀에서
 * 그대로 오므로, 이스케이프가 한 군데라도 빠지면 그 필드가 XSS 통로가 된다.
 * 필드마다 따로 검증한다 — 한 덩어리로 묶으면 어느 필드가 뚫렸는지 알 수 없고,
 * 다른 필드가 막고 있는 덕에 통과해 버린다.
 */
describe('createPopupContent - XSS 이스케이프', () => {
  const PAYLOAD = `<img src=x onerror="alert(1)">&'`;
  const ESCAPED = '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#039;';

  const fields = [
    ['farmerName', (v: string) => makeParcel({ farmerName: v })],
    ['parcelId', (v: string) => makeParcel({ parcelId: v })],
    ['address', (v: string) => makeParcel({ address: v })],
    ['ri', (v: string) => makeParcel({ ri: v })],
  ] as const;

  for (const [name, make] of fields) {
    it(`${name}의 특수문자를 이스케이프한다`, () => {
      const html = createPopupContent(make(PAYLOAD), false, 2026);
      expect(html).toContain(ESCAPED);
      expect(html).not.toContain('<img');
      expect(html).not.toContain('onerror="alert(1)"');
    });
  }

  it('모든 필드에 동시에 넣어도 원문 태그가 하나도 남지 않는다', () => {
    const html = createPopupContent(
      makeParcel({ farmerName: PAYLOAD, parcelId: PAYLOAD, address: PAYLOAD, ri: PAYLOAD }),
      true,
      2026,
    );
    // 이스케이프된 사본이 필드 수만큼 나오고, 원문은 0회여야 한다.
    expect(html.split(ESCAPED).length - 1).toBe(fields.length);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
  });

  it('닫는 태그로 컨텍스트를 탈출하려는 입력도 막는다', () => {
    // `</td>`로 셀을 닫고 나오는 고전적인 시도. 이스케이프가 빠지면
    // 아래 `</td><script>`가 그대로 문서에 들어간다.
    const html = createPopupContent(
      makeParcel({ address: '</td></tr></table><script>alert(1)</script>' }),
      false,
      2026,
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;&lt;script&gt;');
  });
});
