interface SheetSelectorProps {
  sheets: string[];
  selected: string;
  onChange: (sheet: string) => void;
}

export function SheetSelector({ sheets, selected, onChange }: SheetSelectorProps) {
  if (sheets.length <= 1) return null;

  return (
    <div className="mt-3">
      <label className="block text-xs font-medium text-gray-700 mb-1">시트 선택</label>
      <select
        value={selected}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        {sheets.map((sheet) => (
          <option key={sheet} value={sheet}>
            {sheet}
          </option>
        ))}
      </select>
    </div>
  );
}
