import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { applyColumnMapping } from '../excelParser';
import type { ColumnMapping } from '../../types';

/**
 * 엑셀 왕복 계약 — `xlsx` 버전을 올릴 때 무엇이 바뀌었는지 드러내는 그물.
 *
 * npm의 `xlsx`는 0.18.5에서 영구히 멈춰 있고 CVE 두 건(프로토타입 오염·ReDoS)에
 * 노출돼 있다. 수정본은 공식 배포처(cdn.sheetjs.com)에만 있으므로 **npm 밖으로
 * 나가야만 고칠 수 있다**(PROJ1-1-8).
 *
 * 이 앱은 사용자가 올린 임의의 엑셀을 파싱하므로 버전을 올릴 수밖에 없는데,
 * `parseExcelSheets`는 `FileReader`를 써서 node에서 돌지 않는다. 그래서 그 아래의
 * **순수 구간**(`XLSX.read` → `sheet_to_json` → `applyColumnMapping`)을 여기서 고정한다.
 * 버전이 바뀌어 파싱 결과가 달라지면 이 파일이 먼저 깨진다.
 */

/** `parseExcelSheets`가 하는 것과 같은 읽기 경로 */
function readRows(aoa: unknown[][]): Record<string, unknown>[] {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;

  const read = XLSX.read(new Uint8Array(buf), { type: 'array', codepage: 949 });
  const sheet = read.Sheets[read.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
}

const HEADERS = ['경영체번호', '필지주소', '필지번호', '리', '재배면적(노지+시설)'];

describe('엑셀 왕복 — 파싱 계약', () => {
  it('한글 헤더와 값을 그대로 읽는다', () => {
    const rows = readRows([HEADERS, ['12345', '경상북도 봉화군 봉화읍 내성리 100-1', '100-1', '내성리', '1200']]);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0])).toEqual(HEADERS);
    expect(rows[0]['필지주소']).toBe('경상북도 봉화군 봉화읍 내성리 100-1');
    expect(rows[0]['리']).toBe('내성리');
  });

  /** `raw: false`라 숫자도 문자열로 온다. `parseArea`·`normalizeId`가 그것을 전제한다 */
  it('숫자 셀도 문자열로 온다', () => {
    const rows = readRows([HEADERS, ['12345', 'addr', '100', '내성리', 1200]]);
    expect(typeof rows[0]['재배면적(노지+시설)']).toBe('string');
    expect(rows[0]['재배면적(노지+시설)']).toBe('1200');
  });

  /** `defval: ''`라 빈 셀이 사라지지 않는다. 사라지면 헤더 합집합이 어긋난다 */
  it('빈 셀은 빈 문자열로 채워진다', () => {
    const rows = readRows([HEADERS, ['12345', 'addr', '', '내성리', '']]);
    expect(rows[0]['필지번호']).toBe('');
    expect(Object.keys(rows[0])).toEqual(HEADERS);
  });

  it('선행 0을 문자열로 보존한다', () => {
    const rows = readRows([HEADERS, ['00123', 'addr', '0165-0001', '내성리', '0']]);
    expect(rows[0]['경영체번호']).toBe('00123');
    expect(rows[0]['필지번호']).toBe('0165-0001');
  });

  it('행이 여러 개면 순서를 지킨다', () => {
    const rows = readRows([
      HEADERS,
      ['1', 'a', '100', '내성리', '1'],
      ['2', 'b', '200', '문단리', '2'],
      ['3', 'c', '300', '법전리', '3'],
    ]);
    expect(rows.map((r) => r['리'])).toEqual(['내성리', '문단리', '법전리']);
  });
});

/**
 * 적대적 입력. 사용자가 올리는 파일은 신뢰할 수 없다.
 *
 * 여기서 고정하는 것은 **버전과 무관하게 참이어야 하는 안전 속성**이다 —
 * 헤더 이름을 어떻게 바꿔 부르는지(0.18.5는 `__proto__` → `__proto___NaN`)는
 * 구현 세부라 단언하지 않는다.
 */
