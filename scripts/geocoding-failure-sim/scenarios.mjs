/**
 * VWorld 장애 시뮬레이터 — 실제 소스를 그대로 실행한다.
 *
 * jsonp.ts / kakaoGeocoder.ts / batchGeocoder.ts의 실제 코드가 돈다.
 * `document.createElement('script')`의 로드만 가로채 장애를 흉내낸다.
 *
 * 각 시나리오에 기대값이 붙어 있고, 어긋나면 종료 코드 1로 끝난다.
 * 표만 찍고 exit 0으로 끝나면 회귀를 아무도 알아채지 못한다.
 *
 * usage: node scenarios.mjs <bundle.mjs> [라벨]
 */

const BUNDLE = process.argv[2];
const LABEL = process.argv[3] ?? BUNDLE;
if (!BUNDLE) {
  console.error('usage: node scenarios.mjs <bundle.mjs> [label]');
  process.exit(2);
}

let reqLog = [];
let scenario = () => ({ type: 'error' });
/** 취소 시나리오용. abortAfterRequests번째 요청이 **발행되는 순간** abort()를 부른다. */
let abortCtl = null;
let abortAfter = Infinity;
/** abort() 이후에 발행된 요청 수 / 도착한 onProgress 호출 수 */
let requestsAfterAbort = 0;
let progressAfterAbort = 0;

function installStubs() {
  globalThis.window = globalThis;
  globalThis.document = {
    createElement() {
      const el = {
        _src: null, onerror: null, async: false,
        remove() {},
        get src() { return this._src; },
        set src(v) {
          this._src = v;
          // 발행 시점에 기록한다. 응답 시점에 기록하면 "취소 뒤에 발행된 요청"과
          // "취소 전에 발행됐지만 응답이 늦은 요청"이 구분되지 않는다.
          const url = new URL(v);
          if (abortCtl?.signal.aborted) requestsAfterAbort++;
          reqLog.push(url);
          if (abortCtl && reqLog.length === abortAfter) abortCtl.abort();
          setTimeout(() => {
            const cb = url.searchParams.get('callback');
            const d = scenario(url);
            if (d.type === 'error') { el.onerror?.(); return; }
            const fn = globalThis[cb];
            if (typeof fn === 'function') fn(d.payload);
          }, 0);
        },
      };
      return el;
    },
    head: { appendChild() {} },
  };
}

// ── 테스트 데이터 ──────────────────────────────────────────────
const RI_COUNT = 5, PER_RI = 100;
const TOTAL = RI_COUNT * PER_RI;

function pnuOf(r, i) {
  const emd = String(250 + r).padStart(3, '0');
  return `47920${emd}21` + '0' + String(i).padStart(4, '0') + '0000';
}
function addressOf(r, i) {
  const emd = String(250 + r).padStart(3, '0');
  return `경상북도 봉화군 테스트면 ${emd}리 ${i}`;
}
function makeParcels() {
  const out = [];
  for (let r = 0; r < RI_COUNT; r++) {
    for (let i = 1; i <= PER_RI; i++) {
      out.push({
        farmerId: `F${r}${i}`, parcelId: `P${r}${i}`,
        address: addressOf(r, i), pnu: pnuOf(r, i), coords: null, isEligible: true,
      });
    }
  }
  return out;
}

function featuresFor(riPrefix, n) {
  const feats = [];
  for (let i = 1; i <= n; i++) {
    feats.push({
      properties: { pnu: riPrefix + '0' + String(i).padStart(4, '0') + '0000' },
      geometry: { type: 'Polygon', coordinates: [[[128.9, 36.9], [128.91, 36.9], [128.91, 36.91], [128.9, 36.9]]] },
    });
  }
  return feats;
}

const okData = (riPrefix, n) => ({
  type: 'ok',
  payload: { response: { status: 'OK', result: { featureCollection: { features: featuresFor(riPrefix, n) } } } },
});
const okAddr = { type: 'ok', payload: { response: { status: 'OK', result: { point: { x: '128.9', y: '36.9' } } } } };
const emptyData = { type: 'ok', payload: { response: { status: 'OK', result: { featureCollection: { features: [] } } } } };
const notFoundAddr = { type: 'ok', payload: { response: { status: 'NOT_FOUND' } } };
const errResponse = (code, text) => ({ type: 'ok', payload: { response: { status: 'ERROR', error: { code, text } } } });

