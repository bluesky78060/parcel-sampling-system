import type { ColumnMapping } from '../../types';

interface PreviewTableProps {
  headers: string[];
  rows: Record<string, unknown>[];
  mapping: ColumnMapping;
  maxRows?: number;
}

const SYSTEM_FIELD_LABELS: Record<string, string> = {
  farmerId: '경영체번호',
  farmerName: '경영체명',
  parcelId: '필지번호',
  address: '주소',
  ri: '리명',
  sigungu: '시군구',
  eubmyeondong: '읍면동',
  area: '면적',
  cropType: '작물',
  landCategoryOfficial: '공부지목',
  landCategoryActual: '실지목',
};

function getMappedSystemField(header: string, mapping: ColumnMapping): string | null {
  const entries = Object.entries(mapping) as [keyof ColumnMapping, string | undefined][];
  for (const [field, col] of entries) {
    if (col === header) return SYSTEM_FIELD_LABELS[field] ?? field;
  }
  return null;
}

export function PreviewTable({ headers, rows, mapping, maxRows = 5 }: PreviewTableProps) {
  const previewRows = rows.slice(0, maxRows);

  if (headers.length === 0) {
    return <p className="text-sm text-gray-400 py-4 text-center">데이터 없음</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 text-xs">
        <thead className="bg-gray-50">
          <tr>
            {headers.map((header) => {
              const systemField = getMappedSystemField(header, mapping);
              return (
                <th
                  key={header}
                  className={`
                    whitespace-nowrap px-3 py-2 text-left font-semibold text-gray-600
                    ${systemField ? 'bg-blue-50' : ''}
                  `}
                >
                  <div>{header}</div>
                  {systemField && (
                    <div className="text-indigo-600 font-normal">→ {systemField}</div>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {previewRows.map((row, rowIdx) => (
            <tr key={rowIdx} className="hover:bg-gray-50">
              {headers.map((header) => {
                const systemField = getMappedSystemField(header, mapping);
                return (
                  <td
                    key={header}
                    className={`whitespace-nowrap px-3 py-1.5 text-gray-700 ${systemField ? 'bg-blue-50' : ''}`}
                  >
                    {String(row[header] ?? '')}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > maxRows && (
        <p className="px-3 py-1.5 text-center text-xs text-gray-400 bg-gray-50 border-t border-gray-200">
          전체 {rows.length.toLocaleString()}행 중 {maxRows}행 표시
        </p>
      )}
    </div>
  );
}
