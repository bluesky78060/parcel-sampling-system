interface RiDistributionChartProps {
  distribution: Record<string, { total: number; eligible: number }>;
}

interface RiRow {
  ri: string;
  total: number;
  eligible: number;
  ratio: number;
}

export function RiDistributionChart({ distribution }: RiDistributionChartProps) {
  const rows: RiRow[] = Object.entries(distribution)
    .map(([ri, { total, eligible }]) => ({
      ri,
      total,
      eligible,
      ratio: total > 0 ? Math.round((eligible / total) * 100) : 0,
    }))
    .sort((a, b) => b.eligible - a.eligible);

  const maxEligible = rows.length > 0 ? Math.max(...rows.map((r) => r.eligible)) : 1;
  const riCount = rows.length;

  return (
    <div className="rounded-lg shadow-sm border border-gray-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">리별 필지 분포</h3>
        <span className="text-xs text-gray-400">총 {riCount}개 리(里)</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
              <th className="px-4 py-2 text-left font-medium">리명</th>
              <th className="px-4 py-2 text-right font-medium">전체 필지</th>
              <th className="px-4 py-2 text-right font-medium">추출 가능</th>
              <th className="px-4 py-2 text-right font-medium">추출 비율</th>
              <th className="px-4 py-2 text-left font-medium w-40">분포</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((row) => (
              <tr
                key={row.ri}
                className={row.eligible < 10 ? 'bg-yellow-50' : 'bg-white hover:bg-gray-50'}
              >
                <td className="px-4 py-2 font-medium text-gray-800">
                  {row.ri}
                  {row.eligible < 10 && (
                    <span className="ml-1.5 text-xs text-yellow-600 font-normal">낮음</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right text-gray-600">{row.total.toLocaleString()}</td>
                <td className="px-4 py-2 text-right text-gray-800 font-medium">{row.eligible.toLocaleString()}</td>
                <td className="px-4 py-2 text-right text-gray-600">{row.ratio}%</td>
                <td className="px-4 py-2">
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden w-36">
                    <div
                      className="h-full bg-green-400 rounded-full"
                      style={{ width: `${maxEligible > 0 ? (row.eligible / maxEligible) * 100 : 0}%` }}
                    />
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  데이터가 없습니다
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
