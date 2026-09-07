/**
 * useGeocoding.ts에만 주입되는 react 대체물.
 *
 * jsdom 없이 훅을 돌리기 위한 최소 구현이다. 훅 호출 순서대로 슬롯을 배정하고,
 * setState는 갱신 함수를 **즉시** 적용한다. React는 배치하지만 갱신 함수의 적용
 * 순서는 같으므로, 실행이 끝난 뒤의 최종 상태는 실제 React와 동일하다.
 *
 * 컴포넌트(GeocodingProgress) 쪽은 진짜 react + react-dom/server로 렌더한다.
 * 이 shim이 거기까지 새어 들어가면 안 되므로 build 단계에서 importer로 가른다.
 */
export const __slots = [];
let cursor = 0;

/** 훅 함수를 한 번 "렌더"한다 — 슬롯 커서를 0으로 되돌리고 호출 */
export function __render(fn) {
  cursor = 0;
  return fn();
}

export function useState(init) {
  const i = cursor++;
  if (!(i in __slots)) __slots[i] = typeof init === 'function' ? init() : init;
  const set = (v) => {
    __slots[i] = typeof v === 'function' ? v(__slots[i]) : v;
  };
  return [__slots[i], set];
}

export function useRef(init) {
  const i = cursor++;
  if (!(i in __slots)) __slots[i] = { current: init };
  return __slots[i];
}

export function useCallback(fn) {
  return fn;
}

export function useEffect() {}
