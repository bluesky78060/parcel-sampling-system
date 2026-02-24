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

  // 시트 1: 2026 추출 필지
  const selectedSheet = createSelectedSheet(data.selectedParcels);
  XLSX.utils.book_append_sheet(wb, selectedSheet, '2026_추출필지');

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
  saveAs(blob, `2026_필지추출결과_${now}.xlsx`);
}

function createSelectedSheet(parcels: Parcel[]): XLSX.WorkSheet {
  const rows = parcels.map((p, i) => ({
    '번호': i + 1,
    '농가번호': p.farmerId,
    '농가명': p.farmerName,
    '시도': p.sido,
    '시군구': p.sigungu,
    '읍면동': p.eubmyeondong,
    '리': p.ri,
    '본번': p.mainLotNum,
    '부번': p.subLotNum,
    '필지번호': p.parcelId,
    '주소': p.address,
    '면적(㎡)': p.area ?? '',
    '작물': p.cropType ?? '',
    '위도': p.coords?.lat ?? '',
    '경도': p.coords?.lng ?? '',
  }));
  return XLSX.utils.json_to_sheet(rows);
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
    '농가번호': s.farmerId,
    '농가명': s.farmerName,
    '전체 필지': s.totalParcels,
    '선택 필지': s.selectedParcels,
  }));
  return XLSX.utils.json_to_sheet(rows);
}

function createExcludedSheet(parcels: Parcel[]): XLSX.WorkSheet {
  const rows = parcels.map(p => ({
    '농가번호': p.farmerId,
    '농가명': p.farmerName,
    '필지번호': p.parcelId,
    '주소': p.address,
    '리(里)': p.ri,
    '채취연도': p.sampledYears.join(', '),
  }));
  return XLSX.utils.json_to_sheet(rows);
}

function createAllParcelsSheet(parcels: Parcel[]): XLSX.WorkSheet {
  const rows = parcels.map(p => ({
    '농가번호': p.farmerId,
    '농가명': p.farmerName,
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
