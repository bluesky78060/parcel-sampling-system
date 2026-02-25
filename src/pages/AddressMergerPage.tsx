import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { mergeAddress, detectIsSan } from '../lib/addressMerger';

// ── 타입 ──────────────────────────────────────────────────────────────────────

interface SheetRow {
  [key: string]: string | number | boolean | null | undefined;
}

interface ColumnMapping {
  sido: string;
  sigungu: string;
  eubmyeondong: string;
  ri: string;
  mainLotNum: string;
  subLotNum: string;
  address: string;
}

type Step = 'upload' | 'mapping' | 'preview' | 'done';

// ── 유틸 ──────────────────────────────────────────────────────────────────────

/** 컬럼명에서 용도를 자동 감지 */
function autoDetectColumns(headers: string[]): Partial<ColumnMapping> {
  const mapping: Partial<ColumnMapping> = {};

  for (const h of headers) {
    const lower = h.toLowerCase().replace(/\s/g, '');
    if (!mapping.sido && (h.includes('시도') || lower === 'sido' || lower === '시도')) {
      mapping.sido = h;
    } else if (!mapping.sigungu && (h.includes('시군구') || lower.includes('sigungu') || lower === '시군구')) {
      mapping.sigungu = h;
    } else if (!mapping.eubmyeondong && (h.includes('읍면동') || lower.includes('eubmyeon'))) {
      mapping.eubmyeondong = h;
    } else if (!mapping.ri && h.includes('리') && !h.includes('처리') && !h.includes('관리') && !h.includes('시군구') && !h.includes('읍면동')) {
      mapping.ri = h;
    } else if (!mapping.mainLotNum && (h.includes('본번') || lower.includes('mainlot') || h === '본번')) {
      mapping.mainLotNum = h;
    } else if (!mapping.subLotNum && (h.includes('부번') || lower.includes('sublot') || h === '부번')) {
      mapping.subLotNum = h;
    } else if (!mapping.address && (h.includes('주소') || h.includes('소재지') || lower.includes('address'))) {
      mapping.address = h;
    }
  }

  return mapping;
}

/** 셀 값을 문자열로 변환 */
function cellToString(val: string | number | boolean | null | undefined): string {
  if (val == null) return '';
  return String(val).trim();
}

// ── 컴포넌트 ──────────────────────────────────────────────────────────────────

