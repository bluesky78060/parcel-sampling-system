interface SheetSelectorProps {
  sheets: string[];
  /** 현재 선택된 시트들 */
  selected: string[];
  /** 시트별 행 수 (없으면 표시하지 않음) */
  rowCounts?: Record<string, number>;
  onChange: (sheets: string[]) => void;
  disabled?: boolean;
}

export function SheetSelector({
  sheets,
  selected,
  rowCounts,
  onChange,
  disabled = false,
}: SheetSelectorProps) {
  if (sheets.length <= 1) return null;

  const toggle = (sheet: string) => {
    const next = selected.includes(sheet)
      ? selected.filter((s) => s !== sheet)
      : // 원래 시트 순서를 유지한다
        sheets.filter((s) => s === sheet || selected.includes(s));
    // 최소 1개는 남긴다 — 0개가 되면 로드할 데이터가 없다
    if (next.length === 0) return;
    onChange(next);
  };

  const totalRows = rowCounts
    ? selected.reduce((sum, s) => sum + (rowCounts[s] ?? 0), 0)
    : null;

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-1">
        <label className="block text-xs font-medium text-gray-700">
          시트 선택 <span className="text-gray-400 font-normal">(여러 개 선택 시 합쳐서 불러옵니다)</span>
        </label>
        {totalRows != null && selected.length > 1 && (
          <span className="text-xs text-indigo-600 font-medium">
            {selected.length}개 시트 · 약 {totalRows.toLocaleString()}행
          </span>
        )}
      </div>
      <div className="rounded-md border border-gray-300 bg-white divide-y divide-gray-100 max-h-44 overflow-auto">
        {sheets.map((sheet) => {
          const isChecked = selected.includes(sheet);
          const count = rowCounts?.[sheet];
          return (
            <label
              key={sheet}
              className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer transition-colors ${
                disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'
              } ${isChecked ? 'bg-indigo-50/60' : ''}`}
            >
              <input
                type="checkbox"
                checked={isChecked}
                disabled={disabled}
                onChange={() => toggle(sheet)}
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className={`flex-1 truncate ${isChecked ? 'text-gray-900 font-medium' : 'text-gray-600'}`}>
                {sheet}
              </span>
              {count != null && (
                <span className="text-xs text-gray-400 flex-shrink-0">
                  {count.toLocaleString()}행
                </span>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}
