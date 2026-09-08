import * as XLSX from 'xlsx';
import type { Parcel, ColumnMapping, ParcelCategory } from '../types';
import { parseLotNumber, buildParcelId, parseSido } from './addressParser';
import { newRowUid } from './parcelKey';

/**
 * 엑셀 파일에서 시트명 목록 추출
 */
export function getSheetNames(file: File): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        resolve(workbook.SheetNames);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

/**
 * 시트별 행 수를 미리 조회 (시트 선택 UI에서 보조 시트를 걸러내기 위함)
 */
export function getSheetRowCounts(file: File): Promise<Record<string, number>> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', codepage: 949 });
        const counts: Record<string, number> = {};
        for (const name of workbook.SheetNames) {
          // !ref 로 대략적인 행 수만 센다 (전 시트를 JSON으로 펼치면 느리다)
          const ref = workbook.Sheets[name]?.['!ref'];
          const range = ref ? XLSX.utils.decode_range(ref) : null;
          // 헤더 1행 제외
          counts[name] = range ? Math.max(0, range.e.r - range.s.r) : 0;
        }
        resolve(counts);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

/**
 * 여러 시트를 하나의 데이터셋으로 합쳐서 파싱
 * - 시트마다 헤더가 다를 수 있으므로 헤더 합집합을 취하고, 없는 컬럼은 빈 값으로 채운다
 * - 각 행에 출처 시트를 기록한다 (__sheet)
 */
export function parseExcelSheets(
  file: File,
  sheetNames: string[]
): Promise<{ headers: string[]; rows: Record<string, unknown>[]; perSheet: Record<string, number> }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', codepage: 949 });

        const headerOrder: string[] = [];
        const headerSet = new Set<string>();
        const rowsBySheet: Array<{ name: string; rows: Record<string, unknown>[] }> = [];
        const perSheet: Record<string, number> = {};

        for (const name of sheetNames) {
          const sheet = workbook.Sheets[name];
          if (!sheet) {
            reject(new Error(`시트를 찾을 수 없습니다: ${name}`));
            return;
          }

          const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
            defval: '',
            raw: false,
          });
          const filtered = jsonData.filter(row =>
            Object.values(row).some(v => v !== '' && v != null)
          );

          // 헤더 합집합 — 등장 순서를 유지한다
          if (filtered.length > 0) {
            for (const key of Object.keys(filtered[0])) {
              if (!headerSet.has(key)) {
                headerSet.add(key);
                headerOrder.push(key);
              }
            }
          }

          rowsBySheet.push({ name, rows: filtered });
          perSheet[name] = filtered.length;
        }

        // 출처 시트를 기록할 내부 키. 원본에 같은 이름의 컬럼이 있으면
        // 그 값을 덮어쓰게 되므로 충돌하지 않는 이름을 고른다.
        let sheetKey = '__sheet';
        while (headerSet.has(sheetKey)) sheetKey += '_';

        const allRows: Record<string, unknown>[] = [];
        for (const { name, rows } of rowsBySheet) {
          for (const row of rows) {
            // 한쪽 시트에만 있는 컬럼은 빈 값으로 채워 행 구조를 균일하게 맞춘다
            const merged: Record<string, unknown> = { ...row, [sheetKey]: name };
            for (const h of headerOrder) {
              if (!(h in merged)) merged[h] = '';
            }
            allRows.push(merged);
          }
        }

        resolve({ headers: headerOrder, rows: allRows, perSheet });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

/**
 * 컬럼 매핑을 적용하여 raw 데이터를 Parcel 배열로 변환
 */
