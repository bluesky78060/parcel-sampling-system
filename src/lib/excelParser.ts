import * as XLSX from 'xlsx';
import type { Parcel, ColumnMapping } from '../types';
import { parseLotNumber, buildParcelId, parseSido } from './addressParser';

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
 * 엑셀 파일에서 특정 시트의 데이터를 파싱
 * - 헤더 자동 감지
 * - 빈 행 필터링
 * - EUC-KR 인코딩 대응 (codepage 옵션)
 */
export function parseExcelFile(
  file: File,
  sheetName?: string
): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', codepage: 949 });
        const sheet = workbook.Sheets[sheetName ?? workbook.SheetNames[0]];

        if (!sheet) {
          reject(new Error(`시트를 찾을 수 없습니다: ${sheetName}`));
          return;
        }

        const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
          defval: '',
          raw: false,
        });

        // 빈 행 필터링
        const filtered = jsonData.filter(row =>
          Object.values(row).some(v => v !== '' && v != null)
        );

        const headers = filtered.length > 0 ? Object.keys(filtered[0]) : [];

        resolve({ headers, rows: filtered });
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
  year?: number
): Parcel[] {
  return rows.map(row => {
    const address = String(row[mapping.address] ?? '');
    const ri = mapping.ri ? String(row[mapping.ri] ?? '') : parseRiFromAddress(address);

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
      farmerId: normalizeId(String(row[mapping.farmerId] ?? '')),
      farmerName: mapping.farmerName ? String(row[mapping.farmerName] ?? '') : '',
      parcelId,
      mainLotNum,
      subLotNum,
      address,
      sido: mapping.sido ? String(row[mapping.sido] ?? '') : parseSido(address),
      ri,
      sigungu: mapping.sigungu ? String(row[mapping.sigungu] ?? '') : parseSigunguFromAddress(address),
      eubmyeondong: mapping.eubmyeondong ? String(row[mapping.eubmyeondong] ?? '') : parseEubmyeondongFromAddress(address),
      cropType: mapping.cropType ? String(row[mapping.cropType] ?? '') : undefined,
      area: mapping.area ? parseFloat(String(row[mapping.area] ?? '0')) || undefined : undefined,
      sampledYears: year ? [year] : [],
      isEligible: true,
      isSelected: false,
      fileSource,
    };
  }).filter(p => p.farmerId || p.parcelId || p.address);
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

function normalizeId(id: string): string {
  return id.trim().replace(/^0+/, '') || id.trim();
}