function kindOf(url) {
  const svc = url.searchParams.get('service');
  if (svc === 'address') return 'addr';
  if (url.searchParams.get('size') === '1') return 'health';
  return 'data';
}
const riPrefixOf = (url) => (url.searchParams.get('attrFilter') ?? '').replace('pnu:like:', '').replace('%', '');

/** 주소 좌표 캐시를 IndexedDB에 있는 것처럼 심는다 */
function seedAddressCache(count) {
  const { addr } = globalThis.__api;
  const seed = globalThis.__idbSeed ?? new Map();
  let n = 0;
  outer: for (let r = 0; r < RI_COUNT; r++) {
    for (let i = 1; i <= PER_RI; i++) {
      if (n >= count) break outer;
      seed.set(addr.normalizeAddress(addr.normalizeAddressLotNumber(addressOf(r, i))),
               { lat: 36.9, lng: 128.9 });
      n++;
    }
  }
  globalThis.__idbSeed = seed;
}
/** 필지 순번(0-based)이 pred를 만족하는 주소만 캐시에 심는다 */
function seedAddressCacheWhere(pred) {
  const { addr } = globalThis.__api;
  const seed = globalThis.__idbSeed ?? new Map();
  let n = 0;
  for (let r = 0; r < RI_COUNT; r++) {
    for (let i = 1; i <= PER_RI; i++, n++) {
      if (!pred(n)) continue;
      seed.set(addr.normalizeAddress(addr.normalizeAddressLotNumber(addressOf(r, i))),
               { lat: 36.9, lng: 128.9 });
    }
  }
  globalThis.__idbSeed = seed;
}
function seedSnapCache(count) {
  const seed = globalThis.__idbSeed ?? new Map();
  let n = 0;
  outer: for (let r = 0; r < RI_COUNT; r++) {
    for (let i = 1; i <= PER_RI; i++) {
      if (n >= count) break outer;
      seed.set(`snap:${pnuOf(r, i)}`, { lat: 36.9, lng: 128.9 });
      n++;
    }
  }
  globalThis.__idbSeed = seed;
}

