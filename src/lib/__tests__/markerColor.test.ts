import { describe, it, expect } from 'vitest';
import { getMarkerColor } from '../markerColor';
import { useSurveyStore } from '../../store/surveyStore';
import { makeParcel } from './factories';

/**
 * `getMarkerColor`는 예전에 함수 **안에서** `useSurveyStore.getState().surveyYear`를
 * 읽었다. 그래서 호출부가 연도를 구독하지 않으면 화면이 낡은 색으로 남았고,
 * `usePolygonLayer`가 실제로 그 상태였다.
 *
 * 이 파일이 지키는 것은 두 가지다.
 * 1. 색이 **인자로 받은 연도**의 함수라는 것 (숨은 전역 의존이 없다)
 * 2. 각 색 규칙의 경계
 *
 * 검증하지 못하는 것: 훅 자체(`useMarkerLayer`·`usePolygonLayer`)의 구독과 의존성
 * 배열. 이 저장소의 vitest는 `environment: 'node'`라 DOM이 없고 leaflet은 로드
 * 시점에 `window`를 만진다. 훅 배선은 사람이 읽어서 확인하는 수밖에 없다.
 */
describe('getMarkerColor', () => {
  it('스토어가 아니라 인자로 받은 연도를 쓴다', () => {
    const p = makeParcel({ sampledYears: [2025] });

    // 스토어를 정답과 어긋나게 고정해 둔다. 함수가 스토어를 몰래 읽으면
    // 아래 두 기대 중 하나는 반드시 깨진다.
    useSurveyStore.setState({ surveyYear: 2030 });

    expect(getMarkerColor(p, false, 2026)).toBe('#dc2626'); // 2025 = N-1 → 빨강
    expect(getMarkerColor(p, false, 2027)).toBe('#ea580c'); // 2025 = N-2 → 주황
  });

  it('인자가 같으면 스토어가 어떻든 결과가 같다 (순수 함수)', () => {
    const p = makeParcel({ sampledYears: [2025] });

    useSurveyStore.setState({ surveyYear: 2026 });
    const a = getMarkerColor(p, false, 2026);
    useSurveyStore.setState({ surveyYear: 2099 });
    const b = getMarkerColor(p, false, 2026);

    expect(a).toBe(b);
  });

  it('선택된 대표필지는 초록 — 기채취 이력보다 우선한다', () => {
    const p = makeParcel({ parcelCategory: 'representative', sampledYears: [2025] });
    expect(getMarkerColor(p, true, 2026)).toBe('#059669');
  });

  it("'both'(공익 추출에도 뽑힌 대표필지)도 대표필지 색이다", () => {
    // `parcelCategory === 'representative'` 직접 비교로 판정하면 여기서 깨진다.
    const p = makeParcel({ parcelCategory: 'both' });
    expect(getMarkerColor(p, true, 2026)).toBe('#059669');
  });

  it('선택된 일반 필지는 파랑 — 기채취 이력보다 우선한다', () => {
    const p = makeParcel({ sampledYears: [2025] });
    expect(getMarkerColor(p, true, 2026)).toBe('#2563eb');
  });

  it('선택되지 않은 대표필지는 대표 색이 아니다 (선택 여부가 함께 필요하다)', () => {
    const p = makeParcel({ parcelCategory: 'representative' });
    expect(getMarkerColor(p, false, 2026)).not.toBe('#059669');
  });

  it('N-1 채취분이 N-2보다 우선한다', () => {
    // 두 해 모두 채취한 필지. 최근 연도 색(빨강)이 이겨야 한다.
    const p = makeParcel({ sampledYears: [2024, 2025] });
    expect(getMarkerColor(p, false, 2026)).toBe('#dc2626');
  });

  it('N-3 이상 오래된 채취 이력은 채취 색을 주지 않는다', () => {
    const p = makeParcel({ sampledYears: [2023], isEligible: true });
    expect(getMarkerColor(p, false, 2026)).toBe('#6b7280');
  });

  it('이력 없는 적격 필지는 회색, 부적격은 옅은 회색', () => {
    expect(getMarkerColor(makeParcel({ isEligible: true }), false, 2026)).toBe('#6b7280');
    expect(getMarkerColor(makeParcel({ isEligible: false }), false, 2026)).toBe('#9ca3af');
  });

  it('연도를 바꾸면 같은 필지의 색이 규칙대로 옮겨간다', () => {
    // 폴리곤이 낡은 색으로 남던 결함이 노린 지점: 연도만 달라져도 색이 달라진다.
    const p = makeParcel({ sampledYears: [2025], isEligible: true });
    expect(getMarkerColor(p, false, 2026)).toBe('#dc2626'); // N-1
    expect(getMarkerColor(p, false, 2027)).toBe('#ea580c'); // N-2
    expect(getMarkerColor(p, false, 2028)).toBe('#6b7280'); // 범위 밖
  });
});
