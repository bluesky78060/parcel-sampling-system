interface MapLegendProps {
  counts: {
    selected: number;
    unselected: number;
    sampled2024: number;
    sampled2025: number;
    noCoords: number;
  };
  horizontal?: boolean;
}

interface LegendItem {
  color: string;
  label: string;
  count: number;
  borderColor?: string;
}

export function MapLegend({ counts, horizontal = false }: MapLegendProps) {
  const items: LegendItem[] = [
    {
      color: '#2563eb',
      label: '2026 추출 선택',
      count: counts.selected,
    },
    {
      color: '#6b7280',
      label: '추출 후보 미선택',
      count: counts.unselected,
    },
    {
      color: '#dc2626',
      label: '2024 채취 제외',
      count: counts.sampled2024,
    },
    {
      color: '#ea580c',
      label: '2025 채취 제외',
      count: counts.sampled2025,
    },
    {
      color: '#fbbf24',
      label: '좌표 미변환',
      count: counts.noCoords,
      borderColor: '#d97706',
    },
  ];

  if (horizontal) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm px-4 py-2.5 z-10">
        <div className="flex items-center gap-5 flex-wrap">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">범례</span>
          <div className="h-4 w-px bg-gray-200" />
          {items.map((item) => (
            <div key={item.label} className="flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{
                  backgroundColor: item.color,
                  border: item.borderColor ? `2px solid ${item.borderColor}` : undefined,
                }}
              />
              <span className="text-xs text-gray-600">{item.label}</span>
              <span className="text-xs font-semibold text-gray-800 tabular-nums">
                {item.count.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 z-10">
      <h4 className="text-sm font-semibold text-gray-700 mb-3">범례</h4>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.label} className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{
                  backgroundColor: item.color,
                  border: item.borderColor ? `2px solid ${item.borderColor}` : undefined,
                }}
              />
              <span className="text-xs text-gray-600">{item.label}</span>
            </div>
            <span className="text-xs font-semibold text-gray-800 tabular-nums">
              {item.count.toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
