/**
 * EUMRI_MAP 실측 검증 — VWorld 연속지적도와 대조한다.
 *
 * 이 표가 틀리면 다른 리의 필지 좌표를 가져오고, 좌표 검증은 봉화군 전체를
 * 통과시키므로 걸러지지 않는다. 지도에 조용히 엉뚱한 곳이 찍힌다.
 * 2026-09-07에 실제로 3건이 틀려 있었다(소천면 신라리→서천리 오매핑, 리 2개 누락).
 *
 * 실재 목록은 법정리 경계 레이어(LT_C_ADRI_INFO)에서 받고, 각 리의 지적도 addr가
 * 같은 이름을 쓰는지 교차 확인한다.
 *
 * usage:
 *   node scripts/verify-eumri-map.mjs
 *
 * .env의 VITE_VWORLD_KEY를 읽는다. VWorld는 Referer가 없으면 INCORRECT_KEY를
 * 돌려주므로 등록된 도메인을 붙인다(--referer로 바꿀 수 있다).
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const REFERER = process.argv.find(a => a.startsWith('--referer='))?.split('=')[1]
  ?? 'https://bluesky78060.github.io';

function readKey() {
  if (process.env.VITE_VWORLD_KEY) return process.env.VITE_VWORLD_KEY.trim();
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return '';
  const m = fs.readFileSync(envPath, 'utf-8').match(/^VITE_VWORLD_KEY\s*=\s*(.+)$/m);
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
}

const key = readKey();
if (!key) {
  console.error('VITE_VWORLD_KEY를 찾지 못했습니다 (.env 또는 환경변수).');
  process.exit(2);
}

const src = fs.readFileSync(path.join(root, 'src/lib/pnuGenerator.ts'), 'utf-8');
const block = src.slice(src.indexOf('const EUMRI_MAP'), src.indexOf('function toInt'));
const mapped = new Map();
for (const [, eum, ri, emd, riCode] of block.matchAll(/'([^']+)_([^']+)':\s*\['(\d{3})',\s*'(\d{2})'\]/g)) {
  mapped.set(`47920${emd}${riCode}`, [eum, ri]);
}

// ── 1. 실재 리 목록: 법정리 경계 레이어(LT_C_ADRI_INFO) ──
// 봉화군 리 전부를 한 번에 돌려준다(2026-09-07 실측 72개). 예전에는 읍면 10개 ×
// 리 코드 20~44를 하나씩 찔러 보았는데, 그 범위 밖에 있는 리는 영영 "누락"으로
// 잡히지 않는다. 여기서는 범위를 가정하지 않는다.
const real = new Map();
const failures = [];
{
  const url = 'https://api.vworld.kr/req/data?service=data&request=GetFeature'
    + `&data=LT_C_ADRI_INFO&key=${key}&format=json&geometry=false`
    + '&attrFilter=li_cd:like:47920%25&size=1000';
  const res = await fetch(url, { headers: { Referer: REFERER } });
  const json = await res.json();
  const r = json.response;
  if (r?.status !== 'OK') {
    console.error(`리 경계 조회 실패: ${r?.error?.text ?? r?.status}`);
    process.exit(2);
  }
  for (const f of r.result?.featureCollection?.features ?? []) {
    // full_nm: "경상북도 봉화군 <읍면> <리>"
    const parts = (f.properties?.full_nm ?? '').split(/\s+/);
    if (parts.length >= 4 && /^\d{10}$/.test(f.properties?.li_cd ?? '')) {
      real.set(f.properties.li_cd, [parts[2], parts[3]]);
    }
  }
  if (real.size === 0) {
    console.error('리 경계가 비어 있습니다 (li_cd like 47920%)');
    process.exit(2);
  }
}

// ── 2. 교차 확인: 연속지적도(LP_PA_CBND_BUBUN)의 addr가 같은 이름을 쓰는가 ──
// 좌표는 결국 이 레이어에서 나온다. 경계 레이어와 지적도가 다른 이름을 쓰면
// 표가 경계 레이어와 맞아도 지적도와는 어긋날 수 있다.
async function probe(code10) {
  const url = 'https://api.vworld.kr/req/data?service=data&request=GetFeature'
    + `&data=LP_PA_CBND_BUBUN&key=${key}&format=json&geometry=false`
    + `&attrFilter=pnu:like:${code10}%25&size=1`;
  try {
    const res = await fetch(url, { headers: { Referer: REFERER } });
    const json = await res.json();
    const r = json.response;
    // NOT_FOUND는 "그 코드에 필지가 없다"는 정상 응답이다. 실패로 세지 않는다.
    if (r?.status === 'NOT_FOUND') return [code10, null, null];
    if (r?.status !== 'OK') return [code10, null, r?.error?.text ?? r?.status];
    const f = r.result?.featureCollection?.features ?? [];
    if (f.length === 0) return [code10, null, null];
    // "경상북도 봉화군 <읍면> <리> ..."
    const parts = (f[0].properties?.addr ?? '').split(/\s+/);
    return [code10, parts.length >= 4 ? [parts[2], parts[3]] : null, null];
  } catch (err) {
    return [code10, null, String(err)];
  }
}

const cadastralMismatch = [];
{
  const codes = [...real.keys()].sort();
  // 동시 12개씩
  for (let i = 0; i < codes.length; i += 12) {
    const batch = await Promise.all(codes.slice(i, i + 12).map(probe));
    for (const [code, val, err] of batch) {
      if (err) { failures.push([code, err]); continue; }
      const [eum, ri] = real.get(code);
      // 지적도에 필지가 없는 리(전부 산지 등)는 있을 수 있다. 이름이 다를 때만 문제다.
      if (val && (val[0] !== eum || val[1] !== ri)) {
        cadastralMismatch.push([code, `${eum} ${ri}`, `${val[0]} ${val[1]}`]);
      }
    }
  }
}

const wrong = [], missing = [];
for (const [code, [eum, ri]] of [...real].sort()) {
  const m = mapped.get(code);
  if (!m) { missing.push([code, eum, ri]); continue; }
  if (m[0] !== eum || m[1] !== ri) wrong.push([code, `${m[0]}_${m[1]}`, `${eum} ${ri}`]);
}
const extra = [...mapped].filter(([c]) => !real.has(c));

console.log(`실재 리 ${real.size}개 / 매핑 ${mapped.size}개`);
if (failures.length) {
  console.log(`\n조회 실패 ${failures.length}건 (판정에서 제외):`);
  for (const [c, e] of failures.slice(0, 5)) console.log(`  ${c}  ${e}`);
}
if (wrong.length) {
  console.log('\n=== 잘못 매핑 — 다른 리의 좌표를 가져온다 ===');
  for (const [c, m, r] of wrong) console.log(`  ${c}  매핑=${m}  실제=${r}`);
}
if (missing.length) {
  console.log(`\n=== 매핑 누락 ${missing.length}건 — PNU 생성 실패 → 주소 폴백 ===`);
  for (const [c, e, r] of missing) console.log(`  ${c}  ${e} ${r}`);
}
if (extra.length) {
  console.log(`\n=== 실재하지 않는 코드 ${extra.length}건 ===`);
  for (const [c, v] of extra) console.log(`  ${c}  ${v[0]}_${v[1]}`);
}
if (cadastralMismatch.length) {
  console.log(`\n=== 경계 레이어와 지적도의 이름 불일치 ${cadastralMismatch.length}건 ===`);
  for (const [c, b, p] of cadastralMismatch) console.log(`  ${c}  경계=${b}  지적도=${p}`);
}

if (wrong.length || missing.length || extra.length || cadastralMismatch.length) {
  console.error('\n매핑이 실측과 다릅니다.');
  process.exit(1);
}
console.log('\n매핑이 실측과 일치합니다.');