export function applyColumnMapping(
  rows: Record<string, unknown>[],
  mapping: ColumnMapping,
  fileSource: string,
  year?: number,
  category: ParcelCategory = 'public-payment'
): Parcel[] {
  const parcels = rows.map(row => {
    let address = mapping.address ? String(row[mapping.address] ?? '').trim() : '';

    // 필지주소가 비어있으면 분리된 주소 컬럼에서 조립
    if (!address) {
      const parts: string[] = [];
      if (mapping.sido) {
        const v = String(row[mapping.sido] ?? '').trim();
        if (v) parts.push(v);
      }
      if (mapping.sigungu) {
        const v = String(row[mapping.sigungu] ?? '').trim();
        if (v) parts.push(v);
      }
      if (mapping.eubmyeondong) {
        const v = String(row[mapping.eubmyeondong] ?? '').trim();
        if (v) parts.push(v);
      }
      if (mapping.ri) {
        const v = String(row[mapping.ri] ?? '').trim();
        if (v) parts.push(v);
      }
      // 지번 추가 — 본번/부번이 분리돼 있으면 결합하고, 통합 필지번호면 그대로 쓴다.
      // 지번이 빠지면 조립 주소가 리(里)에서 끝나 지오코딩이 리 중심점을 찍는다.
      const mainNum = mapping.mainLotNum ? String(row[mapping.mainLotNum] ?? '').trim() : '';
      const subNum = mapping.subLotNum ? String(row[mapping.subLotNum] ?? '').trim() : '';
      if (mainNum) {
        const lotStr = subNum && subNum !== '0' ? `${mainNum}-${subNum}` : mainNum;
        parts.push(lotStr);
      } else if (mapping.parcelId) {
        const lot = String(row[mapping.parcelId] ?? '').trim();
        if (lot) parts.push(lot);
      }
      address = parts.join(' ');
    }
    const farmerAddress = mapping.farmerAddress ? String(row[mapping.farmerAddress] ?? '') : '';
    const riRaw = mapping.ri ? String(row[mapping.ri] ?? '').trim() : '';
    const ri = riRaw || parseRiFromAddress(address);

    // 필지번호: 통합(single) 또는 본번+부번 분리(split)
    let parcelId: string;
    if (mapping.parcelIdMode === 'split' && mapping.mainLotNum) {
      // 2024/2025 기채취 파일: 본번·부번 별도 컬럼 결합
      const mainNum = normalizeId(String(row[mapping.mainLotNum] ?? ''));
      const subNum = mapping.subLotNum ? normalizeId(String(row[mapping.subLotNum] ?? '')) : '';
      parcelId = buildParcelId(mainNum, subNum);
    } else if (mapping.parcelId) {
      // 마스터 파일: 필지번호 컬럼 직접 사용
      parcelId = normalizeId(String(row[mapping.parcelId] ?? ''));
    } else {
      // 필지번호 컬럼 없음: 주소에서 본번/부번 자동 추출
      const { mainLotNum, subLotNum } = parseLotNumber(address);
      parcelId = buildParcelId(mainLotNum, subLotNum);
    }

    // 본번/부번 분리 저장 (흙토람용)
    let mainLotNum: string;
    let subLotNum: string;
    if (mapping.parcelIdMode === 'split' && mapping.mainLotNum) {
      mainLotNum = normalizeId(String(row[mapping.mainLotNum] ?? ''));
      subLotNum = mapping.subLotNum ? normalizeId(String(row[mapping.subLotNum] ?? '')) : '';
    } else {
      // 주소 또는 통합 필지번호에서 추출
      const lotFromAddr = parseLotNumber(address);
      const lotFromId = parcelId.match(/^(산?\d+)(?:-(\d+))?$/);
      if (lotFromId) {
        mainLotNum = lotFromId[1];
        subLotNum = lotFromId[2] ?? '';
      } else {
        mainLotNum = lotFromAddr.mainLotNum;
        subLotNum = lotFromAddr.subLotNum;
      }
    }

    return {
      rowUid: newRowUid(),
      farmerId: normalizeId(String(row[mapping.farmerId] ?? '')),
      farmerName: mapping.farmerName ? String(row[mapping.farmerName] ?? '') : '',
      parcelId,
      mainLotNum,
      subLotNum,
      address,
      farmerAddress,
      sido: mapping.sido ? String(row[mapping.sido] ?? '') : parseSido(address),
      ri,
      sigungu: mapping.sigungu ? String(row[mapping.sigungu] ?? '') : parseSigunguFromAddress(address),
      eubmyeondong: mapping.eubmyeondong ? String(row[mapping.eubmyeondong] ?? '') : parseEubmyeondongFromAddress(address),
      cropType: mapping.cropType ? String(row[mapping.cropType] ?? '') : undefined,
      landCategoryOfficial: mapping.landCategoryOfficial ? String(row[mapping.landCategoryOfficial] ?? '').trim() : undefined,
      landCategoryActual: mapping.landCategoryActual ? String(row[mapping.landCategoryActual] ?? '').trim() : undefined,
      area: mapping.area ? parseArea(row[mapping.area]) : undefined,
      pnu: extractPnu(row, mapping),
      sampledYears: year ? [year] : [],
      isEligible: true,
      isSelected: false,
      fileSource,
      rawData: row,
      parcelCategory: category,
    };
  }).filter(p => p.farmerId || p.parcelId || p.address);

  // 순번(1,2,3...) 감지: parcelId가 행번호이면 주소에서 재추출
  if (parcels.length >= 5 && mapping.parcelIdMode !== 'split') {
    const sampleSize = Math.min(20, parcels.length);
    let sequentialCount = 0;
    for (let i = 0; i < sampleSize; i++) {
      const num = parseInt(parcels[i].parcelId, 10);
      if (!isNaN(num) && num === i + 1) sequentialCount++;
    }
    if (sequentialCount >= sampleSize * 0.8) {
      console.warn(
        `[excelParser] parcelId가 순번(1,2,3...)으로 감지됨 → 주소에서 필지번호 재추출 (${parcels.length}건)`
      );
      for (const p of parcels) {
        const { mainLotNum, subLotNum } = parseLotNumber(p.address);
        p.parcelId = buildParcelId(mainLotNum, subLotNum);
        p.mainLotNum = mainLotNum;
        p.subLotNum = subLotNum;
      }
    }
  }

  return parcels;
}

