/**
 * 추출 병합 시뮬레이터 — 실제 extractionStore 로직을 그대로 실행한다.
 *
 * 2026-09-07 사용자 보고: "공익직불제 800개에 대표필지 260을 하는데 왜 다 대표필지로
 * 추출되었지". representativeTarget이 아무데서도 읽히지 않아 적격 대표가 전부 들어가고,
 * 초과분 제거가 비대표만 걷어내 결과가 전원 대표필지가 됐다.
 *
 * usage: node scripts/extraction-sim/scenarios.mjs <srcDir>
 */
import * as esbuild from 'esbuild';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const root = process.argv[2] ?? path.resolve(import.meta.dirname, '../..');
const tmp = os.tmpdir();
const out = path.join(tmp, `extract-sim-${process.pid}.mjs`);
const entry = path.join(tmp, `extract-entry-${process.pid}.js`);
const idbStub = path.join(root, 'scripts/geocoding-failure-sim/idb-stub.js');

fs.writeFileSync(entry, `
export { useExtractionStore } from '${root}/src/store/extractionStore.ts';
export * from '${root}/src/lib/parcelCategory.ts';
`);
await esbuild.build({
  entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out,
  absWorkingDir: root,
  define: {
    'import.meta.env.DEV': 'false',
    'import.meta.env.VITE_VWORLD_KEY': '""',
    'import.meta.env.VITE_KAKAO_REST_KEY': 'undefined',
  },
  plugins: [{ name: 'stub', setup(b) {
    b.onResolve({ filter: /geocodeCache$/ }, () => ({ path: idbStub }));
  }}],
});
const mod = await import(out);
fs.unlinkSync(entry); fs.unlinkSync(out);
const { useExtractionStore, isRepresentative, isPublicPayment } = mod;

// ── 데이터 생성 ───────────────────────────────────────────────
const RIS = Array.from({ length: 20 }, (_, i) => `${String.fromCharCode(65 + i)}리`);
let seq = 0;
function parcel(ri, farmerId, opts = {}) {
  seq++;
  return {
    farmerId, farmerName: `농가${farmerId}`, parcelId: `${100 + seq}-1`,
    mainLotNum: String(100 + seq), subLotNum: '1',
    address: `봉화군 ${ri} ${100 + seq}-1`, farmerAddress: '', sido: '경상북도',
    ri, sigungu: '봉화군', eubmyeondong: '봉화읍',
    area: 3000, sampledYears: [], isEligible: true, isSelected: false,
    fileSource: 'master', pnu: `4792025031${String(10000 + seq).padStart(5, '0')}0000`.slice(0, 19),
    coords: { lat: 36.9 + (seq % 100) / 10000, lng: 128.9 + (seq % 97) / 10000 },
    parcelCategory: 'public-payment',
    ...opts,
  };
}

function makeMaster(perRi = 200) {
  const out = [];
  for (const ri of RIS) for (let i = 0; i < perRi; i++) out.push(parcel(ri, `F${ri}${i % 40}`));
  return out;
}

const baseConfig = {
  totalTarget: 800, publicPaymentTarget: 800, representativeTarget: 260,
  perRiTarget: 40, minPerFarmer: 1, maxPerFarmer: 3,
  extractionMethod: 'random', underfillPolicy: 'supplement', randomSeed: 42,
  excludedRis: [], riTargetOverrides: {}, landCategoryRatios: {},
  enableLandCategoryFilter: false,
  spatialConfig: { enableSpatialFilter: false, maxRiDistanceKm: 0, maxParcelDistanceKm: 1, densityWeight: 0.7 },
};

