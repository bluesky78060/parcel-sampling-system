/**
 * 조사 연도 전파 검증 — 연도를 바꿨을 때 화면·산출물이 전부 따라가는지 본다.
 *
 * 2026-09-07 이전에는 2024·2025·2026이 타입·로직·UI 세 층에 리터럴로 박혀 있어
 * 다음 해 조사에 쓰려면 코드를 고쳐야 했다(`year: 2024 | 2025 | 2026` 유니온이라
 * 2027을 넣으면 컴파일조차 안 됐다).
 *
 * usage: node scripts/verify-survey-year.mjs [srcDir]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as esbuild from 'esbuild';

const root = process.argv[2] ?? path.resolve(import.meta.dirname, '..');
const srcDir = path.join(root, 'src');

/** 소스에서 연도로 보이는 리터럴을 찾는다 (주석·PNU 코드·날짜는 제외) */
function scanYearLiterals() {
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx)$/.test(e.name)) continue;
      // 연도 기준점 자체는 제외
      if (e.name === 'surveyStore.ts') continue;
      const lines = fs.readFileSync(full, 'utf-8').split('\n');
      lines.forEach((line, i) => {
        const code = line.trim();
        // 주석 줄 제외
        if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
        // 날짜 표기(2026-09-07), PNU(4792...), URL 제외
        const stripped = line
          .replace(/20\d{2}-\d{2}(-\d{2})?/g, '')
          .replace(/\b4792\d+/g, '')
          .replace(/https?:\/\/\S+/g, '');
        const m = stripped.match(/\b20(2[4-9]|3\d)\b/);
        if (m) hits.push({ file: path.relative(root, full), line: i + 1, text: code.slice(0, 100) });
      });
    }
  };
  walk(srcDir);
  return hits;
}

/** 연도에 의존해야 하는 지점이 실제로 스토어를 참조하는지 */
const MUST_REFERENCE = [
  ['src/pages/HomePage.tsx', '메인 화면 연도 선택'],
  ['src/components/Layout/AppLayout.tsx', '헤더 문구'],
  ['src/pages/UploadPage.tsx', '업로드 슬롯'],
  ['src/lib/uploadSlots.ts', '업로드 슬롯 정의'],
  ['src/components/Analysis/StatsDashboard.tsx', '기채취 통계 라벨'],
  ['src/components/Map/MapLegend.tsx', '지도 범례'],
  ['src/components/Map/mapUtils.ts', '마커 색상·팝업'],
  ['src/lib/excelExporter.ts', '엑셀 시트명·파일명'],
  ['src/pages/ReviewPage.tsx', '검토 화면'],
  ['src/store/parcelStore.ts', '기채취 통계 집계'],
  ['src/pages/AnalyzePage.tsx', '기채취 파일 조회'],
];

let failed = 0;

console.log('## 연도 리터럴 잔존 검사\n');
const hits = scanYearLiterals();
if (hits.length) {
  failed++;
  console.log(`  ✗ ${hits.length}건 남음 — 조사 연도를 바꿔도 따라가지 않는다`);
  for (const h of hits.slice(0, 15)) console.log(`      ${h.file}:${h.line}  ${h.text}`);
} else {
  console.log('  ✓ 없음');
}

console.log('\n## 연도 의존 지점이 스토어를 참조하는가\n');
for (const [rel, what] of MUST_REFERENCE) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) { failed++; console.log(`  ✗ ${what.padEnd(22)} 파일 없음: ${rel}`); continue; }
  const s = fs.readFileSync(full, 'utf-8');
  const ok = s.includes('surveyStore');
  if (!ok) failed++;
  console.log(`  ${ok ? '✓' : '✗'} ${what.padEnd(22)} ${rel}`);
}

console.log('\n## 기채취 연도가 파생값인가\n');
const store = fs.readFileSync(path.join(root, 'src/store/surveyStore.ts'), 'utf-8');
const derives = /surveyYear\s*-\s*1/.test(store) && /surveyYear\s*-\s*2/.test(store);
if (!derives) failed++;
console.log(`  ${derives ? '✓' : '✗'} sampledYearsOf가 조사 연도에서 파생 (따로 입력받지 않는다)`);

// 기채취 연도를 별도 상태로 두면 둘이 어긋난다 — 그런 필드가 없어야 한다
const hasSeparateState = /sampledYear.*:\s*number/.test(store.replace(/function sampledYearsOf[\s\S]*/, ''));
if (hasSeparateState) failed++;
console.log(`  ${hasSeparateState ? '✗' : '✓'} 기채취 연도를 별도 상태로 두지 않음`);