// 간단한 주소 파싱 헬퍼
function parseRiFromAddress(address: string): string {
  const riMatch = address.match(/([가-힣]+리)(?:\s|$)/);
  if (riMatch) return riMatch[1];
  const dongMatch = address.match(/([가-힣]+[동읍면])(?:\s|$)/);
  return dongMatch ? dongMatch[1] : '미분류';
}

function parseSigunguFromAddress(address: string): string {
  const match = address.match(/([가-힣]+[시군구])\s/);
  return match ? match[1] : '';
}

function parseEubmyeondongFromAddress(address: string): string {
  const match = address.match(/([가-힣]+[읍면동])\s/);
  return match ? match[1] : '';
}

// PNU 코드 추출: 매핑된 컬럼 → rawData 자동 감지
// 실사용 파일의 PNU 컬럼명: 2027원본은 `PNU`, 2026 토양검정은 `BASEPNU`.
// 예전에는 대소문자 구분 정확 매칭이라 `pnu`와 `PNU`를 따로 나열해야 했고,
// 그러고도 `BASEPNU`는 목록에 없어 자동 감지가 실패했다.
// 순서가 우선순위다. 다중 시트를 합쳐 2027 시트(`PNU`)와 2026 시트(`BASEPNU`)가
// 함께 로드되면 두 헤더가 공존하므로, 정본인 `pnu`가 앞에 와야 한다.
const PNU_COLUMN_NAMES = ['직불신청_pnu', 'pnu코드', 'pnu', 'basepnu', '필지고유번호'];

/** 컬럼명 비교용 정규화 (대소문자·공백·밑줄 무시) */
function normalizeColumnName(name: string): string {
  return name.toLowerCase().replace(/[\s_]/g, '');
}

/**
 * 면적 파싱.
 *
 * `sheet_to_json(..., { raw: false })`는 서식이 적용된 문자열을 준다.
 * 셀에 천단위 구분자가 걸려 있으면 `"1,234"`가 넘어오고 `parseFloat`는 1을 준다.
 * 실사용 파일 두 개(2027원본·2026 토양검정)에서는 구분자가 관측되지 않았지만,
 * 걸리면 MIN_AREA(500㎡) 필터가 정상 필지를 대량으로 걷어내므로 미리 막는다.
 *
 * 0은 예전처럼 undefined로 둔다. "면적 0"과 "면적 정보 없음"을 뭉개는 것은 분명
 * 결함이지만, 0을 살리면 이 함수 밖이 함께 바뀐다 — `excelExporter`가
 * `p.area != null`로 rawData 폴백을 막고, `extractionStore`가 `area == null`
 * 조건으로 하던 마스터 면적 상속을 건너뛴다. 2027 파일에 실제로 0값이 63건 있어
 * 납품 시트에 0이 찍히는 회귀가 된다.
 *
 * 0을 부적격으로 볼지 정보 없음으로 볼지는 업무 결정이고, 소비 지점 두 곳을 함께
 * 손봐야 한다. 이번 변경(쉼표 방어)에 섞지 않고 후속으로 남긴다.
 */
function parseArea(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = parseNumericCell(value);
  return Number.isFinite(n) ? n || undefined : undefined;
}

/**
 * 서식이 걸린 숫자 셀을 파싱한다.
 *
 * 면적을 읽는 곳이 셋(여기, `getParcelArea`의 rawData 폴백, 납품 시트의
 * `getRawNum`)이라 한 곳만 고치면 나머지가 다른 숫자를 낸다. 한 군데로 모은다.
 */
export function parseNumericCell(value: unknown): number {
  return parseFloat(String(value ?? '').replace(/,/g, ''));
}

function extractPnu(row: Record<string, unknown>, mapping: ColumnMapping): string | undefined {
  // 1. 명시적 매핑
  if (mapping.pnu) {
    const v = String(row[mapping.pnu] ?? '').trim();
    if (v) return v;
  }
  // 2. rawData에서 자동 감지 (대소문자·공백·밑줄 무시)
  // 빈 값이 유효 값을 덮지 않게 한다. 다중 시트를 합칠 때 헤더 합집합을 채우느라
  // 없는 컬럼에 '' 를 넣는데(위 parseExcelSheets), 시트마다 표기가 달라
  // `{PNU:'479…', pnu:''}` 같은 행이 만들어진다. 무조건 덮어쓰면 그 행의 PNU가
  // 통째로 사라져 이 함수가 고치려던 증상이 그대로 재발한다.
  const normalizedRow = new Map<string, unknown>();
  for (const key of Object.keys(row)) {
    const nk = normalizeColumnName(key);
    const prev = normalizedRow.get(nk);
    if (prev == null || String(prev).trim() === '') {
      normalizedRow.set(nk, row[key]);
    }
  }
  for (const col of PNU_COLUMN_NAMES) {
    const v = normalizedRow.get(normalizeColumnName(col));
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return undefined;
}

function normalizeId(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) return '';
  const stripped = trimmed.replace(/^0+/, '');
  // 전부 0이면 '0' 반환 (예: "00" → "0", "000" → "0")
  return stripped || '0';
}
