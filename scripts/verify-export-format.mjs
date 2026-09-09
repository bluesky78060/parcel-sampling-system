/**
 * 내보내기 형식 검증 — 산출물이 **타입 있는 형식(xlsx)으로만** 나가는지 본다.
 *
 * ## 왜 소스를 훑는가
 *
 * `src/lib/__tests__/excelExporter.test.ts`는 "수식 주입은 도달 불가"를 못 박고,
 * 그래서 `=`·`+`·`-`·`@` 접두사를 **이스케이프하지 않는다**는 결정을 고정한다.
 * 그 논증 전체가 전제 하나에 기대고 있다 — **내보내기가 전부 `bookType: 'xlsx'`다.**
 * xlsx 셀에는 타입이 있어 `<v>`에 담긴 글자가 수식으로 평가되지 않기 때문이다.
 *
 * **CSV는 다르다. 타입이 없어 수식 주입이 실제로 성립한다.** 즉 "위험이 없으니
 * 방어하지 않는다"는 결정은 CSV 경로가 하나라도 생기는 순간 무너진다.
 *
 * 그런데 2026-09-09 실측 결과 그 전제를 지키는 것이 **아무것도 없었다.**
 * `src/lib/excelExporter.ts`의 `bookType: 'xlsx'`를 `'csv'`로 바꿔도 해당 테스트가
 * 12/12 통과했다 — 테스트는 `buildWorkbook`만 부르고 쓰기는 **테스트 헬퍼가 스스로**
 * xlsx로 하기 때문에, 프로덕션 쓰기 경로를 한 번도 지나지 않는다.
 *
 * 워크북을 만들어 보는 방식으로는 이 전제를 고정할 수 없다(쓰기가 테스트 밖이다).
 * 그래서 **소스를 직접 검사한다.**
 *
 * ## 검사 항목
 *
 * 1. `src/`의 모든 SheetJS 쓰기 호출(`XLSX.write`·`writeFile`·`writeFileXLSX`)이
 *    인자에 `bookType: 'xlsx'`를 **명시**하는가.
 *    (`writeFile`은 확장자로 형식을 추론하지만, 명시를 요구해 파일명 오타로
 *     형식이 바뀌는 경로까지 막는다.)
 * 2. `bookType:`에 `'xlsx'` 아닌 값이 어디에도 없는가.
 * 3. `sheet_to_csv`·`sheet_to_txt`가 어디에도 없는가 — 워크북을 거치지 않고
 *    타입 없는 텍스트를 뽑아내는 우회로다.
 * 4. 알려진 내보내기 지점이 여전히 검사에 걸리는가(공허한 통과 방지).
 *    호출을 못 찾으면 검사는 조용히 "위반 0건"이 된다. 그것이 가장 나쁘다.
 *
 * ## 한계
 *
 * 옵션 객체를 변수로 빼면 인자 안에서 `bookType`을 찾지 못해 **위반으로 잡힌다.**
 * 오탐이지만 안전한 방향이고, 인라인으로 되돌리면 풀린다.
 *
 * usage: node scripts/verify-export-format.mjs [root]
 *
 * 이 파일은 CLI이자 모듈이다. `src/lib/__tests__/exportFormat.test.ts`가
 * `checkExportFormat`을 불러 같은 검사를 vitest 안에서 돌린다 — 그래야 CI의
 * `npm run test`와 개발자의 로컬 실행 양쪽에서 실제로 돈다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const selfPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(selfPath), '..');

/** 이 파일들은 내보내기 지점이다. 여기서 쓰기 호출이 사라지면 검사가 헛돈다. */
export const KNOWN_EXPORT_SITES = [
  'src/lib/excelExporter.ts',
  'src/pages/PnuGeneratorPage.tsx',
  'src/pages/AddressMergerPage.tsx',
];

/** SheetJS 쓰기 API 이름 */
const WRITE_FNS = ['write', 'writeFile', 'writeFileXLSX', 'writeFileAsync', 'writeXLSX'];

/** 타입 없는 텍스트를 뽑아내는 우회로 */
const FORBIDDEN_APIS = ['sheet_to_csv', 'sheet_to_txt'];

/**
 * 주석을 공백으로 지운다. 줄바꿈은 남겨 줄 번호가 어긋나지 않게 한다.
 *
 * 지우지 않으면 규칙을 설명하는 주석("`sheet_to_csv`를 쓰지 말 것")이 스스로
 * 위반으로 잡힌다. 실제로 excelExporter.test.ts의 주석이 그런 문구를 담고 있다.
 *
 * **문자열 리터럴은 지우지 않고 건너뛰기만 한다** — `bookType: 'xlsx'` 판정에
 * 문자열 내용이 필요하기 때문이다. 건너뛰는 이유는 문자열 안의 `//`·`/*`를
 * 주석으로 오인하지 않기 위해서다.
 */
function stripComments(src) {
  const out = src.split('');
  let i = 0;
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === '//') {
      const end = src.indexOf('\n', i);
      blank(i, end === -1 ? src.length : end);
      i = end === -1 ? src.length : end;
    } else if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (src[i] === '`' || src[i] === '"' || src[i] === "'") {
      // 문자열 리터럴 — 내용은 그대로 두고 끝까지 건너뛴다
      const quote = src[i];
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === quote) break;
        if (quote !== '`' && src[j] === '\n') break;
        j++;
      }
      i = j + 1;
    } else {
      i++;
    }
  }
  return out.join('');
}