console.log('\n## 연도 변경이 작업 초기화를 거치는가\n');
// 슬롯 id·기채취 파일 조회가 연도에서 파생되므로 값만 바꾸면 이전 파일이 고아가 된다.
// 화면은 setSurveyYear를 직접 부르지 말고 changeSurveyYear를 써야 한다.
{
  const walkTsx = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walkTsx(full, out);
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(full);
    }
    return out;
  };
  const direct = walkTsx(srcDir).filter((f) => {
    const rel = path.relative(root, f);
    if (rel === 'src/store/surveyStore.ts' || rel === 'src/store/changeSurveyYear.ts') return false;
    return /setSurveyYear\s*\(/.test(fs.readFileSync(f, 'utf-8'));
  });
  if (direct.length) {
    failed++;
    console.log(`  ✗ setSurveyYear를 직접 호출: ${direct.map((f) => path.relative(root, f)).join(', ')}`);
  } else {
    console.log('  ✓ 화면은 changeSurveyYear만 쓴다');
  }
}

// ── 동작 검증 ──────────────────────────────────────────────────────────────
// 위의 정적 스캔은 "참조한다"까지만 본다. 참조만 하고 실제로 쓰지 않는 경우를 잡으려면
// 연도를 실제로 바꿔 보고 슬롯·판정·통계·마커·시트명이 따라가는지 실행해야 한다.
console.log('\n## 동작 검증 — 조사 연도를 2027로 바꾸면 전부 따라가는가\n');