// ── 시나리오 ───────────────────────────────────────────────────
// expect: serviceDown / failureKind / resolved(확보 건수) / maxRequests(요청 상한)
//         notFound / quotaBlocked / messageIncludes(사용자 문구 일부)
//
// resolved는 두 가지를 함께 본다 — 실제 좌표가 붙은 필지 수와, diagnostics가 보고한
// pnuResolved+addressResolved. 후자가 화면의 성공 건수가 되므로 어긋나면 잡아야 한다.
const SCENARIOS = [
  {
    name: '전면 장애 (헬스체크 포함 모든 요청 실패)',
    make: () => () => ({ type: 'error' }),
    expect: { serviceDown: true, failureKind: 'unreachable', resolved: 0, maxRequests: 4 },
  },
  {
    name: '헬스체크 통과 후 전면 장애',
    make: () => (url) => (kindOf(url) === 'health' ? okData('4792025021', 1) : { type: 'error' }),
    expect: { serviceDown: true, failureKind: 'unreachable', resolved: 0, maxRequests: 400 },
  },
  {
    name: '정상 서버',
    make: () => (url) => {
      const k = kindOf(url);
      if (k === 'addr') return okAddr;
      if (k === 'health') return okData('4792025021', 1);
      const p = riPrefixOf(url);
      return url.searchParams.get('page') === '1' ? okData(p, PER_RI) : emptyData;
    },
    expect: { serviceDown: false, resolved: TOTAL, maxRequests: 10 },
  },
  {
    name: '리 1개만 실패 (서버는 살아 있음)',
    make: () => (url) => {
      const k = kindOf(url);
      if (k === 'addr') return okAddr;
      if (k === 'health') return okData('4792025021', 1);
      const p = riPrefixOf(url);
      if (p === '4792025321') return { type: 'error' };
      return url.searchParams.get('page') === '1' ? okData(p, PER_RI) : emptyData;
    },
    expect: { serviceDown: false, resolved: TOTAL, maxRequests: 200 },
  },
  {
    // gemini MAJOR 2 — 캐시가 차 있어 신규 스냅이 0건인 재개 실행
    name: '재개 실행 — 신규 스냅 0건 + 리 2개 일시 오류',
    make: () => (url) => {
      const k = kindOf(url);
      if (k === 'addr') return okAddr;
      if (k === 'health') return okData('4792025021', 1);
      const p = riPrefixOf(url);
      if (p === '4792025321' || p === '4792025421') return { type: 'error' };
      return emptyData;
    },
    expect: { serviceDown: false, resolved: TOTAL, maxRequests: 600 },
  },
  {
    // gemini MAJOR 3 — 정상 서버가 "결과 없음"으로 답하는 배치에 오류가 섞임
    name: '잘못된 주소 다수 + 일부 네트워크 오류',
    make: () => {
      let seq = 0;
      return (url) => {
        const k = kindOf(url);
        if (k === 'health') return okData('4792025021', 1);
        if (k === 'data') return emptyData;
        seq++;
        if (seq % 25 <= 2) return { type: 'error' };
        return notFoundAddr;
      };
    },
    expect: { serviceDown: false, resolved: 0, maxRequests: 1400 },
  },
  {
    // code-reviewer HIGH-2 — 같은 청크의 늦은 성공이 판정을 되돌리는가
    name: '첫 청크에 실패 리 2 + 성공 리 1',
    make: () => (url) => {
      const k = kindOf(url);
      if (k === 'addr') return okAddr;
      if (k === 'health') return okData('4792025021', 1);
      const p = riPrefixOf(url);
      if (p === '4792025021' || p === '4792025121') return { type: 'error' };
      return url.searchParams.get('page') === '1' ? okData(p, PER_RI) : emptyData;
    },
    expect: { serviceDown: false, resolved: TOTAL, maxRequests: 400 },
  },
  {
    // code-reviewer HIGH-3 — 누적 성공은 "지금 살아 있다"의 증거가 아니다
    name: '도중 장애 (앞부분 성공 후 사망)',
    make: () => {
      let seq = 0;
      return (url) => {
        const k = kindOf(url);
        if (k === 'health') return okData('4792025021', 1);
        if (k === 'data') {
          const p = riPrefixOf(url);
          if (p === '4792025021' || p === '4792025121') {
            return url.searchParams.get('page') === '1' ? okData(p, PER_RI) : emptyData;
          }
          return emptyData;
        }
        seq++;
        return seq <= 50 ? okAddr : { type: 'error' };
      };
    },
    // Phase 0로 200건 + 주소 50건. 성공 건수가 부풀려지면 안 된다(F3).
    expect: { serviceDown: true, failureKind: 'unreachable', resolved: 250, maxRequests: 400 },
  },
  {
    // code-reviewer HIGH-1 — 서버가 죽은 날에도 캐시는 살아 있어야 한다
    name: '캐시 500건 보유 + 전면 장애',
    setup: () => seedSnapCache(TOTAL),
    make: () => () => ({ type: 'error' }),
    expect: { serviceDown: false, resolved: TOTAL, maxRequests: 0 },
  },
  {
    // critic F1 — 헬스체크가 인증 문구 한 번으로 정상 변환을 막으면 안 된다
    name: '헬스체크만 인증 오류, 서버는 정상',
    make: () => {
      let healthSeen = 0;
      return (url) => {
        const k = kindOf(url);
        if (k === 'health') {
          healthSeen++;
          return errResponse('INVALID_KEY', '인증키 정보가 올바르지 않습니다');
        }
        if (k === 'addr') return okAddr;
        const p = riPrefixOf(url);
        return url.searchParams.get('page') === '1' ? okData(p, PER_RI) : emptyData;
      };
    },
    expect: { serviceDown: false, resolved: TOTAL, maxRequests: 20 },
  },
  {
    // critic F2 — 캐시 적중은 서버 생존의 증거가 아니다
    name: '주소 캐시 100건 보유 + 주소 API 전면 사망',
    setup: () => seedAddressCache(100),
    make: () => (url) => {
      const k = kindOf(url);
      if (k === 'health') return okData('4792025021', 1);
      if (k === 'data') return emptyData;       // Phase 0 전량 미매칭
      return { type: 'error' };                  // 주소 API 사망
    },
    // 캐시 100건은 회수하되, 죽은 서버에 계속 던지지 않아야 한다
    expect: { serviceDown: true, failureKind: 'unreachable', resolved: 100, maxRequests: 600 },
  },
  {
    // critic F4 — 지오코딩 API만 키가 거부되는 경우 (VWORLD는 API별 키 등록)
    name: '지오코딩 API만 INVALID_KEY',
    make: () => (url) => {
      const k = kindOf(url);
      if (k === 'health') return okData('4792025021', 1);
      if (k === 'data') return emptyData;
      return errResponse('INVALID_KEY', '인증키 정보가 올바르지 않습니다');
    },
    expect: { serviceDown: true, failureKind: 'auth', resolved: 0, maxRequests: 600 },
  },
  {
    // critic F4 — 호출 한도 소진. 데이터 문제로 집계하면 몇 시간을 두들긴다
    name: '지오코딩 호출 한도 소진',
    make: () => (url) => {
      const k = kindOf(url);
      if (k === 'health') return okData('4792025021', 1);
      if (k === 'data') return emptyData;
      return errResponse('QUOTA_EXCEEDED', '일일 요청 한도를 초과하였습니다');
    },
    expect: {
      serviceDown: true, failureKind: 'quota', resolved: 0, maxRequests: 600,
      notFound: 0, messageIncludes: '한도',
    },
  },
  {
    // critic N1 — VWORLD가 code 없이 text만 보내는 경우.
    // 판정이 code 기준이면 인증 거부를 "좌표 없음"으로 집계해 전량을 시도한다.
    name: '인증 거부 (error.code 없음, text만)',
    make: () => (url) => {
      const k = kindOf(url);
      if (k === 'health') return okData('4792025021', 1);
      if (k === 'data') return emptyData;
      return { type: 'ok', payload: { response: { status: 'ERROR', error: { text: '인증키 정보가 올바르지 않습니다' } } } };
    },
    expect: {
      serviceDown: true, failureKind: 'auth', resolved: 0, maxRequests: 600,
      notFound: 0, quotaBlocked: 0, messageIncludes: '인증키',
    },
  },
  {
    // reviewer HIGH — 성공한 재시도가 앞선 실패 판정을 거두는가.
    //
    // attempt 0의 지번 호출만 인증 오류로 죽고, attempt 1은 정상 "결과 없음"이다.
    // authRejected가 남으면 정상 응답이 인증 거부로 집계되고, chunkNotFound가
    // 오르지 않아 살아 있는 서버가 죽은 것으로 판정된다.
    //
    // 합계 불변식은 이것을 잡지 못한다(파티션은 성립한다). 보존식은 이중 계상만
    // 잡고 오분류는 잡지 못하므로, 행동 시나리오가 따로 필요하다.
    name: '인증오류 1회 후 정상 결과없음 — 살아 있는 서버를 죽였는가',
    make: () => {
      const tries = new Map();
      return (url) => {
        const k = kindOf(url);
        if (k === 'health') return okData('4792025021', 1);
        if (k === 'data') return emptyData;
        const a = url.searchParams.get('address');
        const n = (tries.get(a) ?? 0) + 1;
        tries.set(a, n);
        return n === 1
          ? errResponse('INVALID_KEY', '인증키 정보가 올바르지 않습니다')
          : notFoundAddr;
      };
    },
    expect: {
      serviceDown: false, resolved: 0, notFound: TOTAL,
      quotaBlocked: 0, maxRequests: 2000,
    },
  },
  {
    // critic M1 — 한 필지가 두 시도에서 서로 다른 이유로 죽는 경우.
    // attempt 0은 네트워크 미응답, attempt 1은 한도 초과.
    // 두 카테고리에 이중 계상되면 실패 내역에서 한 칸이 통째로 사라진다.
    name: '항목 단위 혼합 (미응답 → 한도)',
    make: () => {
      const tries = new Map();
      return (url) => {
        const k = kindOf(url);
        if (k === 'health') return okData('4792025021', 1);
        if (k === 'data') return emptyData;
        // geocodeAddress 한 번이 지번·도로명 2회를 부른다 → 1~2번째가 attempt 0
        const a = url.searchParams.get('address');
        const n = (tries.get(a) ?? 0) + 1;
        tries.set(a, n);
        return n <= 2
          ? { type: 'error' }
          : errResponse('QUOTA_EXCEEDED', '일일 요청 한도를 초과하였습니다');
      };
    },
    expect: { serviceDown: true, resolved: 0, maxRequests: 600, notFound: 0 },
  },
  {
    // critic N2 — 한도 1건이 섞였다고 "내일 다시 오세요"라고 안내하면 안 된다.
    // 배치 25건 중 1건만 한도, 나머지는 네트워크 사망.
    name: '한도 1건 + 미응답 다수 (혼합)',
    make: () => {
      let seq = 0;
      return (url) => {
        const k = kindOf(url);
        if (k === 'health') return okData('4792025021', 1);
        if (k === 'data') return emptyData;
        seq++;
        return seq % 25 === 1
          ? errResponse('QUOTA_EXCEEDED', '일일 요청 한도를 초과하였습니다')
          : { type: 'error' };
      };
    },
    // 다수가 미응답이므로 안내도 미응답이어야 한다
    expect: {
      serviceDown: true, failureKind: 'unreachable', resolved: 0, maxRequests: 600,
      notFound: 0, messageIncludes: '응답하지 않습니다',
    },
  },
  {
    // 리셋 경로 비대칭 — 전부 캐시 적중인 배치는 서버 응답이 없는데도 deadBatches를 0으로
    // 되돌렸다. 캐시 블록과 죽은 블록이 배치 크기(25)로 번갈아 나오면 연속 2가 영영
    // 성립하지 않아, 죽은 서버에 남은 전량을 던진다 — 2026-09-06 장애의 재현 조건이다.
    // (전날 앞부분만 변환하고 남은 파일을 정렬해 두면 실제로 이런 배치가 나온다)
    name: '캐시 25건 블록 교대 + 주소 API 사망',
    setup: () => seedAddressCacheWhere(n => Math.floor(n / 25) % 2 === 0),
    make: () => (url) => {
      const k = kindOf(url);
      if (k === 'health') return okData('4792025021', 1);
      if (k === 'data') return emptyData;
      return { type: 'error' };
    },
    // 캐시 250건은 회수하되, 죽은 배치 2개(#2, #4) 뒤에는 멈춰야 한다
    expect: { serviceDown: true, failureKind: 'unreachable', resolved: 250, maxRequests: 6 + 200 },
  },
  {
    // 취소 뒤에도 재시도가 계속됐다. geocodeVworld의 jsonp에는 signal이 없어
    // AbortError가 나오지 않으므로, "취소는 실패가 아니다"라는 catch의 가드는 실제로
    // 걸린 적이 없다. sleep(200, signal)만 즉시 깨어나 attempt 1을 죽은 서버에 던지고,
    // 그 결과를 done/failed에 세어 onProgress로 보고한다 — 이 늦은 보고가 다음 실행의
    // 진행률에 섞여 들어간다.
    name: 'Phase 1 도중 취소 — 취소 뒤 재시도·진행 보고 없음',
    make: () => (url) => {
      const k = kindOf(url);
      if (k === 'health') return okData('4792025021', 1);
      if (k === 'data') return emptyData;
      return { type: 'error' };
    },
    // 헬스 1 + 리 5 + 첫 배치의 attempt 0(25건×2회)=50 → 56번째 요청에서 취소.
    // 이 시점에 첫 배치 25건은 전부 attempt 0의 실패를 받고 sleep 중이다.
    abortAfterRequests: 56,
    expect: { serviceDown: false, resolved: 0, maxRequestsAfterAbort: 0, maxProgressAfterAbort: 0 },
  },
];

