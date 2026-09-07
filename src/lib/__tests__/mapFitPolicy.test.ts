import { describe, expect, it } from 'vitest';
import { anyMarkerInView, deriveFitState, reduceFit, shouldAutoFit } from '../mapFitPolicy';
import type { MapFitState } from '../mapFitPolicy';

const state = (overrides: Partial<MapFitState> = {}): MapFitState => ({
  filterRi: undefined,
  categoryFilter: 'all',
  hadMarkers: true,
  anyMarkerInView: true,
  ...overrides,
});

describe('shouldAutoFit — 맞춰야 하는 경우', () => {
  it('첫 진입에는 맞춘다', () => {
    expect(shouldAutoFit(null, state())).toBe(true);
  });

  it('리 필터가 바뀌면 맞춘다', () => {
    expect(shouldAutoFit(state({ filterRi: undefined }), state({ filterRi: '내성리' }))).toBe(true);
    expect(shouldAutoFit(state({ filterRi: '내성리' }), state({ filterRi: '운계리' }))).toBe(true);
  });

  it('리 필터를 해제해도 맞춘다', () => {
    expect(shouldAutoFit(state({ filterRi: '내성리' }), state({ filterRi: undefined }))).toBe(true);
  });

  it('카테고리 필터가 바뀌면 맞춘다', () => {
    expect(
      shouldAutoFit(state({ categoryFilter: 'all' }), state({ categoryFilter: 'representative' })),
    ).toBe(true);
  });

  /**
   * 좌표 변환이 끝나 마커가 처음 생기는 경우다.
   * 빈 화면을 그대로 두면 사용자가 결과를 볼 수 없다.
   */
  it('마커가 없다가 생기면 맞춘다', () => {
    expect(
      shouldAutoFit(state({ hadMarkers: false }), state({ hadMarkers: true, anyMarkerInView: true })),
    ).toBe(true);
  });

  /**
   * 이 규칙이 세 가지 빈틈을 함께 덮는다.
   * - "추출 선택만"을 다시 켰을 때 그 700건이 현재 뷰포트 밖에 있는 경우
   * - 좌표 변환이 부분 성공해 재시도했을 때 새 마커가 화면 밖에 생기는 경우
   * - 전체화면을 축소해 마커가 화면 밖으로 밀려나는 경우
   *
   * 이것이 없으면 **빈 지도에 "마커 700" 배지만** 뜨는 모순된 화면이 나온다.
   */
  it('마커는 있는데 화면 안에 하나도 없으면 맞춘다', () => {
    expect(shouldAutoFit(state(), state({ hadMarkers: true, anyMarkerInView: false }))).toBe(true);
  });

  it('필터가 그대로여도 화면 밖으로 밀려났으면 맞춘다', () => {
    const before = state({ filterRi: '내성리', anyMarkerInView: true });
    const after = state({ filterRi: '내성리', anyMarkerInView: false });
    expect(shouldAutoFit(before, after)).toBe(true);
  });
});

/**
 * 이쪽이 이 규칙의 존재 이유다. 사용자가 지도를 확대해 필지를 보고 있을 때
 * 아래 조작들로 화면이 튕겨 돌아오면 작업을 이어갈 수 없다.
 */
describe('shouldAutoFit — 움직이지 않아야 하는 경우', () => {
  it('아무것도 바뀌지 않았으면 움직이지 않는다', () => {
    expect(shouldAutoFit(state(), state())).toBe(false);
  });

  /**
   * "미선택 필지 표시"·"1km 반경" 토글과 조사 연도 변경이 여기 해당한다.
   * 셋 다 마커를 다시 그리게 하지만 **보는 대상**은 그대로다.
   * 이 상태값에 그것들이 들어 있지 않은 것 자체가 규칙이다.
   */
  it('표시 방식만 바뀐 경우(상태값이 같음) 움직이지 않는다', () => {
    const before = state({ filterRi: '내성리', categoryFilter: 'all' });
    const after = state({ filterRi: '내성리', categoryFilter: 'all' });
    expect(shouldAutoFit(before, after)).toBe(false);
  });

  it('마커가 계속 있고 화면에도 보이면 움직이지 않는다', () => {
    expect(
      shouldAutoFit(state({ hadMarkers: true }), state({ hadMarkers: true, anyMarkerInView: true })),
    ).toBe(false);
  });

  /**
   * 필터로 결과가 0건이 된 경우. 맞출 대상이 없기도 하고,
   * 필터를 되돌렸을 때 원래 보던 자리로 돌아오는 편이 낫다.
   */
  it('마커가 있다가 없어져도 움직이지 않는다', () => {
    expect(
      shouldAutoFit(state({ hadMarkers: true }), state({ hadMarkers: false, anyMarkerInView: false })),
    ).toBe(false);
  });

  it('마커가 계속 없으면 움직이지 않는다', () => {
    expect(
      shouldAutoFit(
        state({ hadMarkers: false, anyMarkerInView: false }),
        state({ hadMarkers: false, anyMarkerInView: false }),
      ),
    ).toBe(false);
  });

  /**
   * `ReviewPage`가 `filterRi || undefined`로 정규화해 넘기지만 타입은 `''`을 허용한다.
   * 두 번째 호출부가 그대로 넘기면 `'' !== undefined`가 참이 되어
   * **필터를 만진 적도 없는데 화면이 맞춰진다.** 정책 안에서 막는다.
   */
  it('빈 문자열과 undefined는 같은 전체로 본다', () => {
    expect(shouldAutoFit(state({ filterRi: '' }), state({ filterRi: undefined }))).toBe(false);
    expect(shouldAutoFit(state({ filterRi: undefined }), state({ filterRi: '' }))).toBe(false);
  });
});

