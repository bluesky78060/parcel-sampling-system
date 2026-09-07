import { useSurveyStore, sampledYearsOf } from '../../store/surveyStore';
interface MapLegendProps {
  counts: {
    selected: number;
    representative: number;
    unselected: number;
    /**
     * 기채취 연도별 제외 건수. 키는 연도.
     * 튜플로 받으면 집계 쪽과 라벨 쪽이 같은 순서라는 가정을 아무도 검사하지 않는다 —
     * 어긋나면 라벨과 숫자가 뒤바뀐 채 조용히 표시된다. 연도로 찾으면 순서가 무관해진다.
     */
    sampledByYear: Record<number, number>;
    noCoords: number;
  };
  horizontal?: boolean;
}

interface LegendItem {
  color: string;
  label: string;
  count: number;
  borderColor?: string;
  isStar?: boolean;
}

export function MapLegend({ counts, horizontal = false }: MapLegendProps) {
  const sampledYears = sampledYearsOf(useSurveyStore((st) => st.surveyYear));
  const items: LegendItem[] = [
    {
      color: '#059669',
      label: '대표필지 (고정)',
      count: counts.representative,
      isStar: true,
    },
    {
      color: '#2563eb',
      label: '공익직불제 추출 선택',
      count: counts.selected,
    },
    {
      color: '#6b7280',
      label: '추출 후보 미선택',
      count: counts.unselected,
    },
    {
      color: '#dc2626',
      label: `${sampledYears[0]} 채취 제외`,
      count: counts.sampledByYear[sampledYears[0]] ?? 0,
    },
    {
      color: '#ea580c',
      label: `${sampledYears[1]} 채취 제외`,
      count: counts.sampledByYear[sampledYears[1]] ?? 0,
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
              {item.isStar ? (
                <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 12 12" fill={item.color}>
                  <polygon points="6,0 7.5,4.2 12,4.5 8.5,7.5 9.5,12 6,9.5 2.5,12 3.5,7.5 0,4.5 4.5,4.2" />
                </svg>
              ) : (
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{
                    backgroundColor: item.color,
                    border: item.borderColor ? `2px solid ${item.borderColor}` : undefined,
                  }}
                />
              )}
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
              {item.isStar ? (
                <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 12 12" fill={item.color}>
                  <polygon points="6,0 7.5,4.2 12,4.5 8.5,7.5 9.5,12 6,9.5 2.5,12 3.5,7.5 0,4.5 4.5,4.2" />
                </svg>
              ) : (
                <span
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{
                    backgroundColor: item.color,
                    border: item.borderColor ? `2px solid ${item.borderColor}` : undefined,
                  }}
                />
              )}
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
