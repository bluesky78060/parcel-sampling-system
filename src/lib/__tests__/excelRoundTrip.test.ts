import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { applyColumnMapping, getSheet, rowsFromSheet } from '../excelParser';
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

/**
 * `parseExcelSheets`의 읽기 경로. **`rowsFromSheet`를 그대로 호출한다.**
 *
 * 예전에는 여기서 `sheet_to_json` 옵션을 **다시 선언**했다. 그러면 이 그물이
 * 지키는 것은 "xlsx 라이브러리가 이 옵션에서 이렇게 동작한다"일 뿐이고
 * "우리 파서가 그 옵션을 쓴다"는 아니다 — 실제로 파서 쪽 옵션을 통째로 지워도
 * 346건이 전부 통과했다(리뷰 실측).
 */
function readRows(aoa: unknown[][]): Record<string, unknown>[] {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;

  const read = XLSX.read(new Uint8Array(buf), { type: 'array' });
  return rowsFromSheet(read.Sheets[read.SheetNames[0]]);
}

const HEADERS = ['경영체번호', '필지주소', '필지번호', '리', '재배면적(노지+시설)'];

/** 시트 이름을 임의로 지정한 워크북을 만들어 읽는다 */
function readWorkbookWithSheetName(name: string): XLSX.WorkBook {
  const ws = XLSX.utils.aoa_to_sheet([['경영체번호'], ['F001']]);
  const wb = { SheetNames: [name], Sheets: { [name]: ws } };
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return XLSX.read(new Uint8Array(buf), { type: 'array' });
}

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

  /**
   * `defval: ''`라 빈 셀이 사라지지 않는다. 사라지면 헤더 합집합이 어긋나고,
   * `parseExcelSheets`가 `'h' in merged`로 채워 넣는 보정도 기준을 잃는다.
   *
   * **셀에 `''`를 넣는 것으로는 이 옵션을 시험하지 못한다** — 그건 값이 있는
   * 셀이라 `defval`과 무관하게 나온다. 행을 짧게 잘라 셀 자체를 없애야 한다.
   */
  it('아예 없는 셀도 빈 문자열로 채워진다', () => {
    const rows = readRows([HEADERS, ['12345', 'addr']]); // 뒤 3칸이 없다
    expect(Object.keys(rows[0])).toEqual(HEADERS);
    expect(rows[0]['필지번호']).toBe('');
    expect(rows[0]['리']).toBe('');
    expect(rows[0]['재배면적(노지+시설)']).toBe('');
  });

  it('빈 문자열이 든 셀도 그대로 온다', () => {
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
   * 시트 이름이 `__proto__`인 파일.
   *
   * PROJ1-1-8에서 "own 키가 안 생기니 `Sheets[name]` 조회가 실패해 크게 실패한다,
   * 그러므로 안전하다"고 적었는데 **정반대였다** — 리뷰가 실행으로 뒤집었다.
   * 그 대입은 own 키를 만드는 대신 **`Sheets`의 프로토타입을 워크시트로 바꾸고**,
   * 그래서 `Sheets['__proto__']` 조회는 **성공한다.**
   *
   * 더 나쁜 부수 효과가 있다. 프로토타입이 된 워크시트의 키는 `!ref`·`A1`·`A2`…라,
   * **`A1`이라는 이름의 시트를 요청하면 셀 객체가 시트인 척 넘어온다.**
   *
   * `getSheet`가 own 키로만 찾도록 고쳐 그 주장을 비로소 사실로 만들었다.
   */
  it('__proto__ 시트명이 Sheets의 프로토타입을 바꾼다 (전역 오염은 아니다)', () => {
    const read = readWorkbookWithSheetName('__proto__');
    expect(read.SheetNames).toContain('__proto__');
    // own 키는 안 생기지만 조회는 성공한다 — 이것이 실제 동작이다
    expect(Object.keys(read.Sheets)).not.toContain('__proto__');
    expect(read.Sheets['__proto__']).toBeTruthy();
    expect(Object.getPrototypeOf(read.Sheets)).not.toBe(Object.prototype);
    // 그래도 전역은 멀쩡하다
    expect(Object.keys({})).toHaveLength(0);
    expect(({}).constructor).toBe(Object);
  });

  /**
   * `getSheet`가 own 키로만 찾는다. raw 조회(`Sheets[name]`)로 되돌리면
   * 프로토타입에 올라탄 셀 객체가 시트인 척 넘어오고, `!ref`가 없어 조용히 0행이 된다.
   */
  it('셀 주소와 같은 이름의 시트를 요청해도 셀이 넘어오지 않는다', () => {
    const read = readWorkbookWithSheetName('__proto__');
    // raw 조회는 셀을 돌려준다 — 이것이 위험의 실체다
    expect(read.Sheets['A1']).toBeTruthy();
    // getSheet는 걸러낸다
    expect(getSheet(read, 'A1')).toBeUndefined();
  });

  it('getSheet가 __proto__ 시트를 없는 것으로 본다', () => {
    const read = readWorkbookWithSheetName('__proto__');
    expect(read.Sheets['__proto__']).toBeTruthy(); // raw 조회는 성공
    expect(getSheet(read, '__proto__')).toBeUndefined(); // own 키가 아니다
  });

  it('평범한 시트는 정상적으로 찾는다', () => {
    const read = readWorkbookWithSheetName('Sheet1');
    expect(getSheet(read, 'Sheet1')).toBeTruthy();
    expect(getSheet(read, '없는시트')).toBeUndefined();
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
