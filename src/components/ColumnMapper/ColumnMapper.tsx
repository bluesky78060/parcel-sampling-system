import { useState, useEffect, useCallback } from 'react';
import type { FileConfig, ColumnMapping } from '../../types';
import { useFileStore } from '../../store/fileStore';
import { PreviewTable } from './PreviewTable';

interface ColumnMapperProps {
  fileConfig: FileConfig;
  onMappingComplete: () => void;
}

type RiParseMode = 'auto' | 'column';
type ParcelIdMode = 'single' | 'split';

interface SystemField {
  key: keyof ColumnMapping;
  label: string;
  required: boolean;
  keywords: string[];
}

const SYSTEM_FIELDS: SystemField[] = [
  { key: 'farmerId',      label: '경영체번호',  required: true,  keywords: ['경영체번호', '경영체 번호', '농가번호', '농가 번호', '농가코드', '관리번호', '농업인번호'] },
  { key: 'farmerName',    label: '경영체명',    required: false, keywords: ['경영체명', '경영체 이름', '농가명', '농가 이름', '농가이름', '성명', '대표자명', '대표자'] },
  { key: 'parcelId',      label: '필지번호',  required: true,  keywords: ['필지번호', '필지 번호', '필지코드', '지번', '지번번호', '번지'] },
  { key: 'farmerAddress',  label: '경영체주소', required: false, keywords: ['경영체주소', '경영체 주소', '농가주소', '농가 주소', '주소지', '경영체소재지', '농가소재지'] },
  { key: 'address',       label: '필지주소',  required: true,  keywords: ['필지주소', '필지 주소', '필지소재지', '필지 소재지', '지번주소', '지번 주소', '소재지', '소재'] },
  { key: 'ri',            label: '리/동',     required: false, keywords: ['법정리동', '법정리동명', '리동명', '리동', '법정리', '행정리', '리명', '법정동리', '동리명', '동리'] },
  { key: 'sido',          label: '시도',      required: false, keywords: ['시도명', '시도', '법정시도', '행정시도', '시·도'] },
  { key: 'sigungu',       label: '시군구',    required: false, keywords: ['시군구명', '시군구', '법정시군구', '행정시군구', '시군', '시·군·구'] },
  { key: 'eubmyeondong',  label: '읍면동',    required: false, keywords: ['읍면동명', '읍면동', '법정읍면동', '행정읍면동', '읍면', '읍·면·동'] },
  { key: 'area',          label: '면적',      required: false, keywords: ['면적', '재배면적', '경작면적', '필지면적', '넓이', '규모'] },
  { key: 'cropType',      label: '작물',      required: false, keywords: ['작물', '작목', '품목', '품종', '재배작물', '작목명', '작물명', '품목명'] },
  { key: 'pnu',           label: 'PNU코드',   required: false, keywords: ['직불신청_pnu', 'pnu코드', 'pnu', 'PNU', '필지고유번호'] },
];

const SPLIT_FIELDS = [
  { key: 'mainLotNum' as keyof ColumnMapping, label: '본번', keywords: ['본번', '본지번', '주번', '본번지'] },
  { key: 'subLotNum' as keyof ColumnMapping,  label: '부번', keywords: ['부번', '부지번', '부번지'] },
];


function autoMatch(headers: string[], keywords: string[], usedHeaders?: Set<string>): string {
  const lower = (s: string) => s.toLowerCase().replace(/\s/g, '');

  // 1차: 정확 매칭 (공백 제거 후 동일)
  for (const header of headers) {
    if (usedHeaders?.has(header)) continue;
    const h = lower(header);
    for (const kw of keywords) {
      if (h === lower(kw)) return header;
    }
  }

  // 2차: 부분 매칭 (키워드가 헤더에 포함)
  for (const header of headers) {
    if (usedHeaders?.has(header)) continue;
    const h = lower(header);
    for (const kw of keywords) {
      if (h.includes(lower(kw))) return header;
    }
  }

  return '';
}