function run(name, { master, reps, config, expect }) {
  useExtractionStore.getState().updateConfig({ ...baseConfig, ...config });
  useExtractionStore.getState().runExtraction(master, reps ?? []);
  const r = useExtractionStore.getState().result;
  const sel = r?.selectedParcels ?? [];
  const repCount = sel.filter(isRepresentative).length;
  const pubCount = sel.filter(isPublicPayment).length;
  const bothCount = sel.filter(p => p.parcelCategory === 'both').length;
  const uniq = new Set(sel.map(p => p.pnu)).size;

  const problems = [];
  const e = expect ?? {};
  if (e.total !== undefined && sel.length !== e.total) problems.push(`총 ${sel.length} (기대 ${e.total})`);
  if (e.repMax !== undefined && repCount > e.repMax) problems.push(`대표 ${repCount} > 상한 ${e.repMax}`);
  if (e.repMin !== undefined && repCount < e.repMin) problems.push(`대표 ${repCount} < 최소 ${e.repMin}`);
  if (e.pubMin !== undefined && pubCount < e.pubMin) problems.push(`공익 ${pubCount} < 최소 ${e.pubMin}`);
  if (sel.length !== uniq) problems.push(`중복 ${sel.length - uniq}건`);
  if (e.bothMin !== undefined && bothCount < e.bothMin)
    problems.push(`both ${bothCount} < 최소 ${e.bothMin} — 대표필지가 공익 시트에서 사라진다`);
  // errorsAllowed: 알려진 범위 밖 결함(예: 대체 복사가 농가당 상한을 안 봄)만 눈감는다
  const unexpectedErrors = (r?.validation?.errors ?? []).filter(x => !(e.errorsAllowed ?? []).includes(x.code));
  if (e.noError && unexpectedErrors.length > 0)
    problems.push(`검증 오류: ${unexpectedErrors.map(x => x.code).join(',')}`);
  if (e.check) problems.push(...e.check(sel, r));

  return { 시나리오: name, 총: sel.length, 고유: uniq, 대표: repCount, 공익: pubCount,
           both: bothCount, 판정: problems.length ? '✗' : '✓', problems };
}

// ── 시나리오 ──────────────────────────────────────────────────
const rows = [];
const master = makeMaster();

// 사용자가 실제로 겪은 설정. 적격 대표가 목표보다 많다.
{
  const reps = [];
  for (const ri of RIS) for (let i = 0; i < 50; i++) reps.push(parcel(ri, `R${ri}${i}`, { fileSource: 'rep' }));
  rows.push(run('공익 800 / 대표 260 (적격 대표 1000건)', {
    master, reps, config: { publicPaymentTarget: 800, representativeTarget: 260 },
    expect: { total: 800, repMax: 260, pubMin: 500, noError: true },
  }));
}

// 부적격 대표가 섞인 경우 — 대체 복사가 상한을 넘기면 안 된다.
// 상한을 적격분에만 걸고 대체 복사는 부적격 수만큼 그대로 더하면 대표가 상한을 넘는다.
{
  const reps = [];
  for (const ri of RIS) for (let i = 0; i < 50; i++) {
    const bad = i % 10 === 0;
    reps.push(parcel(ri, `X${ri}${i}`, { fileSource: 'rep', isEligible: !bad, sampledYears: bad ? [2025] : [] }));
  }
  rows.push(run('공익 800 / 대표 260 (적격 900 + 부적격 100)', {
    master, reps, config: { publicPaymentTarget: 800, representativeTarget: 260 },
    // FARMER_OVER_LIMIT: 대체 복사가 농가당 상한을 안 보는 기존 결함(이 시뮬레이터 범위 밖)
    expect: { total: 800, repMax: 260, pubMin: 500, noError: true, errorsAllowed: ['FARMER_OVER_LIMIT'] },
  }));
}

// 부적격 대표가 있고 적격이 상한에 못 미치면 — 부적격 수만큼 대체 복사해 채운다
{
  const reps = [];
  for (const ri of RIS) for (let i = 0; i < 10; i++) {
    const bad = i % 5 === 0;
    reps.push(parcel(ri, `Y${ri}${i}`, { fileSource: 'rep', isEligible: !bad, sampledYears: bad ? [2024] : [] }));
  }
  rows.push(run('공익 800 / 대표 260 (적격 160 + 부적격 40 → 대체 40)', {
    master, reps, config: { publicPaymentTarget: 800, representativeTarget: 260 },
    expect: { total: 800, repMin: 200, repMax: 200, noError: true, errorsAllowed: ['FARMER_OVER_LIMIT'] },
  }));
}

