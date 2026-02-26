import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import type { Parcel, RiStat, FarmerStat } from '../types';

interface ExportData {
  selectedParcels: Parcel[];
  representativeParcels: Parcel[];
  excludedParcels: Parcel[];
  allParcels: Parcel[];
  riStats: RiStat[];
  farmerStats: FarmerStat[];
  duplicateKeys?: Set<string>;  // 공익직불제 ↔ 대표필지 중복 키
}

/**
 * 추출 결과를 다중 시트 엑셀 파일로 내보내기
 */
export function exportToExcel(data: ExportData): void {
  // 디버그: rawData 컬럼명만 출력 (개인정보 제외)
  const sampleParcel = data.selectedParcels[0] ?? data.allParcels[0];
  if (sampleParcel?.rawData) {
    console.info('[엑셀내보내기] rawData 컬럼명:', Object.keys(sampleParcel.rawData));
  } else {
    console.warn('[엑셀내보내기] rawData가 없습니다! 전화번호/면적/품목코드가 비어있을 수 있습니다.');
  }

  const wb = XLSX.utils.book_new();
  const dupKeys = data.duplicateKeys ?? new Set<string>();

  // 시트 1: 공익직불제 필지선정 (대표필지 제외)
  const publicPaymentParcels = data.selectedParcels.filter(
    (p) => (p.parcelCategory ?? 'public-payment') !== 'representative'
  );
  const selectedSheet = createSelectedSheet(publicPaymentParcels, dupKeys);
  XLSX.utils.book_append_sheet(wb, selectedSheet, '2026_필지선정');

  // 시트 2: 대표필지 (별도 시트, 동일 포맷)
  const repParcels = data.selectedParcels.filter(
    (p) => (p.parcelCategory ?? 'public-payment') === 'representative'
  );
  if (repParcels.length > 0) {
    const repSheet = createSelectedSheet(repParcels, dupKeys);
    XLSX.utils.book_append_sheet(wb, repSheet, '대표필지');
  }

  // 시트 3: 리별 통계
  const riSheet = createRiStatsSheet(data.riStats);
  XLSX.utils.book_append_sheet(wb, riSheet, '리별_통계');

  // 시트 4: 농가별 통계
  const farmerSheet = createFarmerStatsSheet(data.farmerStats);
  XLSX.utils.book_append_sheet(wb, farmerSheet, '농가별_통계');

  // 시트 5: 제외 필지
  const excludedSheet = createExcludedSheet(data.excludedParcels);
  XLSX.utils.book_append_sheet(wb, excludedSheet, '제외필지');

  // 시트 6: 전체 필지 (구분 컬럼 포함)
  const allWithRep = [...data.allParcels, ...data.representativeParcels];
  const allSheet = createAllParcelsSheet(allWithRep);
  XLSX.utils.book_append_sheet(wb, allSheet, '전체필지');

  // 다운로드
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  const blob = new Blob([wbout], { type: 'application/octet-stream' });
  const now = new Date().toISOString().slice(0, 10);
  saveAs(blob, `2026필지선정(공익직불제+대표필지)_${now}.xlsx`);
}

/**
 * rawData에서 원본 컬럼값을 찾는 헬퍼
 * 1) 정확 매칭 우선
 * 2) 공백 제거 후 매칭
 * 3) 부분 포함 매칭 (키워드가 컬럼명에 포함)
 */
function getRaw(p: Parcel, ...keys: string[]): string {
  if (!p.rawData) return '';
  const rawKeys = Object.keys(p.rawData);
  const norm = (s: string) => s.replace(/\s/g, '');

  // 1차: 정확 매칭
  for (const k of keys) {
    const v = p.rawData[k];
    if (v != null && v !== '') return String(v);
  }

  // 2차: 공백 제거 매칭
  for (const k of keys) {
    const nk = norm(k);
    for (const rk of rawKeys) {
      if (norm(rk) === nk) {
        const v = p.rawData[rk];
        if (v != null && v !== '') return String(v);
      }
    }
  }

  // 3차: 부분 포함 매칭 (키워드가 rawData 컬럼명에 포함 — 단방향, 최소 2글자)
  for (const k of keys) {
    const nk = norm(k);
    if (nk.length < 2) continue;
    for (const rk of rawKeys) {
      if (norm(rk).includes(nk)) {
        const v = p.rawData[rk];
        if (v != null && v !== '') return String(v);
      }
    }
  }

  return '';
}

