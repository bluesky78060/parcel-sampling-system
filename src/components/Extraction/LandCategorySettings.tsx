import { useState } from 'react';

interface LandCategorySettingsProps {
  /** 데이터에서 감지된 지목별 필지 수 (실지목 기준) */
  categoryDistribution: Record<string, number>;
  /** 현재 설정된 비율 (%) */
  ratios: Record<string, number>;
  /** 지목별 비율 필터 활성화 여부 */
  enabled: boolean;
  onToggleEnabled: (enabled: boolean) => void;
  onUpdateRatio: (category: string, ratio: number) => void;
  onResetRatios: () => void;
}

/** 지목별 색상 (순환 사용) */
const CATEGORY_COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
  '#f97316', // orange
  '#6366f1', // indigo
];

function getCategoryColor(index: number): string {
  return CATEGORY_COLORS[index % CATEGORY_COLORS.length];
}

export function LandCategorySettings({
  categoryDistribution,
  ratios,
  enabled,
  onToggleEnabled,
  onUpdateRatio,
  onResetRatios,
}: LandCategorySettingsProps) {
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // 필지 수 기준 내림차순 정렬, 미분류는 마지막
  const categories = Object.entries(categoryDistribution)
    .filter(([, count]) => count > 0)
    .sort((a, b) => {
      if (a[0] === '미분류') return 1;
      if (b[0] === '미분류') return -1;
      return b[1] - a[1];
    });

  const totalParcels = categories.reduce((s, [, n]) => s + n, 0);

  // 비율 합계
  const totalRatio = categories.reduce((s, [cat]) => s + (ratios[cat] ?? 0), 0);

  const handleStartEdit = (category: string) => {
    setEditingCategory(category);
    setEditValue(String(ratios[category] ?? 0));
  };

  const handleCommitEdit = (category: string) => {
    const v = parseFloat(editValue);
    if (!isNaN(v) && v >= 0 && v <= 100) {
      onUpdateRatio(category, Math.round(v * 10) / 10);
    }
    setEditingCategory(null);
  };

  if (totalParcels === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-1">지목별 비율 설정</h3>
        <p className="text-sm text-gray-400">
          데이터에 지목 정보가 없습니다. 컬럼 매핑에서 공부지목 또는 실지목 컬럼을 매핑해주세요.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-lg font-semibold text-gray-900">지목별 비율 설정</h3>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onToggleEnabled(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600" />
        </label>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        실지목 기준으로 지목별 추출 비율을 조정합니다. 비율 합계가 100%가 되어야 정확하게 적용됩니다.
      </p>

      {!enabled && (
        <div className="text-sm text-gray-400 italic">
          비활성 — 지목에 관계없이 균등하게 추출합니다.
        </div>
      )}

      {enabled && (
        <>
          {/* 비율 합계 */}
          <div className={`mb-4 rounded-lg px-3 py-2 text-sm font-medium ${
            Math.abs(totalRatio - 100) < 0.1
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-yellow-50 text-yellow-700 border border-yellow-200'
          }`}>
            비율 합계: {totalRatio.toFixed(1)}%
            {Math.abs(totalRatio - 100) >= 0.1 && ' (100%가 되어야 정확히 적용됩니다)'}
          </div>

          {/* 지목 테이블 */}
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold text-gray-600">지목 (실지목)</th>
                  <th className="px-4 py-2 text-right font-semibold text-gray-600">필지 수</th>
                  <th className="px-4 py-2 text-right font-semibold text-gray-600">데이터 비율</th>
                  <th className="px-4 py-2 text-right font-semibold text-gray-600">추출 비율 (%)</th>
                  <th className="px-4 py-2 text-center font-semibold text-gray-600 w-20">비율 바</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {categories.map(([cat, count], index) => {
                  const color = getCategoryColor(index);
                  const dataRatio = totalParcels > 0 ? (count / totalParcels) * 100 : 0;
                  const ratio = ratios[cat] ?? 0;
                  const isEditing = editingCategory === cat;

                  return (
                    <tr key={cat} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium text-gray-800">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: color }}
                          />
                          {cat}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right text-gray-600 tabular-nums">
                        {count.toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-500 tabular-nums">
                        {dataRatio.toFixed(1)}%
                      </td>
                      <td className="px-4 py-2 text-right">
                        {isEditing ? (
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={0.1}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => handleCommitEdit(cat)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleCommitEdit(cat);
                              if (e.key === 'Escape') setEditingCategory(null);
                            }}
                            autoFocus
                            className="w-20 text-right border border-blue-400 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleStartEdit(cat)}
                            className="text-right font-medium text-blue-600 hover:text-blue-800 hover:underline tabular-nums cursor-pointer"
                          >
                            {ratio.toFixed(1)}%
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <div className="w-full bg-gray-100 rounded-full h-2">
                          <div
                            className="h-2 rounded-full transition-all duration-200"
                            style={{
                              width: `${Math.min(ratio, 100)}%`,
                              backgroundColor: color,
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 하단 액션 */}
          <div className="flex items-center justify-between mt-3">
            <button
              type="button"
              onClick={onResetRatios}
              className="text-sm text-gray-500 hover:text-gray-700 underline"
            >
              데이터 비율로 초기화
            </button>
            <p className="text-xs text-gray-400">
              클릭하여 비율을 직접 입력 · 모든 지목의 비율 합계가 100%여야 합니다
            </p>
          </div>
        </>
      )}
    </div>
  );
}