const tmp = os.tmpdir();
const bundle = path.join(tmp, `survey-year-sim-${process.pid}.mjs`);
const entry = path.join(tmp, `survey-year-entry-${process.pid}.js`);
fs.writeFileSync(entry, `
export * from '${root}/src/store/surveyStore.ts';
export * from '${root}/src/store/changeSurveyYear.ts';
export { useFileStore } from '${root}/src/store/fileStore.ts';
export { useParcelStore } from '${root}/src/store/parcelStore.ts';
export { useExtractionStore } from '${root}/src/store/extractionStore.ts';
export { buildUploadSlots } from '${root}/src/lib/uploadSlots.ts';
export { markEligibility } from '${root}/src/lib/duplicateDetector.ts';
export { buildWorkbook } from '${root}/src/lib/excelExporter.ts';
export { getMarkerColor, createPopupContent } from '${root}/src/components/Map/mapUtils.ts';
export { createInfoWindowContent } from '${root}/src/components/Map/MarkerInfoWindow.tsx';
export { utils as xlsxUtils } from 'xlsx';
`);
const idbStub = path.join(root, 'scripts/geocoding-failure-sim/idb-stub.js');
await esbuild.build({
  entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: bundle,
  absWorkingDir: root, logLevel: 'silent', nodePaths: [path.join(root, 'node_modules')],
  // xlsx(CJS)가 안에서 require('stream')을 동적으로 부른다. ESM 번들에는 require가 없다.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  define: {
    'import.meta.env.DEV': 'false',
    'import.meta.env.VITE_VWORLD_KEY': '""',
    'import.meta.env.VITE_KAKAO_REST_KEY': 'undefined',
  },
  plugins: [{ name: 'stub', setup(b) {
    b.onResolve({ filter: /geocodeCache$/ }, () => ({ path: idbStub }));
    // leaflet은 import 시점에 window를 요구한다. 마커 색·팝업 문구만 보므로 빈 모듈로 대체한다.
    b.onResolve({ filter: /^leaflet$/ }, () => ({ path: 'leaflet', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export default {};', loader: 'js' }));
  }}],
});
// persist는 window.localStorage가 없으면 저장 기능을 아예 붙이지 않는다(api.persist 없음).
// 저장값 손상·복구를 보려면 import 전에 메모리 저장소를 window로 흉내 내야 한다.
const memStorage = new Map();
globalThis.window = { localStorage: {
  getItem: (k) => memStorage.get(k) ?? null,
  setItem: (k, v) => memStorage.set(k, v),
  removeItem: (k) => memStorage.delete(k),
} };
const sim = await import(bundle);
fs.unlinkSync(entry); fs.unlinkSync(bundle);

const check = (ok, what, detail = '') => {
  if (!ok) failed++;
  console.log(`  ${ok ? '✓' : '✗'} ${what}${detail ? `  (${detail})` : ''}`);
};
const parcel = (pnu, extra = {}) => ({
  farmerId: 'F1', farmerName: '농가', parcelId: `${pnu}-1`, mainLotNum: '1', subLotNum: '0',
  address: `경상북도 봉화군 봉화읍 A리 ${pnu}`, farmerAddress: '', sido: '경상북도', ri: 'A리',
  sigungu: '봉화군', eubmyeondong: '봉화읍', sampledYears: [], isEligible: true, isSelected: false,
  fileSource: 'master', pnu, parcelCategory: 'public-payment', ...extra,
});
const fileConfig = (id, year, role) => ({
  id, filename: `${id}.xlsx`, year, role, columnMapping: { farmerId: '', parcelId: '', address: '' },
  rowCount: 1, status: 'pending',
});

// 1) 연도 변경 → 슬롯·파일 정리
{
  const { useSurveyStore, useFileStore, useParcelStore, useExtractionStore, changeSurveyYear, buildUploadSlots } = sim;
  useSurveyStore.getState().setSurveyYear(2026);
  for (const s of buildUploadSlots(2026).required) useFileStore.getState().addFile(fileConfig(s.slotId, s.defaultYear, s.defaultRole));
  useParcelStore.getState().setAllParcels([parcel('4792025031000100000')]);
  check(sim.hasWorkInProgress(), '작업 중 판정: 파일·분석 결과가 있으면 true');

  // 값만 바꾸면 어떻게 되는지 — 고아 파일이 생긴다는 사실 자체를 확인해 둔다
  useSurveyStore.getState().setSurveyYear(2027);
  const slotIds27 = new Set(buildUploadSlots(2027).all.map((s) => s.slotId));
  const orphans = useFileStore.getState().files.filter((f) => !slotIds27.has(f.id)).map((f) => f.id);
  check(orphans.length === 2 && orphans.includes('master-2026') && orphans.includes('sampled-2024'),
    'setSurveyYear만 부르면 이전 파일이 고아가 된다 (그래서 changeSurveyYear가 필요)', orphans.join(','));
  useSurveyStore.getState().setSurveyYear(2026);

  check(changeSurveyYear(2026) === false, '같은 연도로 바꾸면 아무것도 하지 않는다');
  check(useFileStore.getState().files.length === 3, '같은 연도면 파일이 그대로다');

  check(changeSurveyYear(2027) === true, 'changeSurveyYear(2027) 적용');
  check(useSurveyStore.getState().surveyYear === 2027, '조사 연도 = 2027');
  check(useFileStore.getState().files.length === 0, '등록 파일 초기화');
  check(useParcelStore.getState().allParcels.length === 0, '분석 결과 초기화');
  check(useExtractionStore.getState().result === null, '추출 결과 초기화');
  const slots = buildUploadSlots(useSurveyStore.getState().surveyYear);
  check(slots.requiredIds.join(',') === 'master-2027,sampled-2026,sampled-2025', '필수 슬롯 id가 2027 기준', slots.requiredIds.join(','));
  check(slots.required.map((s) => s.defaultYear).join(',') === '2027,2026,2025', '슬롯 기본 연도', slots.required.map((s) => s.defaultYear).join(','));
  check(slots.required[1].defaultYear === sim.sampledYearsOf(2027)[0] && slots.required[2].defaultYear === sim.sampledYearsOf(2027)[1],
    '슬롯 연도 순서 = sampledYearsOf 순서 (분석 화면이 같은 순서로 파일을 찾는다)');
}

// 2) 중복 판정·통계가 파생 연도로 키를 잡는가
{
  const { useSurveyStore, useParcelStore, markEligibility, sampledYearsOf } = sim;
  const [recent, older] = sampledYearsOf(useSurveyStore.getState().surveyYear);
  const A = parcel('4792025031000100000'), B = parcel('4792025031000200000'), C = parcel('4792025031000300000'), D = parcel('4792025031000400000');
  // 호출자가 어떤 순서로 넣든 결과가 같아야 한다 — 오래된 연도를 먼저 넣어 본다
  const marked = markEligibility([A, B, C, D], { [older]: [B, D], [recent]: [A, D] });
  const by = Object.fromEntries(marked.map((p) => [p.pnu, p]));
  check(by[A.pnu].sampledYears.join(',') === `${recent}` && !by[A.pnu].isEligible, `${recent} 채취만 → sampledYears=[${recent}]`, by[A.pnu].sampledYears.join(','));
  check(by[B.pnu].sampledYears.join(',') === `${older}` && !by[B.pnu].isEligible, `${older} 채취만 → sampledYears=[${older}]`, by[B.pnu].sampledYears.join(','));
  check(by[C.pnu].sampledYears.length === 0 && by[C.pnu].isEligible, '미채취 → 적격');
  check(by[D.pnu].sampledYears.join(',') === `${older},${recent}`, '두 해 모두 채취 → 시간순(오름차순). 엑셀 채취이력 컬럼 모양', by[D.pnu].sampledYears.join(','));

  useParcelStore.getState().setAllParcels(marked);
  useParcelStore.getState().calculateStatistics(700);
  const st = useParcelStore.getState().statistics;
  check(st.sampledCountByYear[recent] === 2 && st.sampledCountByYear[older] === 2, '통계가 파생 연도로 집계', JSON.stringify(st.sampledCountByYear));
  const statKeys = Object.keys(st.sampledCountByYear).map(Number).sort((a, b) => a - b).join(',');
  check(statKeys === `${older},${recent}`, '통계 키가 정확히 파생 연도 두 개다', statKeys);
  useParcelStore.getState().reset();
}

// 3) 마커 색·팝업 문구
{
  const { getMarkerColor, createPopupContent, createInfoWindowContent, sampledYearsOf, useSurveyStore } = sim;
  const y = useSurveyStore.getState().surveyYear;
  const [recent, older] = sampledYearsOf(y);
  check(getMarkerColor(parcel('x', { sampledYears: [recent], isEligible: false }), false) === '#dc2626', `${recent} 채취 마커 = 빨강`);
  check(getMarkerColor(parcel('x', { sampledYears: [older], isEligible: false }), false) === '#ea580c', `${older} 채취 마커 = 주황`);
  check(getMarkerColor(parcel('x', { sampledYears: [y - 3], isEligible: true }), false) === '#6b7280', `${y - 3} 채취(범위 밖)는 색에 영향 없음`);
  check(createPopupContent(parcel('x'), false).includes(`${y} 선택`), `팝업 문구 "${y} 선택"`);
  check(createInfoWindowContent(parcel('x')).includes(`${y} 선택`), `인포윈도 문구 "${y} 선택"`);
}

// 4) 엑셀 시트명·컬럼명
{
  const { buildWorkbook, xlsxUtils, useSurveyStore } = sim;
  const y = useSurveyStore.getState().surveyYear;
  const p = parcel('4792025031000100000', { isSelected: true });
  const wb = buildWorkbook({ selectedParcels: [p], representativeParcels: [], excludedParcels: [], allParcels: [p], riStats: [], farmerStats: [] }, y);
  check(wb.SheetNames[0] === `${y}_필지선정`, `첫 시트명 "${y}_필지선정"`, wb.SheetNames[0]);
  const row = xlsxUtils.sheet_to_json(wb.Sheets['전체필지'])[0] ?? {};
  check(`${y}선택` in row, `전체필지 시트에 "${y}선택" 컬럼`, Object.keys(row).filter((k) => /선택$/.test(k)).join(','));
  check(!Object.keys(row).some((k) => /^20\d\d선택$/.test(k) && k !== `${y}선택`), '다른 연도의 선택 컬럼이 없다');
}

// 5) persist — 저장값 손상·범위 밖은 기본값으로, 정상값은 유지
{
  const { useSurveyStore, defaultSurveyYear } = sim;
  const KEY = 'parcel-sampling-survey-year';
  const hydrateWith = async (raw) => {
    // 직전 값이 남아 있으면 "기본값으로 복구"와 구분이 안 된다 — 판별 가능한 값으로 미리 오염시킨다.
    // setState는 persist가 감싸고 있어 저장소에도 쓰므로, 저장값은 그 뒤에 심어야 한다.
    useSurveyStore.setState({ surveyYear: 1999 });
    memStorage.clear();
    if (raw !== undefined) memStorage.set(KEY, raw);
    await useSurveyStore.persist.rehydrate();
    return useSurveyStore.getState().surveyYear;
  };
  const now = defaultSurveyYear();
  check(await hydrateWith(JSON.stringify({ state: { surveyYear: 'abc' }, version: 1 })) === 1999, '문자열 저장값은 거부된다 (현재값 유지)');
  check(await hydrateWith(JSON.stringify({ state: { surveyYear: 99999 }, version: 1 })) === 1999, '범위 밖 숫자는 거부된다 (현재값 유지)');
  check(await hydrateWith(JSON.stringify({ state: { surveyYear: 2020.5 }, version: 1 })) === 1999, '정수가 아니면 거부된다');
  check(await hydrateWith(JSON.stringify({ state: { surveyYear: now - 1 }, version: 1 })) === now - 1, '정상 저장값은 유지된다 (연말에 시작한 조사를 연초에 이어서)');
  check(await hydrateWith(JSON.stringify({ state: { surveyYear: now - 1 }, version: 0 })) === now - 1, '버전 0 저장값도 검증을 거쳐 유지된다');
  check(await hydrateWith(JSON.stringify({ state: { surveyYear: 'abc' }, version: 0 })) === 1999, '버전 0 손상값은 거부된다');
  check(await hydrateWith('{not json') === 1999, 'JSON이 깨지면 현재값 유지');
  check(sim.selectableYears(now - 5).includes(now - 5), '창 밖 연도가 선택돼 있으면 목록에 포함된다 (select 표시 불일치 방지)');
  useSurveyStore.setState({ surveyYear: now });
}

if (failed) {
  console.error(`\n${failed}건 실패.`);
  process.exit(1);
}
console.log('\n전체 통과.');