/** rawData에서 숫자값 파싱 (빈 값이면 0) */
function getRawNum(p: Parcel, ...keys: string[]): number {
  const v = getRaw(p, ...keys);
  if (!v) return 0;
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function getParcelKey(p: Parcel): string {
  return p.pnu || `${p.address}__${p.parcelId}`;
}

function createSelectedSheet(parcels: Parcel[], duplicateKeys: Set<string> = new Set()): XLSX.WorkSheet {
  // 첫 컬럼: 중복여부, 이후 원본 파일 컬럼 기준
  const headers = [
    '중복여부',
    '직불신청_경영체번호', '직불신청_PNU', '경영체명', '경영체주소',
    '필지주소', '읍면', '리동', '본번', '부번',
    '전화번호', '휴대전화번호',
    '공부지목', '실제지목', '재배면적(노지+시설)',
    '품목코드', '품목명_대분류명', '품목명_중분류명', '품목명_소분류명',
    '위도', '경도',
  ];

  const dataRows = parcels.map(p => {
    const key = getParcelKey(p);
    const isDup = duplicateKeys.has(key) ? 'O' : '';
    return [
      isDup,                                                                       // 중복여부
      p.farmerId,                                                                  // 직불신청_경영체번호
      p.pnu || getRaw(p, '직불신청_PNU', 'pnu', 'PNU'),                             // 직불신청_PNU
      p.farmerName,                                                                // 경영체명
      p.farmerAddress || getRaw(p, '경영체주소', '경영체 주소', '농가주소', '주소지'),     // 경영체주소
      p.address,                                                                   // 필지주소
      p.eubmyeondong || getRaw(p, '읍면'),                                          // 읍면
      p.ri || getRaw(p, '리동'),                                                    // 리동
      p.mainLotNum || getRaw(p, '본번'),                                            // 본번
      p.subLotNum || getRaw(p, '부번'),                                             // 부번
      getRaw(p, '전화번호', '유선전화번호', '0유선전화번호'),                           // 전화번호
      getRaw(p, '휴대전화번호', '무선전화번호', '0무선전화번호', '휴대폰'),              // 휴대전화번호
      p.landCategoryOfficial || getRaw(p, '공부지목', '지목'),                        // 공부지목
      p.landCategoryActual || getRaw(p, '실제지목', '실지목'),                        // 실제지목
      p.area != null ? p.area : (getRawNum(p, '재배면적(노지+시설)', '재배면적', '노지재배면적') || ''), // 재배면적(노지+시설)
      p.cropType || getRaw(p, '품목코드'),                                           // 품목코드
      getRaw(p, '품목명_대분류명'),                                                  // 품목명_대분류명
      getRaw(p, '품목명_중분류명'),                                                  // 품목명_중분류명
      getRaw(p, '품목명_소분류명', '품목명', '품목', '작물명'),                         // 품목명_소분류명
      p.coords?.lat ?? '',                                                         // 위도
      p.coords?.lng ?? '',                                                         // 경도
    ];
  });

  const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);

  ws['!cols'] = [
    { wch: 8 },     // A: 중복여부
    { wch: 16 },    // B: 직불신청_경영체번호
    { wch: 22 },    // C: 직불신청_PNU
    { wch: 9 },     // D: 경영체명
    { wch: 40 },    // E: 경영체주소
    { wch: 40 },    // F: 필지주소
    { wch: 8.43 },  // G: 읍면
    { wch: 8.43 },  // H: 리동
    { wch: 6.16 },  // I: 본번
    { wch: 6.16 },  // J: 부번
    { wch: 14 },    // K: 전화번호
    { wch: 14 },    // L: 휴대전화번호
    { wch: 9 },     // M: 공부지목
    { wch: 9 },     // N: 실제지목
    { wch: 16 },    // O: 재배면적(노지+시설)
    { wch: 9 },     // P: 품목코드
    { wch: 14 },    // Q: 품목명_대분류명
    { wch: 14 },    // R: 품목명_중분류명
    { wch: 14 },    // S: 품목명_소분류명
    { wch: 12 },    // T: 위도
    { wch: 12 },    // U: 경도
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
    '공부지목': p.landCategoryOfficial || getRaw(p, '공부지목', '지목'),
    '실지목': p.landCategoryActual || getRaw(p, '실지목'),
    '채취연도': p.sampledYears.join(', '),
  }));
  return XLSX.utils.json_to_sheet(rows);
}

function createAllParcelsSheet(parcels: Parcel[]): XLSX.WorkSheet {
  const rows = parcels.map(p => ({
    '구분': (p.parcelCategory ?? 'public-payment') === 'representative' ? '대표필지' : '공익직불제',
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
    '공부지목': p.landCategoryOfficial || getRaw(p, '공부지목', '지목'),
    '실지목': p.landCategoryActual || getRaw(p, '실지목'),
    '면적(㎡)': p.area ?? '',
    '채취이력': p.sampledYears.join(', ') || '없음',
    '추출가능': p.isEligible ? 'O' : 'X',
    '2026선택': p.isSelected ? 'O' : 'X',
    '위도': p.coords?.lat ?? '',
    '경도': p.coords?.lng ?? '',
  }));
  return XLSX.utils.json_to_sheet(rows);
}
