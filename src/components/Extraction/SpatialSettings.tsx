import type { SpatialConfig } from '../../types';

interface SpatialSettingsProps {
  config: SpatialConfig;
  onUpdate: (updates: Partial<SpatialConfig>) => void;
  distantRis: Array<{ ri: string; distanceKm: number }>;
  excludedRis: string[];
  onToggleExcludeRi: (ri: string) => void;
}

export function SpatialSettings({
  config,
  onUpdate,
  distantRis,
  excludedRis,
  onToggleExcludeRi,
}: SpatialSettingsProps) {
  const disabled = !config.enableSpatialFilter;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-lg font-semibold text-gray-900">공간 필터 설정</h3>
        <label className="flex items-center gap-2 cursor-pointer">
          <span className="text-sm text-gray-600">공간 필터 활성화</span>
          <div className="relative">
            <input
              type="checkbox"
              checked={config.enableSpatialFilter}
              onChange={(e) => onUpdate({ enableSpatialFilter: e.target.checked })}
              className="sr-only"
            />
            <div
              className={`w-10 h-6 rounded-full transition-colors ${
                config.enableSpatialFilter ? 'bg-blue-500' : 'bg-gray-300'
              }`}
            >
              <div
                className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  config.enableSpatialFilter ? 'translate-x-5' : 'translate-x-1'
                }`}
              />
            </div>
          </div>
        </label>
      </div>
      <p className="text-sm text-gray-500 mb-6">좌표 기반으로 가까운 필지를 우선 선택합니다.</p>

      <div className={`space-y-6 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
        {/* 필지 간 최대 거리 슬라이더 */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium text-gray-700">필지 간 최대 거리</label>
            <span className="text-sm font-semibold text-blue-600">
              {config.maxParcelDistanceKm.toFixed(1)} km
            </span>
          </div>
          <p className="text-xs text-gray-400 mb-2">선택된 필지들 사이의 허용 최대 거리</p>
          <input
            type="range"
            min={0.5}
            max={5}
            step={0.5}
            value={config.maxParcelDistanceKm}
            disabled={disabled}
            onChange={(e) => onUpdate({ maxParcelDistanceKm: Number(e.target.value) })}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>0.5 km</span>
            <span>5 km</span>
          </div>
        </div>

        {/* 밀집도 가중치 슬라이더 */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium text-gray-700">밀집도 가중치</label>
            <span className="text-sm font-semibold text-blue-600">
              {config.densityWeight.toFixed(2)}
            </span>
          </div>
          <p className="text-xs text-gray-400 mb-2">
            0 = 완전 랜덤 선택, 1 = 밀집된 필지 우선 선택
          </p>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={config.densityWeight}
            disabled={disabled}
            onChange={(e) => onUpdate({ densityWeight: Number(e.target.value) })}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>0 (완전 랜덤)</span>
            <span>1 (밀집 우선)</span>
          </div>
        </div>

        {/* 먼 거리 리 목록 */}
        {distantRis.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              먼 거리 리 목록
            </label>
            <p className="text-xs text-gray-400 mb-2">
              자동으로 감지된 먼 리입니다. 체크된 리는 추출에서 제외됩니다.
            </p>
            <div className="border border-gray-200 rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="w-10 px-3 py-2 text-left text-xs font-medium text-gray-500">
                      제외
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">리명</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">
                      거리 (km)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {distantRis.map(({ ri, distanceKm }) => {
                    const isExcluded = excludedRis.includes(ri);
                    return (
                      <tr
                        key={ri}
                        className={`transition-colors ${isExcluded ? 'bg-red-50' : 'bg-white hover:bg-gray-50'}`}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={isExcluded}
                            disabled={disabled}
                            onChange={() => onToggleExcludeRi(ri)}
                            className="rounded border-gray-300 text-red-500 focus:ring-red-500"
                          />
                        </td>
                        <td className={`px-3 py-2 ${isExcluded ? 'text-red-600 line-through' : 'text-gray-800'}`}>
                          {ri}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-500">
                          {distanceKm.toFixed(1)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {distantRis.length === 0 && (
          <div className="text-sm text-gray-400 text-center py-4 border border-dashed border-gray-200 rounded-md">
            좌표 데이터가 있으면 먼 리가 자동으로 감지됩니다.
          </div>
        )}
      </div>
    </div>
  );
}