function buildInitialMapping(
  headers: string[],
  existing: ColumnMapping
): ColumnMapping {
  const mapping: ColumnMapping = {
    farmerId: existing.farmerId || '',
    farmerName: existing.farmerName || '',
    parcelId: existing.parcelId || '',
    mainLotNum: existing.mainLotNum || '',
    subLotNum: existing.subLotNum || '',
    parcelIdMode: existing.parcelIdMode || 'single',
    address: existing.address || '',
    farmerAddress: existing.farmerAddress || '',
    ri: existing.ri || '',
    sido: existing.sido || '',
    sigungu: existing.sigungu || '',
    eubmyeondong: existing.eubmyeondong || '',
    area: existing.area || '',
    cropType: existing.cropType || '',
    pnu: existing.pnu || '',
  };

  // 이미 매핑된 헤더 추적 (중복 매핑 방지)
  const usedHeaders = new Set<string>();

  for (const field of SYSTEM_FIELDS) {
    const current = mapping[field.key];
    if (!current) {
      const matched = autoMatch(headers, field.keywords, usedHeaders);
      if (matched) {
        (mapping as unknown as Record<string, string>)[field.key] = matched;
        usedHeaders.add(matched);
      }
    } else if (typeof current === 'string' && current) {
      usedHeaders.add(current);
    }
  }

  // 본번/부번 자동 매칭
  for (const field of SPLIT_FIELDS) {
    const current = mapping[field.key];
    if (!current) {
      const matched = autoMatch(headers, field.keywords, usedHeaders);
      if (matched) {
        (mapping as unknown as Record<string, string>)[field.key] = matched;
        usedHeaders.add(matched);
      }
    } else if (typeof current === 'string' && current) {
      usedHeaders.add(current);
    }
  }

  // 본번이 자동 매칭되었으면 split 모드로 전환
  if (!existing.parcelIdMode && mapping.mainLotNum) {
    mapping.parcelIdMode = 'split';
  }

  return mapping;
}