// 대표필지 파일의 리 표기가 마스터와 다른 경우("봉화읍 A리" vs "A리"), PNU도 없음.
// farmerKey에 ri가 들어가면서 보조 키 매칭은 끊기지만, 마스터 보충이 PNU를 채워 주므로
// 같은 필지로 인식되어야 한다(both로 태깅되고 두 번 실리지 않는다).
{
  const overlap = master.slice(0, 40).map(p => ({
    ...p, fileSource: 'rep', pnu: '', ri: `봉화읍 ${p.ri}`,
    address: `경상북도 봉화군 봉화읍 ${p.ri} ${p.parcelId}`,
  }));
  rows.push(run('대표필지 리 표기 불일치 + PNU 없음 (마스터 겹침)', {
    master, reps: overlap, config: { publicPaymentTarget: 800, representativeTarget: 40 },
    expect: { total: 800, repMin: 40, repMax: 40, noError: true, bothMin: 1 },
  }));
}

// 적격 대표가 상한보다 적으면 그대로 전부
{
  const reps = [];
  for (const ri of RIS) for (let i = 0; i < 5; i++) reps.push(parcel(ri, `S${ri}${i}`, { fileSource: 'rep' }));
  rows.push(run('공익 800 / 대표 260 (적격 대표 100건)', {
    master, reps, config: { publicPaymentTarget: 800, representativeTarget: 260 },
    expect: { total: 800, repMax: 260, pubMin: 700, noError: true },
  }));
}

// 대표필지 없음 — 회귀 확인
rows.push(run('대표필지 없음 (회귀)', {
  master, reps: [], config: { publicPaymentTarget: 800, representativeTarget: 0 },
  expect: { total: 800, repMax: 0, pubMin: 800, noError: true },
}));

// 대표필지가 마스터에도 있는 경우 — 'both'가 되어 양쪽 시트에 실려야 한다
{
  // 마스터에서 실제로 뽑힐 만한 필지를 대표필지 파일로도 올린다
  const overlap = master.slice(0, 60).map(p => ({ ...p, fileSource: 'rep' }));
  rows.push(run('대표필지가 마스터와 겹침 (both)', {
    master, reps: overlap,
    config: { publicPaymentTarget: 800, representativeTarget: 60 },
    expect: { total: 800, repMax: 60, pubMin: 740, noError: true, bothMin: 1 },
  }));
}

// 마스터에 같은 필지가 작물별로 여러 행 있는 경우 — dedupe 순서
// (초과분을 먼저 자르고 dedupe하면 그만큼 목표에 미달한다)
function makeDupMaster(dupEvery = 5) {
  const dupMaster = [];
  for (const ri of RIS) {
    for (let i = 0; i < 200; i++) {
      const base = parcel(ri, `D${ri}${i % 40}`);
      dupMaster.push(base);
      // 같은 필지를 작물만 달리해 한 행 더 등록
      if (i % dupEvery === 0) dupMaster.push({ ...base, cropType: '벼', fileSource: 'master2' });
    }
  }
  return dupMaster;
}
{
  const dupMaster = makeDupMaster();
  const reps = [];
  for (const ri of RIS) for (let i = 0; i < 3; i++) reps.push(parcel(ri, `U${ri}${i}`, { fileSource: 'rep' }));
  rows.push(run('마스터에 같은 지번 중복 행 + 대표 60건', {
    master: dupMaster, reps,
    config: { publicPaymentTarget: 800, representativeTarget: 60 },
    expect: { total: 800, repMax: 60, noError: true },
  }));
}