// ── 실행 ───────────────────────────────────────────────────────
installStubs();
const rows = [];
const failures = [];
let n = 0;

for (const sc of SCENARIOS) {
  globalThis.__idbSeed = undefined;
  reqLog = [];
  requestsAfterAbort = 0;
  progressAfterAbort = 0;
  abortCtl = sc.abortAfterRequests ? new AbortController() : null;
  abortAfter = sc.abortAfterRequests ?? Infinity;
  await import(`${BUNDLE}?v=${n++}`);          // 모듈 캐시(좌표 캐시) 초기화
  sc.setup?.();
  scenario = sc.make();

  const { batchGeocode } = globalThis.__api;
  const t0 = Date.now();
  let res = null, err = null;
  try {
    res = await batchGeocode(makeParcels(), {
      concurrency: 25,
      signal: abortCtl?.signal,
      onProgress: () => { if (abortCtl?.signal.aborted) progressAfterAbort++; },
    });
  }
  catch (e) { err = e; }
  const ms = Date.now() - t0;

  const out = Array.isArray(res) ? { parcels: res, diagnostics: null } : res;
  const d = out?.diagnostics ?? null;
  const withCoords = out?.parcels?.filter(p => p.coords).length ?? 0;
  const byKind = reqLog.reduce((a, u) => { const k = kindOf(u); a[k] = (a[k] ?? 0) + 1; return a; }, {});

  const problems = [];
  if (err) problems.push(`예외: ${err}`);
  if (d === null) {
    problems.push('diagnostics 없음 (구버전 번들)');
  } else {
    const e = sc.expect;
    if (e.serviceDown !== undefined && d.serviceDown !== e.serviceDown)
      problems.push(`serviceDown ${d.serviceDown} (기대 ${e.serviceDown})`);
    if (e.failureKind !== undefined && d.failureKind !== e.failureKind)
      problems.push(`failureKind ${d.failureKind} (기대 ${e.failureKind})`);
    if (e.resolved !== undefined && withCoords !== e.resolved)
      problems.push(`좌표확보 ${withCoords} (기대 ${e.resolved})`);
    // 화면에 나가는 성공 건수. 진행률 추정치가 새어들어오면 여기서 갈린다.
    const reported = d.pnuResolved + d.addressResolved;
    if (e.resolved !== undefined && reported !== e.resolved)
      problems.push(`diagnostics 확보 ${reported} (기대 ${e.resolved})`);
    if (reported !== withCoords)
      problems.push(`diagnostics(${reported})와 실제 좌표(${withCoords}) 불일치`);
    // 실패 내역은 파티션이어야 한다. 한 필지가 두 카테고리에 세어지면 화면의
    // 실패 목록에서 한 칸이 조용히 사라진다(뺄셈으로 유도되는 항목이 깎인다).
    if (d.unreachable === undefined || d.authBlocked === undefined
        || d.attemptedFailures === undefined) {
      problems.push('diagnostics에 실패 내역이 없음 — 화면이 뺄셈으로 유도하게 된다');
    } else {
      // 시도한 실패는 정확히 네 카테고리로 분할되어야 한다. 한 필지가 둘에 세어지면
      // 화면에서 한 칸이 조용히 사라진다. (조기 중단으로 미시도한 필지는 여기 없다)
      const accounted = d.notFound + d.quotaBlocked + d.unreachable + d.authBlocked;
      if (accounted !== d.attemptedFailures) {
        problems.push(
          `실패 내역 합 ${accounted} ≠ 시도 실패 ${d.attemptedFailures} ` +
          `(좌표없음 ${d.notFound} + 한도 ${d.quotaBlocked} + 미응답 ${d.unreachable} + 인증 ${d.authBlocked})`);
      }
    }
    if (e.notFound !== undefined && d.notFound !== e.notFound)
      problems.push(`notFound ${d.notFound} (기대 ${e.notFound})`);
    if (e.quotaBlocked !== undefined && d.quotaBlocked !== e.quotaBlocked)
      problems.push(`quotaBlocked ${d.quotaBlocked} (기대 ${e.quotaBlocked})`);
    // 이 티켓의 산출물은 숫자가 아니라 사용자가 읽는 문장이다.
    if (e.messageIncludes !== undefined && !(d.message ?? '').includes(e.messageIncludes))
      problems.push(`message에 "${e.messageIncludes}" 없음: ${JSON.stringify(d.message)}`);
    if (e.maxRequests !== undefined && reqLog.length > e.maxRequests)
      problems.push(`요청 ${reqLog.length} > 상한 ${e.maxRequests}`);
    if (e.maxRequestsAfterAbort !== undefined && requestsAfterAbort > e.maxRequestsAfterAbort)
      problems.push(`취소 뒤 발행된 요청 ${requestsAfterAbort} > 상한 ${e.maxRequestsAfterAbort}`);
    if (e.maxProgressAfterAbort !== undefined && progressAfterAbort > e.maxProgressAfterAbort)
      problems.push(`취소 뒤 도착한 진행 보고 ${progressAfterAbort} > 상한 ${e.maxProgressAfterAbort}`);
  }
  if (problems.length) failures.push({ name: sc.name, problems });

  rows.push({
    시나리오: sc.name,
    요청: reqLog.length,
    리조회: byKind.data ?? 0,
    주소조회: byKind.addr ?? 0,
    좌표확보: withCoords,
    serviceDown: d ? d.serviceDown : '(없음)',
    사유: d?.failureKind ?? '-',
    notFound: d?.notFound ?? '-',
    한도: d?.quotaBlocked ?? '-',
    ms,
    판정: problems.length ? '✗' : '✓',
  });
}

console.log(`\n### ${LABEL}`);
console.table(rows);

if (failures.length) {
  console.error(`\n실패 ${failures.length}건:`);
  for (const f of failures) console.error(`  ✗ ${f.name}\n      ${f.problems.join('\n      ')}`);
  process.exit(1);
}
console.log(`\n전체 ${SCENARIOS.length}건 통과`);
