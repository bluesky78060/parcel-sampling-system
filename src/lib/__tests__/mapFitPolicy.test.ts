import { describe, expect, it } from 'vitest';
import { shouldAutoFit } from '../mapFitPolicy';
import type { MapFitState } from '../mapFitPolicy';

const state = (overrides: Partial<MapFitState> = {}): MapFitState => ({
  filterRi: undefined,
  categoryFilter: 'all',
  hadMarkers: true,
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
    expect(shouldAutoFit(state({ hadMarkers: false }), state({ hadMarkers: true }))).toBe(true);
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
    const before = state({ filterRi: '내성리', categoryFilter: 'all', hadMarkers: true });
    const after = state({ filterRi: '내성리', categoryFilter: 'all', hadMarkers: true });
    expect(shouldAutoFit(before, after)).toBe(false);
  });

  it('마커가 계속 있으면 움직이지 않는다', () => {
    expect(shouldAutoFit(state({ hadMarkers: true }), state({ hadMarkers: true }))).toBe(false);
  });

  /**
   * 필터로 결과가 0건이 된 경우. 맞출 대상이 없기도 하고,
   * 필터를 되돌렸을 때 원래 보던 자리로 돌아오는 편이 낫다.
   */
  it('마커가 있다가 없어져도 움직이지 않는다', () => {
    expect(shouldAutoFit(state({ hadMarkers: true }), state({ hadMarkers: false }))).toBe(false);
  });

  it('마커가 계속 없으면 움직이지 않는다', () => {
    expect(shouldAutoFit(state({ hadMarkers: false }), state({ hadMarkers: false }))).toBe(false);
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
        state({ filterRi: '없는리', hadMarkers: false }),
      ),
    ).toBe(true);
  });
});
