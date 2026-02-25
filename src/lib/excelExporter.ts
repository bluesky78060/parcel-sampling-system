import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import type { Parcel, RiStat, FarmerStat } from '../types';

interface ExportData {
  selectedParcels: Parcel[];
  excludedParcels: Parcel[];
  allParcels: Parcel[];
  riStats: RiStat[];
  farmerStats: FarmerStat[];
}

/**
 * 추출 결과를 다중 시트 엑셀 파일로 내보내기
 */
export function exportToExcel(data: ExportData): void {
  const wb = XLSX.utils.book_new();

  // 시트 1: 2026 필지선정 (2024 공익직불제 포맷)
  const selectedSheet = createSelectedSheet(data.selectedParcels);
  XLSX.utils.book_append_sheet(wb, selectedSheet, '2026_필지선정');

  // 시트 2: 리별 통계
  const riSheet = createRiStatsSheet(data.riStats);
  XLSX.utils.book_append_sheet(wb, riSheet, '리별_통계');

  // 시트 3: 농가별 통계
  const farmerSheet = createFarmerStatsSheet(data.farmerStats);
  XLSX.utils.book_append_sheet(wb, farmerSheet, '농가별_통계');

  // 시트 4: 제외 필지
  const excludedSheet = createExcludedSheet(data.excludedParcels);
  XLSX.utils.book_append_sheet(wb, excludedSheet, '제외필지');

  // 시트 5: 전체 필지
  const allSheet = createAllParcelsSheet(data.allParcels);
  XLSX.utils.book_append_sheet(wb, allSheet, '전체필지');

  // 다운로드
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  const blob = new Blob([wbout], { type: 'application/octet-stream' });
  const now = new Date().toISOString().slice(0, 10);
  saveAs(blob, `2026공익직불제(필지선정)_${now}.xlsx`);
}

// rawData에서 원본 컬럼값을 찾는 헬퍼 (여러 후보 컬럼명 지원)
function getRaw(p: Parcel, ...keys: string[]): string {
  if (!p.rawData) return '';
  for (const k of keys) {
    const v = p.rawData[k];
    if (v != null && v !== '') return String(v);
  }
  return '';
}

function createSelectedSheet(parcels: Parcel[]): XLSX.WorkSheet {
  const headers = [
    '경영체번호', '경영체명', '경영체 주소', '0유선전화번호', '0무선전화번호',
    '필지주소', '시도', '시군구', '읍면', '리동', '본번', '부번',
    '공부지목', '실지목', '노지재배면적', '시설재배면적', '품목코드',
    '위도', '경도',
  ];

  const dataRows = parcels.map(p => [
    p.farmerId,                                              // 경영체번호 (A)
    p.farmerName,                                            // 경영체명 (B)
    p.farmerAddress || p.address,                              // 경영체 주소 (C)
    getRaw(p, '0유선전화번호', '유선전화번호', '전화번호'),      // 0유선전화번호 (D)
    getRaw(p, '0무선전화번호', '무선전화번호', '휴대폰'),        // 0무선전화번호 (E)
    p.address,                                               // 필지주소 (F)
    p.sido,                                                  // 시도 (G)
    p.sigungu,                                               // 시군구 (H)
    p.eubmyeondong,                                          // 읍면 (I)
    p.ri,                                                    // 리동 (J)
    p.mainLotNum,                                            // 본번 (K)
    p.subLotNum,                                             // 부번 (L)
    getRaw(p, '공부지목', '지목'),                             // 공부지목 (M)
    getRaw(p, '실지목'),                                      // 실지목 (N)
    p.area ?? '',                                            // 노지재배면적 (O)
    getRaw(p, '시설재배면적'),                                 // 시설재배면적 (P)
    p.cropType ?? getRaw(p, '품목코드'),                       // 품목코드 (Q)
    p.coords?.lat ?? '',                                     // 위도 (R)
    p.coords?.lng ?? '',                                     // 경도 (S)
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);

  // 열 너비 설정 (2024 원본 포맷 기준 + 좌표 컬럼)
  ws['!cols'] = [
    { wch: 11.66 }, // A: 경영체번호
    { wch: 9 },     // B: 경영체명
    { wch: 59.16 }, // C: 경영체 주소
    { wch: 14.16 }, // D: 0유선전화번호
    { wch: 14.16 }, // E: 0무선전화번호
    { wch: 35.66 }, // F: 필지주소
    { wch: 8.43 },  // G: 시도
    { wch: 7.16 },  // H: 시군구
    { wch: 8.43 },  // I: 읍면
    { wch: 8.43 },  // J: 리동
    { wch: 6.16 },  // K: 본번
    { wch: 7.16 },  // L: 부번
    { wch: 9 },     // M: 공부지목
    { wch: 7.16 },  // N: 실지목
    { wch: 13 },    // O: 노지재배면적
    { wch: 13 },    // P: 시설재배면적
    { wch: 9 },     // Q: 품목코드
    { wch: 12 },    // R: 위도
    { wch: 12 },    // S: 경도
  ];

  return ws;
}

function createRiStatsSheet(stats: RiStat[]): XLSX.WorkSheet {
  const rows = stats.map(s => ({
    '리(里)': s.ri,
    '전체 필지': s.totalCount,
    '추출 가능': s.eligibleCount,
    '추출 목표': s.targetCount,
    '실제 추출': s.selectedCount,
    '달성률(%)': s.targetCount > 0 ? Math.round((s.selectedCount / s.targetCount) * 100) : 0,
  }));
  return XLSX.utils.json_to_sheet(rows);
}

function createFarmerStatsSheet(stats: FarmerStat[]): XLSX.WorkSheet {
  const rows = stats.map(s => ({
    '경영체번호': s.farmerId,
    '경영체명': s.farmerName,
    '전체 필지': s.totalParcels,
    '선택 필지': s.selectedParcels,
  }));
  return XLSX.utils.json_to_sheet(rows);
}

function createExcludedSheet(parcels: Parcel[]): XLSX.WorkSheet {
  const rows = parcels.map(p => ({
    '경영체번호': p.farmerId,
    '경영체명': p.farmerName,
    '필지번호': p.parcelId,
    '주소': p.address,
    '리(里)': p.ri,
    '채취연도': p.sampledYears.join(', '),
  }));
  return XLSX.utils.json_to_sheet(rows);
}

function createAllParcelsSheet(parcels: Parcel[]): XLSX.WorkSheet {
  const rows = parcels.map(p => ({
    '경영체번호': p.farmerId,
    '경영체명': p.farmerName,
    '시도': p.sido,
    '시군구': p.sigungu,
    '읍면동': p.eubmyeondong,
    '리': p.ri,
    '본번': p.mainLotNum,
    '부번': p.subLotNum,
    '필지번호': p.parcelId,
    '주소': p.address,
    '면적(㎡)': p.area ?? '',
    '채취이력': p.sampledYears.join(', ') || '없음',
    '추출가능': p.isEligible ? 'O' : 'X',
    '2026선택': p.isSelected ? 'O' : 'X',
    '위도': p.coords?.lat ?? '',
    '경도': p.coords?.lng ?? '',
  }));
  return XLSX.utils.json_to_sheet(rows);
}
