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
    /**
     * 업로드됐지만 결과에 없어 지도에 없는 대표필지. 0이면 줄 자체를 내지 않는다.
     *
     * 이 줄이 없던 동안 범례의 "대표필지"는 업로드 전량을, 지도 배지는 실제 마커를
     * 세어 두 숫자가 조용히 어긋났다(대표 260 / 대표 200). 차이가 나는 **이유**를
     * 보여 주지 않으면 사용자는 둘 중 어느 쪽이 틀렸는지 알 수 없다.
     */
    representativeExcluded?: number;
  };
  horizontal?: boolean;
}

interface LegendItem {
  color: string;
  label: string;
  count: number;
  borderColor?: string;
  isStar?: boolean;
  /** 마우스를 올렸을 때의 설명 */
  title?: string;
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
    // 상한에 걸린 초과분은 지도에 없다. 있을 때만 낸다 — 0을 늘 보여 주면
    // 정상 상태에서도 무언가 잘못된 것처럼 읽힌다.
    ...(counts.representativeExcluded
      ? [
          {
            color: '#d1d5db',
            label: '대표필지 (결과 제외)',
            count: counts.representativeExcluded,
            isStar: true,
            title:
              '업로드된 대표필지 중 지도에 없는 건수입니다. ' +
              '설정한 대표필지 상한을 넘었거나, 식별할 정보가 없어 결과에 들어가지 못한 것입니다.',
          },
        ]
      : []),
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
            <div key={item.label} className="flex items-center gap-1.5" title={item.title}>
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
          <li key={item.label} className="flex items-center justify-between gap-3" title={item.title}>
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
