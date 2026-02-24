import { useState, useEffect, useCallback } from 'react';
import type { FileConfig, ColumnMapping } from '../../types';
import { useFileStore } from '../../store/fileStore';
import { PreviewTable } from './PreviewTable';

interface ColumnMapperProps {
  fileConfig: FileConfig;
  onMappingComplete: () => void;
}

type RiParseMode = 'auto' | 'column';

interface SystemField {
  key: keyof ColumnMapping;
  label: string;
  required: boolean;
  keywords: string[];
}

const SYSTEM_FIELDS: SystemField[] = [
  { key: 'farmerId',      label: '농가번호',  required: true,  keywords: ['농가번호', '농가id', '농가 번호', '농가코드'] },
  { key: 'farmerName',    label: '농가명',    required: false, keywords: ['농가명', '농가 이름', '농가이름', '성명', '이름'] },
  { key: 'parcelId',      label: '필지번호',  required: true,  keywords: ['필지번호', '필지 번호', '필지id', '필지코드', '지번'] },
  { key: 'address',       label: '주소',      required: true,  keywords: ['주소', '소재지', '도로명', '지번주소', '소재'] },
  { key: 'ri',            label: '리명',      required: false, keywords: ['리명', '리 명', '마을', '법정리', '행정리'] },
  { key: 'sigungu',       label: '시군구',    required: false, keywords: ['시군구', '시/군/구', '시군', '군구'] },
  { key: 'eubmyeondong',  label: '읍면동',    required: false, keywords: ['읍면동', '읍/면/동', '읍면', '면동'] },
  { key: 'area',          label: '면적',      required: false, keywords: ['면적', '넓이', '재배면적', '경작면적', '규모'] },
  { key: 'cropType',      label: '작물',      required: false, keywords: ['작물', '작목', '품목', '품종', '재배작물'] },
];

const REQUIRED_FIELDS: Array<keyof ColumnMapping> = ['farmerId', 'parcelId', 'address'];

function autoMatch(headers: string[], keywords: string[]): string {
  const lower = (s: string) => s.toLowerCase().replace(/\s/g, '');
  for (const header of headers) {
    for (const kw of keywords) {
      if (lower(header).includes(lower(kw))) return header;
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
    address: existing.address || '',
    ri: existing.ri || '',
    sigungu: existing.sigungu || '',
    eubmyeondong: existing.eubmyeondong || '',
    area: existing.area || '',
    cropType: existing.cropType || '',
  };

  for (const field of SYSTEM_FIELDS) {
    const current = mapping[field.key];
    if (!current) {
      const matched = autoMatch(headers, field.keywords);
      if (matched) {
        (mapping as unknown as Record<string, string>)[field.key] = matched;
      }
    }
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

  const isRequiredMapped = REQUIRED_FIELDS.every((f) => {
    const val = mapping[f];
    return typeof val === 'string' && val.trim() !== '';
  });

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
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-gray-800">컬럼 매핑</h2>
        <p className="mt-1 text-sm text-gray-500">
          파일 <span className="font-medium text-gray-700">{fileConfig.filename}</span>의
          컬럼을 시스템 필드에 연결해주세요.
          <span className="ml-2 text-red-500 font-medium">*</span>
          <span className="text-gray-400 text-xs ml-0.5">필수 필드</span>
        </p>
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
            const isDisabled = isRiField && riParseMode === 'auto';
            const value = mapping[field.key] ?? '';

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
                  {isRiField ? (
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
              필수 필드(농가번호, 필지번호, 주소)를 모두 매핑해주세요.
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
