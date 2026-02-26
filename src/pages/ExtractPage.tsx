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
import { LandCategorySettings } from '../components/Extraction/LandCategorySettings';

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
  const setLandCategoryRatio = useExtractionStore((s) => s.setLandCategoryRatio);
  const resetLandCategoryRatios = useExtractionStore((s) => s.resetLandCategoryRatios);
  const toggleLandCategoryFilter = useExtractionStore((s) => s.toggleLandCategoryFilter);
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

  // 지목별 필지 수 분포 (실지목 기준)
  const landCategoryDistribution = useMemo(() => {
    const dist: Record<string, number> = {};
    const eligible = allParcels.filter(
      (p) => p.isEligible && !config.excludedRis.includes(p.ri)
    );
    for (const p of eligible) {
      const cat = p.landCategoryActual || p.landCategoryOfficial || '미분류';
      dist[cat] = (dist[cat] ?? 0) + 1;
    }
    return dist;
  }, [allParcels, config.excludedRis]);

  const spatialConfig = config.spatialConfig!;

  const repCount = representativeParcels.length;

  // 공익직불제 ↔ 대표필지 중복 감지 (PNU 또는 주소+필지번호 기준)
  const duplicates = useMemo(() => {
    if (repCount === 0 || allParcels.length === 0) return { keys: new Set<string>(), count: 0 };

    // 대표필지 키 집합 생성
    const repKeys = new Set<string>();
    for (const p of representativeParcels) {
      const key = p.pnu || `${p.address}__${p.parcelId}`;
      if (key) repKeys.add(key);
    }

    // 공익직불제 필지 중 대표필지와 겹치는 키 찾기
    const dupKeys = new Set<string>();
    for (const p of allParcels) {
      const key = p.pnu || `${p.address}__${p.parcelId}`;
      if (key && repKeys.has(key)) dupKeys.add(key);
    }

    return { keys: dupKeys, count: dupKeys.size };
  }, [allParcels, representativeParcels, repCount]);

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

      {/* 지목별 비율 설정 */}
      <LandCategorySettings
        categoryDistribution={landCategoryDistribution}
        ratios={config.landCategoryRatios}
        enabled={config.enableLandCategoryFilter}
        onToggleEnabled={toggleLandCategoryFilter}
        onUpdateRatio={setLandCategoryRatio}
        onResetRatios={() => resetLandCategoryRatios(landCategoryDistribution)}
      />

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

      {/* 대표필지 정보 + 중복 경고 */}
      {repCount > 0 && (
        <div className="bg-emerald-50 rounded-lg border border-emerald-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-3 h-3 rounded-full bg-emerald-500 flex-shrink-0" />
            <h3 className="text-sm font-semibold text-emerald-800">대표필지 정보</h3>
          </div>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-emerald-600">업로드된 대표필지</span>
              <p className="font-semibold text-emerald-900">{repCount}개</p>
            </div>
            <div>
              <span className="text-emerald-600">추출 포함 목표</span>
              <p className="font-semibold text-emerald-900">
                {config.representativeTarget > 0 ? `${config.representativeTarget}개` : `전부 (${repCount}개)`}
              </p>
            </div>
            <div>
              <span className="text-emerald-600">공익직불제 추출 목표</span>
              <p className="font-semibold text-emerald-900">{config.publicPaymentTarget}개</p>
            </div>
          </div>

          {/* 중복 안내 */}
          {duplicates.count > 0 && (
            <div className="mt-3 rounded-md bg-blue-50 border border-blue-200 px-3 py-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-blue-800">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                중복 필지 {duplicates.count}건 (양쪽 모두 포함)
              </div>
              <p className="text-xs text-blue-700 mt-1">
                대표필지와 공익직불제에 동일한 필지가 {duplicates.count}건 있습니다.
                양쪽 모두 그대로 포함되며, 공익직불제는 목표 {config.publicPaymentTarget}개를 그대로 추출합니다.
                중복 필지의 경영체 정보는 마스터 파일 기준으로 채워집니다.
              </p>
            </div>
          )}

          {/* 제외 리 + 보충 안내 */}
          <div className="mt-3 rounded-md bg-gray-50 border border-gray-200 px-3 py-2">
            <p className="text-xs text-gray-600">
              공익직불제에서 제외된 리(里)에 속한 대표필지도 동일하게 제외되며, 부족분은 마스터 파일에서 공익직불제와 동일 조건으로 보충됩니다.
            </p>
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
