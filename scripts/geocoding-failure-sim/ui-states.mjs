/**
 * 훅 → 화면 이음매 검증 — 실제 useGeocoding과 실제 GeocodingProgress를 돌린다.
 *
 * scenarios.mjs는 batchGeocode의 반환값까지만 본다. 5·6라운드의 결함은 둘 다 그
 * 바깥, 라이브러리와 UI 사이에 있었다(완료 판정을 컴포넌트가 다시 계산 / 진단 없는
 * 상태의 0이 "실패 0건"으로 읽힘). 그래서 여기서는:
 *
 *   스텁 네트워크 → 실제 batchGeocode → 실제 useGeocoding(react 훅만 shim)
 *     → 그 상태를 실제 GeocodingProgress에 넣어 react-dom/server로 렌더 → 문구 검사
 *
 * jsdom이 없어 훅은 react-hook-shim.js로 돌린다(setState 갱신 함수를 즉시 적용).
 * 컴포넌트는 진짜 react로 렌더한다.
 *
 * usage: node ui-states.mjs <srcDir>
 */
import * as esbuild from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const srcDir = process.argv[2];
if (!srcDir) {
  console.error('usage: node ui-states.mjs <srcDir>');
  process.exit(2);
}
const harnessDir = process.env.HARNESS_DIR ?? import.meta.dirname;

// ── 번들 ───────────────────────────────────────────────────────
const entry = path.join(os.tmpdir(), `geocode-ui-entry-${process.pid}.js`);
const outFile = path.join(os.tmpdir(), `geocode-ui-${process.pid}.mjs`);
fs.writeFileSync(entry, `
import { useGeocoding } from '${srcDir}/src/hooks/useGeocoding.ts';
import { GeocodingProgress } from '${srcDir}/src/components/Analysis/GeocodingProgress.tsx';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import * as shim from '${harnessDir}/react-hook-shim.js';
globalThis.__ui = { useGeocoding, GeocodingProgress, renderToStaticMarkup, createElement, shim };
`);
await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  outfile: outFile,
  // 엔트리가 /tmp에 있어 react를 찾지 못한다 — 프로젝트의 node_modules에서 푼다
  absWorkingDir: srcDir,
  nodePaths: [path.join(srcDir, 'node_modules')],
  logLevel: 'silent',
  // react-dom/server.node는 CJS라 node 내장 모듈을 require한다. ESM 번들에서는
  // require가 없으므로 createRequire로 만들어 준다.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  define: {
    'import.meta.env.DEV': 'false',
    'import.meta.env.VITE_VWORLD_KEY': '"TESTKEY-0000"',
    'import.meta.env.VITE_KAKAO_REST_KEY': 'undefined',
  },
  plugins: [{
    name: 'stubs',
    setup(b) {
      b.onResolve({ filter: /geocodeCache$/ }, () => ({ path: path.resolve(harnessDir, 'idb-stub.js') }));
      // 훅 파일이 import하는 'react'만 shim으로 바꾼다. 컴포넌트와 react-dom은 진짜를 쓴다.
      b.onResolve({ filter: /^react$/ }, (args) =>
        args.importer.endsWith('useGeocoding.ts')
          ? { path: path.resolve(harnessDir, 'react-hook-shim.js') }
          : undefined);
    },
  }],
});
fs.unlinkSync(entry);

