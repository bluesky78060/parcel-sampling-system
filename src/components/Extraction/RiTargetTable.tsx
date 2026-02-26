interface RiTargetTableProps {
  riList: Array<{ ri: string; eligibleCount: number }>;
  perRiTarget: number;
  overrides: Record<string, number>;
  excludedRis: string[];
  onSetOverride: (ri: string, target: number) => void;
  onRemoveOverride: (ri: string) => void;
  onToggleExclude: (ri: string) => void;
}

export function RiTargetTable({
  riList,
  perRiTarget,
  overrides,
  excludedRis,
  onSetOverride,
  onRemoveOverride,
  onToggleExclude,
}: RiTargetTableProps) {
  const totalTarget = riList.reduce((sum, { ri }) => {
    if (excludedRis.includes(ri)) return sum;
    return sum + (overrides[ri] ?? perRiTarget);
  }, 0);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-1">리별 추출 목표 개별 설정</h3>
      <p className="text-sm text-gray-500 mb-4">
        리(里)마다 개별 목표 수를 지정하거나 특정 리를 제외할 수 있습니다.
      </p>

      <div className="overflow-auto max-h-80 border border-gray-200 rounded-md">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 w-32">리명</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-28">
                추출가능 필지
              </th>
              <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 w-36">
                목표 수
              </th>
              <th className="px-3 py-2 text-center text-xs font-medium text-red-500 w-16">
                제외
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {riList.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-400">
                  추출 가능한 리 데이터가 없습니다. 데이터를 먼저 불러와주세요.
                </td>
              </tr>
            )}
            {riList.map(({ ri, eligibleCount }) => {
              const isExcluded = excludedRis.includes(ri);
              const hasOverride = ri in overrides;
              const targetValue = hasOverride ? overrides[ri] : perRiTarget;

              return (
                <tr
                  key={ri}
                  className={`transition-colors ${
                    isExcluded ? 'bg-gray-100 opacity-60' : 'bg-white hover:bg-gray-50'
                  }`}
                >
                  <td className={`px-3 py-2 font-medium ${isExcluded ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                    {ri}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-500">{eligibleCount.toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1 justify-center">
                      <input
                        type="number"
                        min={0}
                        max={eligibleCount}
                        value={targetValue}
                        disabled={isExcluded}
                        onChange={(e) => onSetOverride(ri, Number(e.target.value))}
                        className={`w-16 border rounded px-2 py-1 text-center text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                          hasOverride
                            ? 'border-blue-400 bg-blue-50 text-blue-700'
                            : 'border-gray-300 text-gray-700'
                        } disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed`}
                      />
                      {hasOverride && (
                        <button
                          type="button"
                          onClick={() => onRemoveOverride(ri)}
                          disabled={isExcluded}
                          title="기본값으로 초기화"
                          className="text-xs text-gray-400 hover:text-red-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          ↺
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={isExcluded}
                      onChange={() => onToggleExclude(ri)}
                      className="rounded border-gray-300 text-red-500 focus:ring-red-500"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="text-gray-500">
          {riList.length}개 리 중 {riList.length - excludedRis.length}개 활성
        </span>
        <span className="font-semibold text-gray-700">
          총 목표 합계:{' '}
          <span className="text-blue-600">{totalTarget.toLocaleString()}필지</span>
        </span>
      </div>
    </div>
  );
}
