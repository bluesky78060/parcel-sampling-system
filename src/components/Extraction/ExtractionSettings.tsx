import type { ExtractionConfig } from '../../types';

interface ExtractionSettingsProps {
  config: ExtractionConfig;
  onUpdate: (updates: Partial<ExtractionConfig>) => void;
}

export function ExtractionSettings({ config, onUpdate }: ExtractionSettingsProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-1">기본 추출 파라미터</h3>
      <p className="text-sm text-gray-500 mb-6">추출 목표 수량과 방식을 설정합니다.</p>

      <div className="grid grid-cols-2 gap-6">
        {/* 총 추출 목표 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            총 추출 목표
          </label>
          <p className="text-xs text-gray-400 mb-2">전체에서 추출할 필지 수 (100~2000)</p>
          <input
            type="number"
            min={100}
            max={2000}
            value={config.totalTarget}
            onChange={(e) => onUpdate({ totalTarget: Number(e.target.value) })}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* 리당 추출 수 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            리당 추출 수
          </label>
          <p className="text-xs text-gray-400 mb-2">각 리(里)에서 추출할 기본 필지 수 (1~50)</p>
          <input
            type="number"
            min={1}
            max={50}
            value={config.perRiTarget}
            onChange={(e) => onUpdate({ perRiTarget: Number(e.target.value) })}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* 농가당 최소 필지 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            농가당 최소 필지
          </label>
          <p className="text-xs text-gray-400 mb-2">한 농가에서 최소로 추출할 필지 수</p>
          <input
            type="number"
            min={1}
            max={config.maxPerFarmer}
            value={config.minPerFarmer}
            onChange={(e) => onUpdate({ minPerFarmer: Number(e.target.value) })}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* 농가당 최대 필지 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            농가당 최대 필지
          </label>
          <p className="text-xs text-gray-400 mb-2">한 농가에서 최대로 추출할 필지 수</p>
          <input
            type="number"
            min={config.minPerFarmer}
            max={20}
            value={config.maxPerFarmer}
            onChange={(e) => onUpdate({ maxPerFarmer: Number(e.target.value) })}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* 추출 방식 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            추출 방식
          </label>
          <p className="text-xs text-gray-400 mb-2">필지를 선택하는 기준</p>
          <select
            value={config.extractionMethod}
            onChange={(e) =>
              onUpdate({
                extractionMethod: e.target.value as ExtractionConfig['extractionMethod'],
              })
            }
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="random">랜덤 균등</option>
            <option value="area">면적순</option>
            <option value="farmerId">경영체번호순</option>
          </select>
        </div>

        {/* 미달 리 처리 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            미달 리 처리
          </label>
          <p className="text-xs text-gray-400 mb-2">목표 수량에 미달하는 리의 처리 방식</p>
          <select
            value={config.underfillPolicy}
            onChange={(e) =>
              onUpdate({
                underfillPolicy: e.target.value as ExtractionConfig['underfillPolicy'],
              })
            }
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="supplement">인접 리에서 보충</option>
            <option value="skip">건너뜀</option>
          </select>
        </div>

        {/* 시드값 */}
        <div className="col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            시드값 <span className="text-gray-400 font-normal">(선택)</span>
          </label>
          <p className="text-xs text-gray-400 mb-2">
            동일한 시드값으로 동일한 추출 결과를 재현할 수 있습니다. 비워두면 매번 다른 결과가 나옵니다.
          </p>
          <input
            type="number"
            min={0}
            value={config.randomSeed ?? ''}
            onChange={(e) => {
              const val = e.target.value;
              onUpdate({ randomSeed: val === '' ? undefined : Number(val) });
            }}
            placeholder="예: 42"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
    </div>
  );
}