// ── 네트워크 스텁 (scenarios.mjs와 같은 방식) ──────────────────
let reqLog = [];
let scenario = () => ({ type: 'error' });
let onRequest = () => {};
globalThis.window = globalThis;
globalThis.document = {
  createElement() {
    const el = {
      _src: null, onerror: null, async: false,
      remove() {},
      get src() { return this._src; },
      set src(v) {
        this._src = v;
        const url = new URL(v);
        reqLog.push(url);
        onRequest(reqLog.length, url);
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
const okData = (riPrefix, n) => ({
  type: 'ok',
  payload: { response: { status: 'OK', result: { featureCollection: { features: Array.from({ length: n }, (_, k) => ({
    properties: { pnu: riPrefix + '0' + String(k + 1).padStart(4, '0') + '0000' },
    geometry: { type: 'Polygon', coordinates: [[[128.9, 36.9], [128.91, 36.9], [128.91, 36.91], [128.9, 36.9]]] },
  })) } } } },
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
const healthOkDataEmpty = (addrFn) => (url) => {
  const k = kindOf(url);
  if (k === 'health') return okData('4792025021', 1);
  if (k === 'data') return emptyData;
  return addrFn(url);
};

// ── 케이스 ─────────────────────────────────────────────────────
// snapshotAt: 그 번째 요청이 발행되는 순간의 훅 상태를 찍는다(실행 중 화면).
// cancelAt: 그 번째 요청에서 cancelGeocoding()을 부른다.
// throwIn: 'warmup' — batchGeocode가 예외로 끝나는 경로.
// state: 실제 실행 대신 손으로 만든 상태(코드로는 만들 수 없는 불변식 파손 등).
//
// pageShows는 AnalyzePage가 카드를 그리는 조건(isRunning || isComplete || serviceDown)을
// 그대로 옮긴 것이다 — 페이지 JSX를 import할 수 없어 여기 한 줄로 둔다.
const CASES = [
  {
    name: '실행 중 — 첫 배치 실패 25건 (헬스 통과, 주소 API 사망)',
    make: () => healthOkDataEmpty(() => ({ type: 'error' })),
    snapshotAt: 6 + 100 + 1,   // 헬스 1 + 리 5 + 첫 배치 25건×4회가 끝나고 둘째 배치의 첫 요청
    // 확보 0건이면 진행률도 그렇게 읽혀야 한다. Phase 0 추정치가 새면 "499/500 (100%)"가 된다.
    expectText: ['좌표 변환 중... 25/500 (5%)', '변환하지 못한 필지 25건'],
    forbidText: ['완료', '중단', '(100%)'],
    pageShows: true,
  },
  {
    name: '실행 중 — Phase 0 도중 (리 3개 완료, 스냅 300건)',
    make: () => (url) => {
      const k = kindOf(url);
      if (k === 'addr') return okAddr;
      if (k === 'health') return okData('4792025021', 1);
      const p = (url.searchParams.get('attrFilter') ?? '').replace('pnu:like:', '').replace('%', '');
      return url.searchParams.get('page') === '1' ? okData(p, PER_RI) : emptyData;
    },
    snapshotAt: 1 + 3 + 1,   // 헬스 1 + 첫 청크 리 3개 응답 뒤 둘째 청크의 첫 요청
    expectText: ['좌표 변환 중... 300/500 (60%)', 'PNU 일괄 조회 3/5리'],
    pageShows: true,
  },
  {
    // 리 완료율을 필지 수로 환산해 보고하면 여기서 "300/500 (60%)"가 뜬다 — 확보는 0건인데.
    name: '실행 중 — Phase 0 도중, 지적도에 없는 PNU (스냅 0건)',
    make: () => healthOkDataEmpty(() => okAddr),
    snapshotAt: 1 + 3 + 1,
    expectText: ['좌표 변환 중... 0/500 (0%)', 'PNU 일괄 조회 3/5리'],
    forbidText: ['(60%)'],
    pageShows: true,
  },
  {
    name: '사용자 취소 — Phase 1 첫 배치 sleep 중',
    make: () => healthOkDataEmpty(() => ({ type: 'error' })),
    cancelAt: 56,
    expectState: { isRunning: false, isComplete: false, serviceDown: false, summary: null },
    // 페이지는 이 상태에서 카드를 숨긴다. 컴포넌트 단독으로도 "완료"라고 하면 안 된다.
    forbidText: ['완료'],
    pageShows: false,
  },
  {
    name: 'batchGeocode 예외 (워밍업에서 throw)',
    make: () => healthOkDataEmpty(() => okAddr),
    throwIn: 'warmup',
    expectState: { isRunning: false, isComplete: false, serviceDown: false, summary: null },
    expectError: 'IDB 깨짐',
    pageShows: false,
    // done=0이라 컴포넌트는 null을 그린다. 오류 상자(error)가 대신 보인다.
    expectHtml: '',
  },
  {
    name: '정상 완료 — 실패 0건',
    make: () => (url) => {
      const k = kindOf(url);
      if (k === 'addr') return okAddr;
      if (k === 'health') return okData('4792025021', 1);
      const p = (url.searchParams.get('attrFilter') ?? '').replace('pnu:like:', '').replace('%', '');
      return url.searchParams.get('page') === '1' ? okData(p, PER_RI) : emptyData;
    },
    expectState: { isRunning: false, isComplete: true, serviceDown: false },
    expectText: ['좌표 변환 완료! 500/500 성공'],
    forbidText: ['변환하지 못한', '찾지 못한', '미응답', '한도', '인증'],
    pageShows: true,
  },
  {
    name: '정상 완료 — 전량 좌표 없음 (데이터 문제)',
    make: () => healthOkDataEmpty(() => notFoundAddr),
    expectState: { isRunning: false, isComplete: true, serviceDown: false },
    expectText: ['좌표 변환 완료! 0/500 성공', '좌표를 찾지 못한 필지 500건'],
    forbidText: ['변환하지 못한 필지', '미응답', '중단'],
    pageShows: true,
  },
  {
    name: '서버 장애로 중단 — 미응답',
    make: () => healthOkDataEmpty(() => ({ type: 'error' })),
    expectState: { isRunning: false, isComplete: false, serviceDown: true, failureKind: 'unreachable' },
    expectText: ['좌표 변환 중단 — 0/500건에서 멈췄습니다', '서버가 응답하지 않아', '서버 미응답 50건'],
    forbidText: ['완료', '한도'],
    pageShows: true,
  },
  {
    // 카드의 사유 문구가 진단(failureKind)과 다른 기준을 쓰면 오류 상자와 반대 지시가 된다.
    // 한도 21 + 미응답 4로 배치가 죽으면 진단은 '한도'(지배적 원인)인데, 예전 카드는
    // "미응답이 하나라도 있으면 미응답 문구"였다 → "지금 다시 해도 같다" 옆에 "나중에 다시 실행하면".
    name: '서버 장애로 중단 — 한도 다수 + 미응답 소수 (문구 일관성)',
    // 주소 기준으로 갈라야 한다. 요청 순번 기준이면 재시도(attempt 1)가 한도 응답을
    // 받아 모든 필지가 '한도'로 끝나고, 미응답이 한 건도 남지 않아 조건이 안 만들어진다.
    make: () => healthOkDataEmpty((url) => {
      const lot = Number((url.searchParams.get('address') ?? '').split(' ').pop());
      return lot % 25 >= 1 && lot % 25 <= 4
        ? { type: 'error' }
        : errResponse('QUOTA_EXCEEDED', '일일 요청 한도를 초과하였습니다');
    }),
    expectState: { isRunning: false, serviceDown: true, failureKind: 'quota' },
    expectText: ['호출 한도를 넘어 남은 필지는 시도하지 않았습니다', '호출 한도 초과', '서버 미응답'],
    forbidText: ['나중에 다시 실행하면 이미 변환된 건은 건너뜁니다'],
    expectError: '한도',
    pageShows: true,
  },
  {
    name: '캐시 회수 후 중단 — 성공 건수는 확정값',
    setup: (api) => {
      // 스냅 캐시 200건 + 주소 API 사망: 확정 200건, 진행 카운터도 200 이상
      const seed = new Map();
      let n = 0;
      outer: for (let r = 0; r < RI_COUNT; r++) for (let i = 1; i <= PER_RI; i++) {
        if (n++ >= 200) break outer;
        seed.set(`snap:${pnuOf(r, i)}`, { lat: 36.9, lng: 128.9 });
      }
      globalThis.__idbSeed = seed;
      void api;
    },
    make: () => healthOkDataEmpty(() => ({ type: 'error' })),
    expectState: { serviceDown: true },
    expectText: ['좌표 변환 중단 — 200/500건에서 멈췄습니다', '서버 미응답 50건'],
    pageShows: true,
  },
  {
    // 코드로는 만들 수 없는 상태 — 파티션이 깨진 진단. 총량 폴백과 경고가 나와야 한다.
    name: '(수동) 진단 불변식 파손 — 총량 폴백',
    state: {
      isRunning: false, isComplete: true, serviceDown: false, failureKind: null, error: null,
      progress: { done: 500, total: 500, failed: 37 },
      summary: { resolved: 463, notFound: 30, quotaBlocked: 0, unreachable: 0, authBlocked: 0, attemptedFailures: 37 },
    },
    expectText: ['변환하지 못한 필지 37건'],
    forbidText: ['찾지 못한 필지'],
    expectWarn: true,
    pageShows: true,
  },
  {
    // 6라운드 지적의 직접 재현. 진단이 없는 상태에서 진행 카운터만 실패 37건.
    name: '(수동) 실행 중 실패 37건 — 진단 없음',
    state: {
      isRunning: true, isComplete: false, serviceDown: false, failureKind: null, error: null,
      progress: { done: 100, total: 500, failed: 37 }, summary: null,
    },
    expectText: ['변환하지 못한 필지 37건'],
    pageShows: true,
  },
];

// ── 실행 ───────────────────────────────────────────────────────
const textOf = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const rows = [];
const failures = [];
let n = 0;

for (const c of CASES) {
  globalThis.__idbSeed = undefined;
  globalThis.__idbThrow = c.throwIn === 'warmup' ? 'IDB 깨짐' : undefined;
  reqLog = [];
  onRequest = () => {};
  await import(`${outFile}?v=${n++}`);
  const { useGeocoding, GeocodingProgress, renderToStaticMarkup, createElement, shim } = globalThis.__ui;
  shim.__slots.length = 0;

  const warns = [];
  const origWarn = console.warn;
  const origInfo = console.info, origError = console.error, origGroup = console.group, origGroupEnd = console.groupEnd;
  console.warn = (...a) => { warns.push(a.map(String).join(' ')); };
  console.info = console.error = console.group = console.groupEnd = () => {};

  let state, snapshot = null, threw = null;
  const problems = [];
  try {
    if (c.state) {
      state = c.state;
    } else {
      c.setup?.(globalThis.__ui);
      scenario = c.make();
      const hook = shim.__render(useGeocoding);
      if (c.snapshotAt) onRequest = (k) => { if (k === c.snapshotAt) snapshot = structuredClone(shim.__slots[0]); };
      if (c.cancelAt) onRequest = (k) => { if (k === c.cancelAt) hook.cancelGeocoding(); };
      try { await hook.startGeocoding(makeParcels()); } catch (e) { threw = e; }
      state = snapshot ?? shim.__slots[0];
      if (c.snapshotAt && !snapshot) problems.push(`요청 ${c.snapshotAt}번째에 도달하지 못함 (총 ${reqLog.length})`);
    }
  } finally {
    console.warn = origWarn; console.info = origInfo; console.error = origError;
    console.group = origGroup; console.groupEnd = origGroupEnd;
  }

  const uiWarns = [];
  console.warn = (...a) => { uiWarns.push(a.map(String).join(' ')); };
  const html = renderToStaticMarkup(createElement(GeocodingProgress, { state }));
  console.warn = origWarn;
  const text = textOf(html);
  const pageShows = state.isRunning || state.isComplete || state.serviceDown;

  if (c.throwIn && !threw) problems.push('예외가 밖으로 나오지 않음');
  for (const [k, v] of Object.entries(c.expectState ?? {})) {
    if (JSON.stringify(state[k]) !== JSON.stringify(v)) problems.push(`state.${k}=${JSON.stringify(state[k])} (기대 ${JSON.stringify(v)})`);
  }
  if (c.expectError !== undefined && !(state.error ?? '').includes(c.expectError))
    problems.push(`error에 "${c.expectError}" 없음: ${JSON.stringify(state.error)}`);
  for (const t of c.expectText ?? []) if (!text.includes(t)) problems.push(`문구 없음: "${t}"`);
  for (const t of c.forbidText ?? []) if (text.includes(t)) problems.push(`금지 문구 있음: "${t}"`);
  if (c.expectHtml !== undefined && html !== c.expectHtml) problems.push(`html 기대 ${JSON.stringify(c.expectHtml)}, 실제 ${html.slice(0, 80)}…`);
  if (/<ul[^>]*><\/ul>/.test(html)) problems.push('빈 <ul> — 실패 내역 목록을 그렸는데 항목이 없다');
  if (c.expectWarn && uiWarns.length === 0) problems.push('불변식 파손 경고가 없음');
  if (!c.expectWarn && uiWarns.length > 0) problems.push(`예상 밖 경고: ${uiWarns[0]}`);
  if (c.pageShows !== undefined && pageShows !== c.pageShows) problems.push(`pageShows ${pageShows} (기대 ${c.pageShows})`);

  if (problems.length) failures.push({ name: c.name, problems });
  rows.push({
    케이스: c.name,
    페이지표시: pageShows ? 'O' : '-',
    화면: text.slice(0, 90),
    판정: problems.length ? '✗' : '✓',
  });
}

fs.unlinkSync(outFile);
console.log('\n### 훅 → 화면 상태표');
console.table(rows);
if (failures.length) {
  console.error(`\n실패 ${failures.length}건:`);
  for (const f of failures) console.error(`  ✗ ${f.name}\n      ${f.problems.join('\n      ')}`);
  process.exit(1);
}
console.log(`\n전체 ${CASES.length}건 통과`);
