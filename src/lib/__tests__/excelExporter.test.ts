import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildWorkbook } from '../excelExporter';
import { makeParcel } from './factories';
import type { Parcel } from '../../types';

/**
 * **산출물 조립 계층에 테스트가 하나도 없었다.**
 *
 * PROJ1-1-41의 헤드라인 주장은 "공익직불제 시트의 행 수"인데, 그것을 스토어 쪽
 * `rows.filter(isPublicPayment).length`라는 **대리 지표로만** 고정하고 있었다.
 * 리뷰가 실측한 결과 시트 조립 자체는 무보호였다 — 시트 필터를 `true`로 바꿔도,
 * `중복여부`를 전멸시켜도, `구분`을 상수로 만들어도 291건이 전부 통과했다.
 *
 * 여기서 실제 워크북을 만들어 센다.
 */

const SURVEY_YEAR = 2026;

/** 시트의 데이터 행 수 (헤더 제외) */
function rowCount(wb: XLSX.WorkBook, sheetName: string): number {
  const ws = wb.Sheets[sheetName];
  if (!ws) return 0;
  return XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false }).length - 1;
}

function cellsOf(wb: XLSX.WorkBook, sheetName: string): string[][] {
  const ws = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, blankrows: false, defval: '' });
}

function build(selected: Parcel[]) {
  return buildWorkbook(
    {
      selectedParcels: selected,
      representativeParcels: [],
      excludedParcels: [],
      allParcels: selected,
      riStats: [],
      farmerStats: [],
    },
    SURVEY_YEAR,
  );
}

/** 공익직불제 전용 (번호 있음, 대표필지 아님) */
const pub = (over = {}) =>
  makeParcel({ farmerId: 'F_P', pnu: 'PNU_PUB', parcelCategory: 'public-payment', ...over });
/** 혼용 — 경영체번호가 있는 대표필지 */
const both = (over = {}) =>
  makeParcel({ farmerId: 'F_B', pnu: 'PNU_BOTH', parcelCategory: 'both', ...over });
/** 대표필지 전용 (경영체번호 없음) */
const repOnly = (over = {}) =>
  makeParcel({ farmerId: '', pnu: 'PNU_REP', parcelCategory: 'representative', ...over });

describe('buildWorkbook — 시트 분리', () => {
  it('공익직불제 시트에는 공익 전용과 혼용만 실린다', () => {
    const wb = build([pub(), both(), repOnly()]);
    expect(rowCount(wb, `${SURVEY_YEAR}_필지선정`)).toBe(2);
  });

  it('대표필지 시트에는 대표 전용과 혼용만 실린다', () => {
    const wb = build([pub(), both(), repOnly()]);
    expect(rowCount(wb, '대표필지')).toBe(2);
  });

  /**
   * 혼용 필지는 **두 시트에 모두** 실린다. 그래서 두 시트를 합치는 사람이
   * 이중 계상하지 않도록 `중복여부`에 O를 찍는다.
   */
  it('혼용 필지는 양쪽 시트에 실리고 중복여부에 O가 찍힌다', () => {
    const wb = build([pub(), both()]);
    const sheet1 = cellsOf(wb, `${SURVEY_YEAR}_필지선정`);
    const dupCol = sheet1[0].indexOf('중복여부');
    expect(dupCol).toBeGreaterThanOrEqual(0);
    const marked = sheet1.slice(1).filter((r) => r[dupCol] === 'O');
    expect(marked).toHaveLength(1);
    // 대표필지 시트에도 같은 행이 O로 찍힌다
    const sheet2 = cellsOf(wb, '대표필지');
    expect(sheet2.slice(1).filter((r) => r[dupCol] === 'O')).toHaveLength(1);
  });

  it('공익 전용 필지에는 중복여부가 비어 있다', () => {
    const wb = build([pub()]);
    const sheet1 = cellsOf(wb, `${SURVEY_YEAR}_필지선정`);
    const dupCol = sheet1[0].indexOf('중복여부');
    expect(sheet1[1][dupCol]).toBe('');
  });

  it('대표필지가 없으면 대표필지 시트를 만들지 않는다', () => {
    const wb = build([pub()]);
    expect(wb.SheetNames).not.toContain('대표필지');
  });

  /**
   * PROJ1-1-41의 핵심 주장. 경영체번호가 있는 대표필지를 `'representative'`로
   * 덮어쓰면 여기서 사라진다 — 제출 파일의 행 수가 조용히 줄어든다.
   */
  it('경영체번호가 있는 대표필지를 공익직불제 시트에서 빠뜨리지 않는다', () => {
    const wb = build([pub(), both(), both({ pnu: 'PNU_BOTH2' })]);
    expect(rowCount(wb, `${SURVEY_YEAR}_필지선정`)).toBe(3);
    expect(rowCount(wb, '대표필지')).toBe(2);
  });
});

describe('buildWorkbook — 전체필지 시트의 구분 컬럼', () => {
  it('세 분류를 각각 다르게 적는다', () => {
    const wb = build([pub(), both(), repOnly()]);
    const rows = cellsOf(wb, '전체필지');
    const col = rows[0].indexOf('구분');
    const labels = rows.slice(1).map((r) => r[col]);
    expect(labels).toContain('공익직불제');
    expect(labels).toContain('공익직불제·대표필지');
    expect(labels).toContain('대표필지');
  });
});

describe('buildWorkbook — 시트명이 조사 연도를 따른다', () => {
  it('연도가 바뀌면 시트명도 바뀐다', () => {
    const wb = buildWorkbook(
      {
        selectedParcels: [pub()],
        representativeParcels: [],
        excludedParcels: [],
        allParcels: [pub()],
        riStats: [],
        farmerStats: [],
      },
      2030,
    );
    expect(wb.SheetNames).toContain('2030_필지선정');
    expect(wb.SheetNames).not.toContain('2026_필지선정');
  });
});
