import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useParcelStore } from '../store/parcelStore';
import { useExtractionStore } from '../store/extractionStore';
import {
  calculateRiCentroids,
  calculateCentroid,
  haversineDistance,
} from '../lib/spatialUtils';
import { ExtractionSettings } from '../components/Extraction/ExtractionSettings';
import { SpatialSettings } from '../components/Extraction/SpatialSettings';
import { RiTargetTable } from '../components/Extraction/RiTargetTable';

export function ExtractPage() {
  const navigate = useNavigate();
  const allParcels = useParcelStore((s) => s.allParcels);
  const representativeParcels = useParcelStore((s) => s.representativeParcels);
  const getRiDistribution = useParcelStore((s) => s.getRiDistribution);

  const config = useExtractionStore((s) => s.config);
  const result = useExtractionStore((s) => s.result);
  const isRunning = useExtractionStore((s) => s.isRunning);
  const updateConfig = useExtractionStore((s) => s.updateConfig);
  const updateSpatialConfig = useExtractionStore((s) => s.updateSpatialConfig);
  const setRiTargetOverride = useExtractionStore((s) => s.setRiTargetOverride);
  const removeRiTargetOverride = useExtractionStore((s) => s.removeRiTargetOverride);
  const toggleExcludedRi = useExtractionStore((s) => s.toggleExcludedRi);
  const runExtraction = useExtractionStore((s) => s.runExtraction);

  // allParcels가 비어있으면 /analyze로 리다이렉트
  useEffect(() => {
    if (allParcels.length === 0) {
      navigate('/analyze');
    }
  }, [allParcels, navigate]);

  // 먼 거리 리 자동 감지 (좌표 기반)
  const distantRis = useMemo<Array<{ ri: string; distanceKm: number }>>(() => {
    const coordParcels = allParcels.filter((p) => p.coords != null);
    if (coordParcels.length === 0) return [];

    const centroid = calculateCentroid(coordParcels);
    if (!centroid) return [];

    const riCentroids = calculateRiCentroids(coordParcels);
    const riNames = Object.keys(riCentroids);

    if (riNames.length === 0) return [];

    const distances = riNames.map((ri) => ({
      ri,
      distanceKm: haversineDistance(centroid, riCentroids[ri]),
    }));

    // 자동 임계값: 평균 + 표준편차 * 2
    const dists = distances.map((d) => d.distanceKm);
    const mean = dists.reduce((a, b) => a + b, 0) / dists.length;
    const variance =
      dists.reduce((acc, d) => acc + Math.pow(d - mean, 2), 0) / dists.length;
    const stdDev = Math.sqrt(variance);
    const threshold = mean + stdDev * 2;

    return distances
      .filter((d) => d.distanceKm > threshold)
      .sort((a, b) => b.distanceKm - a.distanceKm);
  }, [allParcels]);

  // 리별 추출가능 필지 목록
  const riList = useMemo(() => {
    const dist = getRiDistribution();
    return Object.entries(dist)
      .map(([ri, counts]) => ({ ri, eligibleCount: counts.eligible }))
      .filter(({ eligibleCount }) => eligibleCount > 0)
      .sort((a, b) => a.ri.localeCompare(b.ri, 'ko'));
  }, [getRiDistribution]);

  const spatialConfig = config.spatialConfig!;

  const repCount = representativeParcels.length;
  const effectiveTarget = Math.max(0, config.totalTarget - repCount);

  const handleRunExtraction = () => {
    runExtraction(allParcels, representativeParcels);
  };

  const canProceed = result !== null && !isRunning;

  return (
    <div className="max-w-4xl mx-auto py-6 px-4 space-y-6">
      {/* 헤더 */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">추출 설정</h2>
        <p className="text-gray-500 mt-1">추출 조건을 설정하고 필지를 추출합니다.</p>
      </div>

      {/* 기본 추출 파라미터 */}
      <ExtractionSettings config={config} onUpdate={updateConfig} />

      {/* 공간 필터 설정 */}
      <SpatialSettings
        config={spatialConfig}
        onUpdate={updateSpatialConfig}
        distantRis={distantRis}
        excludedRis={config.excludedRis}
        onToggleExcludeRi={toggleExcludedRi}
      />

      {/* 리별 목표 개별 설정 */}
      <RiTargetTable
        riList={riList}
        perRiTarget={config.perRiTarget}
        overrides={config.riTargetOverrides}
        excludedRis={config.excludedRis}
        onSetOverride={setRiTargetOverride}
        onRemoveOverride={removeRiTargetOverride}
        onToggleExclude={toggleExcludedRi}
      />

      {/* 대표필지 정보 (있을 때만 표시) */}
      {repCount > 0 && (
        <div className="bg-emerald-50 rounded-lg border border-emerald-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-3 h-3 rounded-full bg-emerald-500 flex-shrink-0" />
            <h3 className="text-sm font-semibold text-emerald-800">대표필지 포함</h3>
          </div>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-emerald-600">대표필지</span>
              <p className="font-semibold text-emerald-900">{repCount}개 (고정)</p>
            </div>
            <div>
              <span className="text-emerald-600">공익직불제 추출 목표</span>
              <p className="font-semibold text-emerald-900">{effectiveTarget}개 (= {config.totalTarget} - {repCount})</p>
            </div>
            <div>
              <span className="text-emerald-600">총 목표</span>
              <p className="font-semibold text-emerald-900">{config.totalTarget}개</p>
            </div>
          </div>
        </div>
      )}

      {/* 추출 실행 */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex flex-col items-center gap-4">
          <button
            type="button"
            onClick={handleRunExtraction}
            disabled={isRunning}
            className="px-8 py-3 bg-blue-600 text-white rounded-lg font-semibold text-base hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            {isRunning ? '추출 중...' : '추출 실행'}
          </button>

          {/* 추출 결과 요약 */}
          {result && (
            <div
              className={`w-full rounded-lg border px-4 py-3 text-sm ${
                result.validation.isValid
                  ? 'bg-green-50 border-green-200 text-green-800'
                  : 'bg-yellow-50 border-yellow-200 text-yellow-800'
              }`}
            >
              <div className="flex items-center gap-2 font-semibold mb-1">
                <span>
                  추출 결과: {result.selectedParcels.length.toLocaleString()}필지 선택
                </span>
                {result.validation.isValid ? (
                  <span className="text-green-600">검증 통과</span>
                ) : (
                  <span className="text-yellow-600">검증 경고</span>
                )}
              </div>

              {result.validation.errors.length > 0 && (
                <div className="mt-1">
                  <span className="font-medium text-red-600">
                    오류 {result.validation.errors.length}건:
                  </span>
                  <ul className="list-disc list-inside ml-2 text-red-600">
                    {result.validation.errors.map((e, i) => (
                      <li key={i}>{e.message}</li>
                    ))}
                  </ul>
                </div>
              )}

              {result.validation.warnings.length > 0 && (
                <div className="mt-1">
                  <span className="font-medium">
                    경고 {result.validation.warnings.length}건:
                  </span>
                  <ul className="list-disc list-inside ml-2">
                    {result.validation.warnings.map((w, i) => (
                      <li key={i}>{w.message}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 하단 네비게이션 */}
      <div className="flex justify-between pt-2">
        <button
          type="button"
          onClick={() => navigate('/analyze')}
          className="px-5 py-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors text-sm font-medium"
        >
          이전: 데이터 분석
        </button>
        <button
          type="button"
          onClick={() => navigate('/review')}
          disabled={!canProceed}
          className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm font-medium"
        >
          다음: 결과 검토
        </button>
      </div>
    </div>
  );
}