/** `(` 로 시작하는 위치에서 짝이 맞는 `)` 까지의 인자 문자열 */
function argsAt(src, openParen) {
  let depth = 0;
  for (let i = openParen; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') {
      depth--;
      if (depth === 0) return src.slice(openParen + 1, i);
    }
  }
  return null;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(full);
  }
  return out;
}

/**
 * @returns {{ violations: {file:string,line:number,what:string,detail:string}[],
 *             writeCalls: {file:string,line:number}[] }}
 */
export function checkExportFormat(root = repoRoot) {
  const srcDir = path.join(root, 'src');
  const violations = [];
  const writeCalls = [];
  const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

  for (const full of walk(srcDir)) {
    const rel = path.relative(root, full).split(path.sep).join('/');
    const raw = fs.readFileSync(full, 'utf-8');
    const code = stripComments(raw);

    // 이 파일이 xlsx를 어떻게 들여왔는가
    const nsMatch = code.match(/import\s+\*\s+as\s+(\w+)\s+from\s+['"]xlsx['"]/);
    const namedMatch = code.match(/import\s*\{([^}]*)\}\s*from\s*['"]xlsx['"]/);
    const ns = nsMatch?.[1] ?? null;
    const named = namedMatch
      ? namedMatch[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop().trim())
      : [];
    const importsXlsx = Boolean(ns || namedMatch);

    // (3) 금지 API — import 여부와 무관하게 본다
    for (const api of FORBIDDEN_APIS) {
      // 호출(`(`)을 요구하지 않는다. `const toCsv = XLSX.utils.sheet_to_csv`처럼
      // **별칭으로 받아 두고 나중에 부르면** 호출 형태 검사를 빠져나간다(실측 확인).
      // 이름이 등장하는 것 자체를 금지하는 편이 좁게 놓치는 것보다 낫다 —
      // 주석은 위에서 지웠으므로 규칙을 설명하는 문장은 걸리지 않는다.
      const re = new RegExp(`\\b${api}\\b`, 'g');
      let m;
      while ((m = re.exec(code)) !== null) {
        violations.push({
          file: rel, line: lineOf(code, m.index), what: `${api} 사용`,
          detail: '타입 없는 텍스트로 뽑아내면 수식 주입이 성립한다',
        });
      }
    }

    // (2) xlsx 아닌 bookType — 호출 형태와 무관하게 본다
    {
      const re = /bookType\s*:\s*['"]([^'"]*)['"]/g;
      let m;
      while ((m = re.exec(code)) !== null) {
        if (m[1] !== 'xlsx') {
          violations.push({
            file: rel, line: lineOf(code, m.index), what: `bookType: '${m[1]}'`,
            detail: 'xlsx 외의 형식은 셀 타입이 없어 수식 주입이 성립한다',
          });
        }
      }
    }

    if (!importsXlsx) continue;

    // (1) 쓰기 호출마다 bookType: 'xlsx' 명시 확인
    for (const fn of WRITE_FNS) {
      const patterns = [];
      if (ns) patterns.push(new RegExp(`\\b${ns}\\s*\\.\\s*${fn}\\s*\\(`, 'g'));
      if (named.includes(fn)) patterns.push(new RegExp(`(?<![.\\w])${fn}\\s*\\(`, 'g'));
      for (const re of patterns) {
        let m;
        while ((m = re.exec(code)) !== null) {
          const open = code.indexOf('(', m.index + m[0].length - 1);
          const args = argsAt(code, open);
          const line = lineOf(code, m.index);
          writeCalls.push({ file: rel, line });
          if (args === null || !/bookType\s*:\s*['"]xlsx['"]/.test(args)) {
            violations.push({
              file: rel, line, what: `${fn}()에 bookType: 'xlsx'가 없다`,
              detail: '옵션을 변수로 뺐다면 인라인으로 되돌려라 — 이 검사는 인자만 본다',
            });
          }
        }
      }
    }
  }

  // (4) 공허한 통과 방지
  for (const site of KNOWN_EXPORT_SITES) {
    if (!writeCalls.some((c) => c.file === site)) {
      violations.push({
        file: site, line: 0, what: '알려진 내보내기 지점에서 쓰기 호출을 찾지 못했다',
        detail: '옮겼다면 scripts/verify-export-format.mjs의 KNOWN_EXPORT_SITES를 고쳐라',
      });
    }
  }

  return { violations, writeCalls };
}

// ── CLI ────────────────────────────────────────────────────────────────────
if (process.argv[1] && path.resolve(process.argv[1]) === selfPath) {
  const root = process.argv[2] ?? repoRoot;
  const { violations, writeCalls } = checkExportFormat(root);

  console.log('## SheetJS 쓰기 호출\n');
  for (const c of writeCalls) console.log(`  · ${c.file}:${c.line}`);
  if (!writeCalls.length) console.log('  (없음)');

  console.log('\n## 위반\n');
  if (violations.length) {
    for (const v of violations) {
      console.log(`  ✗ ${v.file}:${v.line}  ${v.what}`);
      console.log(`      ${v.detail}`);
    }
    console.error(`\n${violations.length}건 실패.`);
    process.exit(1);
  }
  console.log('  ✓ 없음');
  console.log('\n전체 통과.');
}