// 리별 목표를 다르게 준 경우 — 빈 풀 조기 이탈
{
  const reps = [];
  // 대표 40건에 상한 20 — 상한 로직이 실제로 타야 한다(건수 ≤ 상한이면 조기 return이라 검사가 안 된다)
  for (const ri of RIS.slice(0, 5)) for (let i = 0; i < 8; i++) reps.push(parcel(ri, `T${ri}${i}`, { fileSource: 'rep' }));
  const overrides = {}; RIS.forEach((ri, i) => { overrides[ri] = i < 3 ? 1 : 30; });
  rows.push(run('리별 목표 불균일 + 대표 40건/상한 20', {
    master, reps, config: { publicPaymentTarget: 300, representativeTarget: 20, riTargetOverrides: overrides },
    expect: { total: 300, repMax: 20, noError: true },
  }));
}

// 부적격 대표 × 중복 마스터 — 대체 복사가 같은 필지의 두 행을 다 담으면 dedupe 뒤 절반이 사라진다
{
  const dupMaster = makeDupMaster(1); // 모든 지번이 2행
  const reps = [];
  for (const ri of RIS) for (let i = 0; i < 10; i++)
    reps.push(parcel(ri, `Z${ri}${i}`, { fileSource: 'rep', isEligible: false, sampledYears: [2025] }));
  rows.push(run('부적격 대표 200 × 모든 지번 2행 마스터 → 대체 200', {
    master: dupMaster, reps, config: { publicPaymentTarget: 800, representativeTarget: 260 },
    expect: { total: 800, repMin: 200, repMax: 200, noError: true, errorsAllowed: ['FARMER_OVER_LIMIT'] },
  }));
}

// 대표 목표 > 공익 목표 — 설정 화면이 따로 클램프하므로 여기서 막지 않으면
// "왜 다 대표필지로 추출되었지"가 그대로 재현된다
{
  const reps = [];
  for (const ri of RIS) for (let i = 0; i < 20; i++) reps.push(parcel(ri, `V${ri}${i}`, { fileSource: 'rep' }));
  rows.push(run('공익 200 / 대표 260 (적격 대표 400건)', {
    master, reps, config: { publicPaymentTarget: 200, representativeTarget: 260 },
    expect: { total: 200, repMax: 200, noError: true },
  }));
}

// 같은 농가가 두 리에 같은 지번을 가짐 + 대표필지 파일은 그중 B리, PNU 없음, 리 표기 다름.
// 보충 매칭 폴백이 리를 안 보면 A리 필지가 대표로 태깅되고 A리 PNU가 대표필지 행에 실린다.
{
  const pA = parcel('A리', 'XF', { parcelId: '999-9', mainLotNum: '999', subLotNum: '9', pnu: '4792025031999900000' });
  const pB = parcel('B리', 'XF', { parcelId: '999-9', mainLotNum: '999', subLotNum: '9', pnu: '4792025031999988888' });
  const m2 = [pA, pB, ...master];
  const rep = { ...pB, fileSource: 'rep', pnu: '', ri: '봉화읍 B리', address: '경상북도 봉화군 봉화읍 B리 999-9' };
  rows.push(run('같은 농가 두 리 동일 지번 + 대표는 B리(PNU 없음, 리 표기 다름)', {
    master: m2, reps: [rep], config: { publicPaymentTarget: 800, representativeTarget: 10 },
    expect: { total: 800, repMin: 1, repMax: 1, noError: true, check: (sel) => {
      const tagged = sel.filter(p => isRepresentative(p) && p.farmerId === 'XF');
      const out = [];
      if (tagged.length !== 1) out.push(`XF 대표 태깅 ${tagged.length}건 (기대 1)`);
      if (tagged.some(p => p.pnu !== pB.pnu)) out.push(`대표로 태깅된 PNU가 B리가 아님: ${tagged.map(p => p.pnu).join(',')}`);
      return out;
    } },
  }));
}

console.log('');
console.table(rows.map(({ problems, ...r }) => r));
const failed = rows.filter(r => r.problems.length);
if (failed.length) {
  console.error(`\n실패 ${failed.length}건:`);
  for (const f of failed) console.error(`  ✗ ${f.시나리오}\n      ${f.problems.join('\n      ')}`);
  process.exit(1);
}
console.log(`\n전체 ${rows.length}건 통과`);
