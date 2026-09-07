// 테스트가 미리 채워둔 캐시를 흉내낸다 (실제 IndexedDB 대체)
export async function loadAllFromIDB() {
  // 예외 경로 시나리오용. batchGeocode가 던졌을 때 훅과 화면이 어떻게 되는지 보려면
  // 실제 코드 안에서 던질 자리가 필요하다 — 워밍업이 첫 await라 여기가 가장 자연스럽다.
  if (globalThis.__idbThrow) throw new Error(globalThis.__idbThrow);
  return globalThis.__idbSeed ?? new Map();
}
export function setToIDB() {}
export async function clearIDBCache() {}