export function AddressMergerPage() {
  const navigate = useNavigate();

  // 상태
  const [step, setStep] = useState<Step>('upload');
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState('');
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({
    sido: '',
    sigungu: '',
    eubmyeondong: '',
    ri: '',
    mainLotNum: '',
    subLotNum: '',
    address: '',
  });
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [previewRows, setPreviewRows] = useState<SheetRow[]>([]);
  const [generatedCount, setGeneratedCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const [outputRows, setOutputRows] = useState<SheetRow[]>([]);

  // ── 파일 로드 ──────────────────────────────────────────────────────────────

  function loadFile(file: File) {
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      alert('xlsx 또는 xls 파일만 업로드할 수 있습니다.');
      return;
    }

    setFileName(file.name);
    const reader = new FileReader();

    reader.onload = (e) => {
      const data = e.target?.result;
      if (!data) return;

      const wb = XLSX.read(data, { type: 'array' });
      setWorkbook(wb);
      setSheetNames(wb.SheetNames);
      const firstSheet = wb.SheetNames[0];
      setSelectedSheet(firstSheet);
      loadSheet(wb, firstSheet);
      setStep('mapping');
    };

    reader.readAsArrayBuffer(file);
  }

  function loadSheet(wb: XLSX.WorkBook, sheetName: string) {
    const ws = wb.Sheets[sheetName];
    const jsonRows: SheetRow[] = XLSX.utils.sheet_to_json<SheetRow>(ws, { defval: '' });
    const hdrs = jsonRows.length > 0 ? Object.keys(jsonRows[0]) : [];
    setHeaders(hdrs);
    setRows(jsonRows);
    const detected = autoDetectColumns(hdrs);
    setMapping({
      sido: detected.sido ?? '',
      sigungu: detected.sigungu ?? '',
      eubmyeondong: detected.eubmyeondong ?? '',
      ri: detected.ri ?? '',
      mainLotNum: detected.mainLotNum ?? '',
      subLotNum: detected.subLotNum ?? '',
      address: detected.address ?? '',
    });
  }

  // ── 드래그&드롭 ───────────────────────────────────────────────────────────

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 시트 변경 ─────────────────────────────────────────────────────────────

  function handleSheetChange(name: string) {
    setSelectedSheet(name);
    if (workbook) loadSheet(workbook, name);
  }

  // ── 주소 합치기 실행 ──────────────────────────────────────────────────────

  function runGeneration() {
    let generated = 0;
    let skipped = 0;

    const output = rows.map((row) => {
      const sido = cellToString(row[mapping.sido]);
      const sigungu = cellToString(row[mapping.sigungu]);
      const eum = cellToString(row[mapping.eubmyeondong]);
      const ri = cellToString(row[mapping.ri]);
      const main = row[mapping.mainLotNum];
      const sub = row[mapping.subLotNum];
      const addr = mapping.address ? cellToString(row[mapping.address]) : '';

      // 필수 필드 누락 시 건너뜀
      if (!sido || !sigungu || !eum || !ri || main == null || cellToString(main) === '') {
        skipped++;
        return { ...row, '필지 주소': '' };
      }

      // boolean 타입 제외 (SheetRow는 boolean도 포함하지만 본번/부번은 숫자/문자열)
      const mainVal = typeof main === 'boolean' ? String(main) : main;
      const subVal = sub == null || typeof sub === 'boolean' ? '' : sub;

      const isSan = detectIsSan(addr, mainVal);

      const merged = mergeAddress({
        sido,
        sigungu,
        eubmyeondong: eum,
        ri,
        mainLotNum: mainVal,
        subLotNum: subVal,
        isSan,
      });

      if (merged) {
        generated++;
      } else {
        skipped++;
      }

      return { ...row, '필지 주소': merged };
    });

    setOutputRows(output);
    setPreviewRows(output.slice(0, 10));
    setGeneratedCount(generated);
    setSkippedCount(skipped);
    setStep('preview');
  }

  // ── 엑셀 다운로드 ────────────────────────────────────────────────────────

  function downloadResult() {
    const ws = XLSX.utils.json_to_sheet(outputRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '주소합치기결과');
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const baseName = fileName.replace(/\.(xlsx|xls)$/i, '');
    saveAs(blob, `${baseName}_필지주소.xlsx`);
    setStep('done');
  }

  // ── 매핑 필드 레이블 ──────────────────────────────────────────────────────

  const FIELD_LABELS: { key: keyof ColumnMapping; label: string; required: boolean }[] = [
    { key: 'sido', label: '시도 컬럼', required: true },
    { key: 'sigungu', label: '시군구 컬럼', required: true },
    { key: 'eubmyeondong', label: '읍면동 컬럼', required: true },
    { key: 'ri', label: '리 컬럼', required: true },
    { key: 'mainLotNum', label: '본번 컬럼', required: true },
    { key: 'subLotNum', label: '부번 컬럼', required: false },
    { key: 'address', label: '주소 컬럼 (산 감지용)', required: false },
  ];

  const isMappingValid =
    mapping.sido && mapping.sigungu && mapping.eubmyeondong && mapping.ri && mapping.mainLotNum;

  // ── 렌더 ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-gray-500 hover:text-gray-800 transition-colors text-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            홈
          </button>
          <div className="w-px h-5 bg-gray-200" />
          <div>
            <h1 className="text-xl font-bold text-gray-900">주소 합치기</h1>
            <p className="text-xs text-gray-500 mt-0.5">분리된 주소 컬럼을 하나의 필지 주소로 합칩니다</p>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">

        {/* ── STEP 1: 업로드 ── */}
        {step === 'upload' && (
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-2xl p-16 text-center transition-colors ${
              isDragging
                ? 'border-amber-400 bg-amber-50'
                : 'border-gray-300 bg-white hover:border-amber-300 hover:bg-gray-50'
            }`}
          >
            <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-100 mx-auto mb-5">
              <svg className="w-8 h-8 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <p className="text-lg font-semibold text-gray-700 mb-2">
              {isDragging ? '파일을 놓으세요' : '엑셀 파일을 드래그하거나 선택하세요'}
            </p>
            <p className="text-sm text-gray-400 mb-6">.xlsx, .xls 형식 지원</p>
            <label className="inline-flex items-center gap-2 px-6 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium cursor-pointer transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              파일 선택
              <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileInput} />
            </label>
          </div>
        )}

        {/* ── STEP 2: 컬럼 매핑 ── */}
        {step === 'mapping' && (
          <div className="bg-white border border-gray-200 rounded-2xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">컬럼 매핑</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  파일: <span className="font-medium text-gray-700">{fileName}</span>
                  {' · '}
                  {rows.length.toLocaleString()}행
                </p>
              </div>
              <button
                onClick={() => { setStep('upload'); setFileName(''); }}
                className="text-sm text-gray-400 hover:text-gray-700 transition-colors"
              >
                파일 변경
              </button>
            </div>

            {/* 시트 선택 */}
            {sheetNames.length > 1 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">시트 선택</label>
                <select
                  value={selectedSheet}
                  onChange={(e) => handleSheetChange(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  {sheetNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* 컬럼 매핑 필드 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {FIELD_LABELS.map(({ key, label, required }) => (
                <div key={key}>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    {label}
                    {required && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  <select
                    value={mapping[key]}
                    onChange={(e) => setMapping((prev) => ({ ...prev, [key]: e.target.value }))}
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 ${
                      required && !mapping[key]
                        ? 'border-red-300 text-gray-500'
                        : 'border-gray-200 text-gray-800'
                    }`}
                  >
                    <option value="">— 선택 안 함 —</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div className="pt-2 flex justify-end">
              <button
                disabled={!isMappingValid}
                onClick={runGeneration}
                className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                  isMappingValid
                    ? 'bg-amber-600 hover:bg-amber-700 text-white'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}
              >
                주소 합치기 실행
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: 미리보기 ── */}
        {step === 'preview' && (
          <div className="space-y-5">
            {/* 결과 요약 */}
            <div className="bg-white border border-gray-200 rounded-2xl p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">생성 결과</h2>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-amber-50 rounded-xl p-4 text-center">
                  <div className="text-2xl font-bold text-amber-700">{generatedCount.toLocaleString()}</div>
                  <div className="text-xs text-amber-600 mt-1">생성 성공</div>
                </div>
                <div className="bg-orange-50 rounded-xl p-4 text-center">
                  <div className="text-2xl font-bold text-orange-700">{skippedCount.toLocaleString()}</div>
                  <div className="text-xs text-orange-600 mt-1">건너뜀</div>
                </div>
                <div className="bg-blue-50 rounded-xl p-4 text-center">
                  <div className="text-2xl font-bold text-blue-700">{outputRows.length.toLocaleString()}</div>
                  <div className="text-xs text-blue-600 mt-1">전체 행</div>
                </div>
              </div>
            </div>

            {/* 미리보기 테이블 */}
            <div className="bg-white border border-gray-200 rounded-2xl p-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">
                미리보기 (처음 10행)
              </h3>
              <div className="overflow-x-auto">
                <table className="text-xs w-full border-collapse">
                  <thead>
                    <tr className="bg-gray-50">
                      {headers.slice(0, 6).map((h) => (
                        <th key={h} className="border border-gray-200 px-3 py-2 text-left font-medium text-gray-600 whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                      <th className="border border-gray-200 px-3 py-2 text-left font-semibold text-amber-700 whitespace-nowrap bg-amber-50">
                        필지 주소
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        {headers.slice(0, 6).map((h) => (
                          <td key={h} className="border border-gray-200 px-3 py-1.5 text-gray-700 whitespace-nowrap max-w-32 truncate">
                            {cellToString(row[h])}
                          </td>
                        ))}
                        <td className={`border border-gray-200 px-3 py-1.5 whitespace-nowrap ${
                          row['필지 주소'] ? 'text-amber-700 bg-amber-50 font-medium' : 'text-red-400'
                        }`}>
                          {cellToString(row['필지 주소']) || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 액션 버튼 */}
            <div className="flex justify-between">
              <button
                onClick={() => setStep('mapping')}
                className="px-5 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                매핑 수정
              </button>
              <button
                onClick={downloadResult}
                className="px-6 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                엑셀 다운로드
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 4: 완료 ── */}
        {step === 'done' && (
          <div className="bg-white border border-gray-200 rounded-2xl p-16 text-center">
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-amber-100 mx-auto mb-5">
              <svg className="w-8 h-8 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">다운로드 완료</h2>
            <p className="text-sm text-gray-500 mb-8">
              필지 주소가 포함된 엑셀 파일이 저장되었습니다.
            </p>
            <div className="flex justify-center gap-3">
              <button
                onClick={() => {
                  setStep('upload');
                  setFileName('');
                  setWorkbook(null);
                  setRows([]);
                  setHeaders([]);
                }}
                className="px-5 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                새 파일 처리
              </button>
              <button
                onClick={() => navigate('/')}
                className="px-5 py-2.5 bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-sm font-semibold transition-colors"
              >
                홈으로
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