export function ColumnMapper({ fileConfig, onMappingComplete }: ColumnMapperProps) {
  const { setColumnMapping } = useFileStore();
  const headers = fileConfig.headers ?? [];
  const rows = fileConfig.rawData ?? [];

  const [mapping, setMapping] = useState<ColumnMapping>(() =>
    buildInitialMapping(headers, fileConfig.columnMapping)
  );
  const [riParseMode, setRiParseMode] = useState<RiParseMode>(
    mapping.ri ? 'column' : 'auto'
  );
  const [parcelIdMode, setParcelIdMode] = useState<ParcelIdMode>(
    mapping.parcelIdMode || 'single'
  );

  // Re-run auto-match if headers change
  useEffect(() => {
    setMapping(buildInitialMapping(headers, fileConfig.columnMapping));
  }, [fileConfig.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFieldChange = useCallback(
    (field: keyof ColumnMapping, value: string) => {
      setMapping((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  const handleRiParseModeChange = useCallback((mode: RiParseMode) => {
    setRiParseMode(mode);
    if (mode === 'auto') {
      setMapping((prev) => ({ ...prev, ri: '' }));
    }
  }, []);

  const handleParcelIdModeChange = useCallback((mode: ParcelIdMode) => {
    setParcelIdMode(mode);
    setMapping((prev) => ({
      ...prev,
      parcelIdMode: mode,
      // 모드 전환 시 반대쪽 필드 초기화
      ...(mode === 'single'
        ? { mainLotNum: '', subLotNum: '' }
        : { parcelId: '' }),
    }));
  }, []);

  const isRequiredMapped = (() => {
    const baseOk = ['farmerId', 'address'].every((f) => {
      const val = mapping[f as keyof ColumnMapping];
      return typeof val === 'string' && val.trim() !== '';
    });
    // 필지번호: 분리면 mainLotNum 필수, 통합이면 parcelId 컬럼 또는 주소 자동추출 (항상 OK)
    const parcelOk = parcelIdMode === 'split'
      ? !!(mapping.mainLotNum && mapping.mainLotNum.trim())
      : true; // 통합모드: 컬럼 있으면 사용, 없으면 주소에서 자동 추출
    return baseOk && parcelOk;
  })();

  const handleComplete = () => {
    if (!isRequiredMapped) return;

    const finalMapping: ColumnMapping = { ...mapping };
    if (riParseMode === 'auto') {
      finalMapping.ri = '';
    }

    setColumnMapping(fileConfig.id, finalMapping);
    onMappingComplete();
  };

  const selectClass =
    'w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm ' +
    'text-gray-800 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 ' +
    'focus:ring-indigo-500 disabled:bg-gray-100 disabled:text-gray-400';

  return (
    <div className="flex flex-col gap-6">
      {/* Header + 매핑 완료 버튼 */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">컬럼 매핑</h2>
          <p className="mt-1 text-sm text-gray-500">
            파일 <span className="font-medium text-gray-700">{fileConfig.filename}</span>의
            컬럼을 시스템 필드에 연결해주세요.
            <span className="ml-2 text-red-500 font-medium">*</span>
            <span className="text-gray-400 text-xs ml-0.5">필수 필드</span>
          </p>
        </div>
        <button
          type="button"
          disabled={!isRequiredMapped}
          onClick={handleComplete}
          className={`rounded-lg px-5 py-2 text-sm font-semibold transition-colors flex-shrink-0 ${
            isRequiredMapped
              ? 'bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800 shadow-sm'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          매핑 완료
        </button>
      </div>

      {/* Mapping grid */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            필드 매핑
          </p>
        </div>

        <div className="divide-y divide-gray-100">
          {SYSTEM_FIELDS.map((field) => {
            const isRiField = field.key === 'ri';
            const isParcelIdField = field.key === 'parcelId';
            const isDisabled = isRiField && riParseMode === 'auto';
            const value = mapping[field.key] ?? '';

            // 필지번호 필드: split 모드일 때 숨김 (본번/부번으로 대체)
            if (isParcelIdField && parcelIdMode === 'split') {
              return (
                <div key={field.key}>
                  {/* 필지번호 토글 */}
                  <div className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50/60 transition-colors">
                    <div className="w-28 flex-shrink-0">
                      <span className="text-sm font-medium text-gray-700">
                        {field.label}
                      </span>
                      <span className="ml-1 text-red-500 font-semibold">*</span>
                    </div>
                    <div className="text-gray-300 flex-shrink-0 text-lg select-none">→</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex gap-2 mb-2">
                        <button
                          type="button"
                          onClick={() => handleParcelIdModeChange('single')}
                          className="flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                        >
                          통합 (한 컬럼)
                        </button>
                        <button
                          type="button"
                          onClick={() => handleParcelIdModeChange('split')}
                          className="flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors border-indigo-500 bg-indigo-50 text-indigo-700"
                        >
                          본번 · 부번 분리
                        </button>
                      </div>
                      {/* 본번 */}
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs text-gray-500 w-10">본번</span>
                        <select
                          value={mapping.mainLotNum ?? ''}
                          onChange={(e) => handleFieldChange('mainLotNum', e.target.value)}
                          className={selectClass}
                        >
                          <option value="">-- 본번 컬럼 --</option>
                          {headers.map((h) => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                      {/* 부번 */}
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 w-10">부번</span>
                        <select
                          value={mapping.subLotNum ?? ''}
                          onChange={(e) => handleFieldChange('subLotNum', e.target.value)}
                          className={selectClass}
                        >
                          <option value="">-- 부번 컬럼 (선택) --</option>
                          {headers.map((h) => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="w-16 flex-shrink-0 text-right">
                      {mapping.mainLotNum ? (
                        <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                          매핑됨
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-500">
                          필수
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={field.key}
                className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50/60 transition-colors"
              >
                {/* System field label */}
                <div className="w-28 flex-shrink-0">
                  <span className="text-sm font-medium text-gray-700">
                    {field.label}
                  </span>
                  {field.required && (
                    <span className="ml-1 text-red-500 font-semibold">*</span>
                  )}
                </div>

                {/* Arrow */}
                <div className="text-gray-300 flex-shrink-0 text-lg select-none">→</div>

                {/* Column selector */}
                <div className="flex-1 min-w-0">
                  {isParcelIdField && parcelIdMode === 'single' ? (
                    <div className="flex flex-col gap-2">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleParcelIdModeChange('single')}
                          className="flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors border-indigo-500 bg-indigo-50 text-indigo-700"
                        >
                          통합 (한 컬럼)
                        </button>
                        <button
                          type="button"
                          onClick={() => handleParcelIdModeChange('split')}
                          className="flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                        >
                          본번 · 부번 분리
                        </button>
                      </div>
                      <select
                        value={value}
                        onChange={(e) => handleFieldChange('parcelId', e.target.value)}
                        className={selectClass}
                      >
                        <option value="">-- 필지번호 컬럼 --</option>
                        {headers.map((h) => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                      <p className="text-xs text-gray-400">
                        컬럼이 없으면 주소에서 본번/부번을 자동 추출합니다.
                      </p>
                    </div>
                  ) : isRiField ? (
                    <div className="flex flex-col gap-2">
                      {/* Ri parse mode toggle */}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleRiParseModeChange('auto')}
                          className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                            riParseMode === 'auto'
                              ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                              : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          주소에서 자동 추출
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRiParseModeChange('column')}
                          className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                            riParseMode === 'column'
                              ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                              : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          별도 컬럼 지정
                        </button>
                      </div>

                      {/* Column dropdown (only when mode = column) */}
                      {riParseMode === 'column' && (
                        <select
                          value={value}
                          onChange={(e) => handleFieldChange(field.key, e.target.value)}
                          className={selectClass}
                        >
                          <option value="">-- 컬럼 선택 --</option>
                          {headers.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                      )}

                      {riParseMode === 'auto' && (
                        <p className="text-xs text-gray-400">
                          주소 필드에서 리명을 자동으로 추출합니다.
                        </p>
                      )}
                    </div>
                  ) : (
                    <select
                      value={value}
                      disabled={isDisabled}
                      onChange={(e) => handleFieldChange(field.key, e.target.value)}
                      className={selectClass}
                    >
                      <option value="">-- 컬럼 선택 --</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Mapped badge */}
                <div className="w-16 flex-shrink-0 text-right">
                  {!isDisabled && value ? (
                    <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                      매핑됨
                    </span>
                  ) : field.required && !isDisabled ? (
                    <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-500">
                      필수
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Preview */}
      {headers.length > 0 && rows.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              데이터 미리보기
            </p>
            <span className="text-xs text-gray-400">
              파란색 컬럼 = 매핑된 필드
            </span>
          </div>
          <div className="p-4">
            <PreviewTable
              headers={headers}
              rows={rows}
              mapping={mapping}
              maxRows={5}
            />
          </div>
        </div>
      )}

      {/* Footer actions */}
      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
        <div className="text-sm text-gray-500">
          {isRequiredMapped ? (
            <span className="text-green-600 font-medium">
              필수 필드가 모두 매핑되었습니다.
            </span>
          ) : (
            <span className="text-red-500">
              필수 필드(경영체번호, 주소)를 매핑해주세요. 필지번호는 컬럼 또는 본번·부번을 지정하세요.
            </span>
          )}
        </div>

        <button
          type="button"
          disabled={!isRequiredMapped}
          onClick={handleComplete}
          className={`rounded-lg px-5 py-2 text-sm font-semibold transition-colors ${
            isRequiredMapped
              ? 'bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800 shadow-sm'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          매핑 완료
        </button>
      </div>
    </div>
  );
}