describe('엑셀 왕복 — 적대적 입력', () => {
  const DANGEROUS = ['__proto__', 'constructor', 'prototype'];

  it('위험한 헤더가 있어도 Object.prototype이 오염되지 않는다', () => {
    const rows = readRows([
      [...DANGEROUS, '경영체번호'],
      ['{"polluted":"YES"}', '{"polluted":"YES"}', '{"polluted":"YES"}', 'F001'],
    ]);
    expect(rows).toHaveLength(1);
    const probe: Record<string, unknown> = {};
    expect(probe.polluted).toBeUndefined();
    expect(Object.keys(probe)).toHaveLength(0);
    expect(({}).constructor).toBe(Object);
  });

  /**
   * `__proto__`와 `constructor`만 own 속성이 되면 안 된다.
   *
   * `prototype`은 평범한 문자열 키라 무해하다 — 실측하니 그대로 통과하고,
   * `getRaw`가 순회해도 아무 일이 없다. 셋을 뭉뚱그려 막으면 근거 없는 제약이 된다.
   */
  it('__proto__와 constructor가 own 속성이 되지 않는다', () => {
    const rows = readRows([[...DANGEROUS, '경영체번호'], ['a', 'b', 'c', 'F001']]);
    const keys = Object.keys(rows[0]);
    expect(keys).not.toContain('__proto__');
    expect(keys).not.toContain('constructor');
    // 값은 어딘가에 살아남되(데이터를 잃지 않는다) 위험하지 않은 이름으로 바뀐다
    expect(keys.length).toBe(4);
  });

  it('행 객체가 정상 프로토타입을 갖는다', () => {
    const rows = readRows([[...DANGEROUS, '경영체번호'], ['a', 'b', 'c', 'F001']]);
    expect(Object.getPrototypeOf(rows[0])).toBe(Object.prototype);
  });

  /**
   * 시트 이름이 `__proto__`인 파일. `parseExcelSheets`가 `workbook.Sheets[name]`으로
   * 찾으므로, 이 이름이 어떻게 다뤄지는지가 동작을 가른다.
   *
   * **버전에 따라 갈리는 지점이라 결과를 단언하지 않고**, 던지지 않는 것과
   * 전역이 오염되지 않는 것만 고정한다. 접근 가능해지면(= 개선) 이 테스트는 계속
   * 통과하고, 그때 `parseExcelSheets`의 "시트를 찾을 수 없습니다" 경로가 바뀐다.
   */
  it('시트 이름이 __proto__여도 터지지 않고 전역을 오염시키지 않는다', () => {
    const ws = XLSX.utils.aoa_to_sheet([['a'], ['1']]);
    const wb = { SheetNames: ['__proto__'], Sheets: { ['__proto__']: ws } };
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
    const read = XLSX.read(new Uint8Array(buf), { type: 'array', codepage: 949 });
    expect(read.SheetNames).toContain('__proto__');
    const probe: Record<string, unknown> = {};
    expect(Object.keys(probe)).toHaveLength(0);
    expect(({}).constructor).toBe(Object);
  });
});

/** 파싱 결과가 `Parcel`이 되는 지점까지 이어 본다 */
describe('엑셀 왕복 — applyColumnMapping까지', () => {
  const mapping: ColumnMapping = {
    farmerId: '경영체번호',
    parcelId: '필지번호',
    address: '필지주소',
    ri: '리',
    area: '재배면적(노지+시설)',
  };

  it('읽은 행이 Parcel이 된다', () => {
    const rows = readRows([
      HEADERS,
      ['00123', '경상북도 봉화군 봉화읍 내성리 100-1', '0100-1', '내성리', '1200'],
    ]);
    const parcels = applyColumnMapping(rows, mapping, 'master.xlsx');
    expect(parcels).toHaveLength(1);
    expect(parcels[0].farmerId).toBe('123');
    expect(parcels[0].ri).toBe('내성리');
    expect(parcels[0].area).toBe(1200);
    expect(parcels[0].rowUid).toBeTruthy();
  });

  it('위험한 헤더가 섞여도 Parcel 생성이 깨지지 않는다', () => {
    const rows = readRows([
      [...['__proto__', 'constructor'], ...HEADERS],
      ['x', 'y', '12345', 'addr', '100', '내성리', '500'],
    ]);
    const parcels = applyColumnMapping(rows, mapping, 'master.xlsx');
    expect(parcels).toHaveLength(1);
    expect(parcels[0].farmerId).toBe('12345');
    expect(Object.keys({})).toHaveLength(0);
  });
});