describe('shouldAutoFit — 조건이 겹칠 때', () => {
  it('필터 변경과 마커 생성이 함께 일어나도 한 번만 판정한다', () => {
    expect(
      shouldAutoFit(
        state({ filterRi: '내성리', hadMarkers: false }),
        state({ filterRi: '운계리', hadMarkers: true }),
      ),
    ).toBe(true);
  });

  /**
   * 필터를 바꿔 결과가 0건이 된 경우. 필터 변경이 우선하므로 맞추려 시도한다.
   * (실제로 맞출 좌표가 없으면 `fitMapBounds`가 조기 반환하므로 화면은 그대로다.)
   */
  it('필터를 바꿔 마커가 사라져도 필터 변경이 우선한다', () => {
    expect(
      shouldAutoFit(
        state({ filterRi: '내성리', hadMarkers: true }),
        state({ filterRi: '없는리', hadMarkers: false, anyMarkerInView: false }),
      ),
    ).toBe(true);
  });
});

/**
 * 이 계산을 훅 안에 한 줄로 두었더니 `false`로 고정하는 변이가 189건을 **전부 통과**했다.
 * `false` 고정은 마커를 다시 그릴 때마다 무조건 맞추게 만든다 —
 * PROJ1-1-36이 고치려던 바로 그 동작인데 초록불이었다.
 */
describe('anyMarkerInView', () => {
  // 봉화군 언저리의 작은 사각형
  const view = { south: 36.8, west: 128.8, north: 37.0, east: 129.0 };

  it('마커가 하나도 없으면 false다', () => {
    expect(anyMarkerInView([], view)).toBe(false);
  });

  it('화면 안에 하나라도 있으면 true다', () => {
    expect(anyMarkerInView([{ lat: 36.9, lng: 128.9 }], view)).toBe(true);
    expect(
      anyMarkerInView([{ lat: 40, lng: 130 }, { lat: 36.9, lng: 128.9 }], view),
    ).toBe(true);
  });

  it('전부 화면 밖이면 false다', () => {
    expect(
      anyMarkerInView([{ lat: 40, lng: 130 }, { lat: 35, lng: 127 }], view),
    ).toBe(false);
  });

  it('경계 위의 마커는 안에 있는 것으로 본다', () => {
    expect(anyMarkerInView([{ lat: 36.8, lng: 128.8 }], view)).toBe(true);
    expect(anyMarkerInView([{ lat: 37.0, lng: 129.0 }], view)).toBe(true);
  });

  it('위도만 맞고 경도가 벗어나면 false다', () => {
    expect(anyMarkerInView([{ lat: 36.9, lng: 130 }], view)).toBe(false);
  });

  it('경도만 맞고 위도가 벗어나면 false다', () => {
    expect(anyMarkerInView([{ lat: 40, lng: 128.9 }], view)).toBe(false);
  });
});

/**
 * `hadMarkers`를 훅에서 직접 조립하면 그 산식을 아무도 검증하지 않는다 —
 * 실제로 `hadMarkers: true`로 고정해 버리는 변이가 테스트를 전부 통과했다.
 */
describe('deriveFitState', () => {
  it('마커가 하나도 렌더되지 않았으면 hadMarkers가 false다', () => {
    expect(
      deriveFitState({ renderedCount: 0, anyMarkerInView: false }).hadMarkers,
    ).toBe(false);
  });

  it('한 개라도 렌더됐으면 hadMarkers가 true다', () => {
    expect(deriveFitState({ renderedCount: 1, anyMarkerInView: true }).hadMarkers).toBe(true);
    expect(deriveFitState({ renderedCount: 700, anyMarkerInView: true }).hadMarkers).toBe(true);
  });

  it('필터와 뷰포트 여부를 그대로 옮긴다', () => {
    expect(
      deriveFitState({
        filterRi: '내성리',
        categoryFilter: 'representative',
        renderedCount: 3,
        anyMarkerInView: false,
      }),
    ).toEqual({
      filterRi: '내성리',
      categoryFilter: 'representative',
      hadMarkers: true,
      anyMarkerInView: false,
    });
  });
});

/**
 * 상태 갱신을 호출부에 맡기면 `if (fit)` 안으로 들어가는 실수가 난다.
 * 그러면 `hadMarkers`의 false→true 전이를 놓쳐 "좌표 변환이 끝나면 맞춘다"는
 * 규칙이 조용히 죽는다 — 그 변이가 실제로 테스트를 전부 통과했었다.
 */
describe('reduceFit', () => {
  it('맞추기로 판정하면 fit이 true이고 next는 현재 상태다', () => {
    const current = state({ filterRi: '내성리' });
    const result = reduceFit(state({ filterRi: undefined }), current);
    expect(result.fit).toBe(true);
    expect(result.next).toBe(current);
  });

  it('맞추지 않기로 판정해도 next는 현재 상태를 그대로 돌려준다', () => {
    const current = state();
    const result = reduceFit(state(), current);
    expect(result.fit).toBe(false);
    expect(result.next).toBe(current); // 갱신을 건너뛰면 안 된다
  });

  it('첫 판정에서도 next를 돌려준다', () => {
    const current = state();
    expect(reduceFit(null, current)).toEqual({ fit: true, next: current });
  });
});
