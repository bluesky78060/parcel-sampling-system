import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFileStore } from '../store/fileStore';
import { useParcelStore } from '../store/parcelStore';
import { useExtractionStore } from '../store/extractionStore';
import { applyColumnMapping } from '../lib/excelParser';
import { markEligibility } from '../lib/duplicateDetector';
import { findDistantRis, calculateRiCentroids, calculateCentroid, haversineDistance } from '../lib/spatialUtils';
import { useGeocoding } from '../hooks/useGeocoding';
import { clearGeocodeCache } from '../lib/kakaoGeocoder';
import { generatePnuForParcels } from '../lib/pnuGenerator';
import { StatsDashboard } from '../components/Analysis/StatsDashboard';
import { RiDistributionChart } from '../components/Analysis/RiDistributionChart';
import { GeocodingProgress } from '../components/Analysis/GeocodingProgress';
import type { Parcel } from '../types';

interface DistantRiInfo {
  ri: string;
  distKm: number;
}

export function AnalyzePage() {
  const navigate = useNavigate();
  const { files } = useFileStore();
  const parcelStore = useParcelStore();
  const geocoding = useGeocoding();
  const { config: extractionConfig } = useExtractionStore();

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [distantRis, setDistantRis] = useState<DistantRiInfo[]>([]);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // PNU 생성 상태
  const [pnuGenResult, setPnuGenResult] = useState<{
    generated: number;
    skipped: number;
    errors: string[];
  } | null>(null);
  const [isGeneratingPnu, setIsGeneratingPnu] = useState(false);

  const masterFile = files.find((f) => f.role === 'master');
  const sampled2024 = files.find((f) => f.year === 2024 && f.role === 'sampled');
  const sampled2025 = files.find((f) => f.year === 2025 && f.role === 'sampled');
  const representativeFile = files.find((f) => f.role === 'representative');

  // 파일 없으면 업로드 페이지로 (마운트 시 1회만)
  useEffect(() => {
    if (!masterFile) {
      navigate('/upload');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 매핑 안 된 파일 있으면 매핑 페이지로 (마운트 시 1회만)
  useEffect(() => {
    const unmapped = files.filter((f) => f.status === 'pending');
    if (files.length > 0 && unmapped.length > 0) {
      navigate('/mapping');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const computeDistantRis = useCallback((parcels: Parcel[]) => {
    const geocodedParcels = parcels.filter((p) => p.coords != null);
    if (geocodedParcels.length === 0) {
      setDistantRis([]);
      return;
    }

    const centroid = calculateCentroid(geocodedParcels);
    if (!centroid) {
      setDistantRis([]);
      return;
    }

    const distantRiNames = findDistantRis(geocodedParcels);
    if (distantRiNames.length === 0) {
      setDistantRis([]);
      return;
    }

    const riCentroids = calculateRiCentroids(geocodedParcels);
    const distantRiInfos: DistantRiInfo[] = distantRiNames
      .map((ri) => ({
        ri,
        distKm: riCentroids[ri] ? haversineDistance(centroid, riCentroids[ri]) : 0,
      }))
      .sort((a, b) => b.distKm - a.distKm);

    setDistantRis(distantRiInfos);
  }, []);

  const runAnalysis = useCallback(async () => {
    if (!masterFile?.rawData || !masterFile.columnMapping) return;

    setIsAnalyzing(true);
    setAnalysisError(null);

    try {
      // 1. 컬럼 매핑 적용하여 Parcel 배열 생성
      const masterParcels = applyColumnMapping(
        masterFile.rawData,
        masterFile.columnMapping,
        masterFile.filename
      );

      const parcels2024 = sampled2024?.rawData
        ? applyColumnMapping(
            sampled2024.rawData,
            sampled2024.columnMapping,
            sampled2024.filename,
            2024
          )
        : [];

      const parcels2025 = sampled2025?.rawData
        ? applyColumnMapping(
            sampled2025.rawData,
            sampled2025.columnMapping,
            sampled2025.filename,
            2025
          )
        : [];

      // 2. 중복 감지 및 적격 마킹
      const markedParcels = markEligibility(masterParcels, parcels2024, parcels2025);

      // 3. 대표필지 파싱 (있을 경우)
      const repParcels = representativeFile?.rawData
        ? applyColumnMapping(
            representativeFile.rawData,
            representativeFile.columnMapping,
            representativeFile.filename,
            undefined,
            'representative'
          ).map(p => ({
            ...p,
            isEligible: true,
            isSelected: true,
            sampledYears: [] as number[],
          }))
        : [];

      // 4. parcelStore에 저장
      parcelStore.setAllParcels(markedParcels);
      parcelStore.setSampled2024(parcels2024);
      parcelStore.setSampled2025(parcels2025);
      parcelStore.setRepresentativeParcels(repParcels);
      parcelStore.calculateStatistics(extractionConfig.totalTarget);

      setHasAnalyzed(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : '분석 중 오류가 발생했습니다.';
      setAnalysisError(message);
    } finally {
      setIsAnalyzing(false);
    }
  }, [masterFile, sampled2024, sampled2025, representativeFile, parcelStore, extractionConfig.totalTarget]);

  // 좌표 변환 (사용자 수동 실행)
  const runGeocoding = useCallback(async () => {
    if (!geocoding.isAvailable) return;
    setAnalysisError(null);

    try {
      // 공익직불제 eligible + 대표필지 모두 Geocoding 대상
      const eligibleParcels = parcelStore.allParcels.filter((p) => p.isEligible);
      const repParcels = parcelStore.representativeParcels;
      const allForGeocoding = [...eligibleParcels, ...repParcels];
      if (allForGeocoding.length === 0) return;

      const geocodedParcels = await geocoding.startGeocoding(allForGeocoding);

      const geocodedMap = new Map<string, Parcel>();
      for (const gp of geocodedParcels) {
        const key = `${gp.farmerId}_${gp.parcelId}_${gp.address}`;
        geocodedMap.set(key, gp);
      }

      // 공익직불제 필지 좌표 업데이트
      const updatedParcels = parcelStore.allParcels.map((p) => {
        const key = `${p.farmerId}_${p.parcelId}_${p.address}`;
        const geocoded = geocodedMap.get(key);
        return geocoded ? { ...p, coords: geocoded.coords } : p;
      });
      parcelStore.updateParcels(updatedParcels);

      // 대표필지 좌표 업데이트
      if (repParcels.length > 0) {
        const updatedRep = repParcels.map((p) => {
          const key = `${p.farmerId}_${p.parcelId}_${p.address}`;
          const geocoded = geocodedMap.get(key);
          return geocoded ? { ...p, coords: geocoded.coords } : p;
        });
        parcelStore.setRepresentativeParcels(updatedRep);
      }

      computeDistantRis(updatedParcels);
    } catch (err) {
      const geoMessage = err instanceof Error ? err.message : 'Geocoding 중 오류';
      console.warn('[분석] Geocoding 오류:', geoMessage);
      setAnalysisError(`좌표 변환 오류: ${geoMessage}\n(분석 결과와 추출 기능은 정상 작동합니다)`);
    }
  }, [parcelStore, geocoding, computeDistantRis]);

  // 좌표 재변환 (캐시 초기화 후 강제 재실행)
  const rerunGeocoding = useCallback(async () => {
    if (!geocoding.isAvailable) return;
    setAnalysisError(null);

    try {
      clearGeocodeCache();
      geocoding.resetState();

      const eligibleParcels = parcelStore.allParcels.filter((p) => p.isEligible);
      const repParcels = parcelStore.representativeParcels;
      const allForGeocoding = [...eligibleParcels, ...repParcels];
      if (allForGeocoding.length === 0) return;

      const geocodedParcels = await geocoding.startGeocoding(allForGeocoding, true);

      const geocodedMap = new Map<string, Parcel>();
      for (const gp of geocodedParcels) {
        const key = `${gp.farmerId}_${gp.parcelId}_${gp.address}`;
        geocodedMap.set(key, gp);
      }

      const updatedParcels = parcelStore.allParcels.map((p) => {
        const key = `${p.farmerId}_${p.parcelId}_${p.address}`;
        const geocoded = geocodedMap.get(key);
        return geocoded ? { ...p, coords: geocoded.coords } : p;
      });
      parcelStore.updateParcels(updatedParcels);

      if (repParcels.length > 0) {
        const updatedRep = repParcels.map((p) => {
          const key = `${p.farmerId}_${p.parcelId}_${p.address}`;
          const geocoded = geocodedMap.get(key);
          return geocoded ? { ...p, coords: geocoded.coords } : p;
        });
        parcelStore.setRepresentativeParcels(updatedRep);
      }

      computeDistantRis(updatedParcels);
    } catch (err) {
      const geoMessage = err instanceof Error ? err.message : 'Geocoding 중 오류';
      console.warn('[분석] Geocoding 재변환 오류:', geoMessage);
      setAnalysisError(`좌표 재변환 오류: ${geoMessage}`);
    }
  }, [parcelStore, geocoding, computeDistantRis]);

  // PNU 코드 자동 생성
  const runPnuGeneration = useCallback((overwrite = false) => {
    setIsGeneratingPnu(true);
    setPnuGenResult(null);

    try {
      // 공익직불제 필지 PNU 생성
      const { updated: updatedAll, result: resultAll } = generatePnuForParcels(
        parcelStore.allParcels,
        overwrite
      );
      parcelStore.updateParcels(updatedAll);

      // 대표필지 PNU 생성
      let repGenerated = 0;
      if (parcelStore.representativeParcels.length > 0) {
        const { updated: updatedRep, result: resultRep } = generatePnuForParcels(
          parcelStore.representativeParcels,
          overwrite
        );
        parcelStore.setRepresentativeParcels(updatedRep);
        repGenerated = resultRep.generated;
      }

      setPnuGenResult({
        generated: resultAll.generated + repGenerated,
        skipped: resultAll.skipped,
        errors: [...new Set(resultAll.errors)].slice(0, 10),
      });
    } finally {
      setIsGeneratingPnu(false);
    }
  }, [parcelStore]);

  // 이미 분석된 상태면 재분석 없이 바로 표시
  useEffect(() => {
    if (parcelStore.allParcels.length > 0) {
      setHasAnalyzed(true);
      // 좌표가 있으면 먼 리 감지
      computeDistantRis(parcelStore.allParcels);
    }
  }, [parcelStore.allParcels, computeDistantRis]);

  const statistics = parcelStore.statistics;
  const riDistribution = parcelStore.getRiDistribution();

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">데이터 분석</h2>
        <p className="text-gray-500 mt-1">업로드된 파일을 분석하고 Geocoding을 수행합니다.</p>
      </div>

      {/* 분석 시작 / 재분석 버튼 */}
      <div className="flex items-center gap-3">
        {!hasAnalyzed && !isAnalyzing && (
          <button
            onClick={runAnalysis}
            disabled={!masterFile?.rawData}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
            분석 시작
          </button>
        )}

        {isAnalyzing && (
          <div className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-100 text-blue-700 text-sm font-medium rounded-lg">
            <svg
              className="w-4 h-4 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            분석 중...
          </div>
        )}

        {hasAnalyzed && !isAnalyzing && (
          <button
            onClick={() => {
              parcelStore.reset();
              setHasAnalyzed(false);
              setDistantRis([]);
              setAnalysisError(null);
              runAnalysis();
            }}
            className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            재분석
          </button>
        )}
      </div>

      {/* 오류 메시지 */}
      {analysisError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <div className="flex items-start gap-2">
            <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{analysisError}</span>
          </div>
        </div>
      )}

      {/* 분석 결과 */}
      {hasAnalyzed && statistics && (
        <>
          {/* 통계 대시보드 */}
          <StatsDashboard statistics={statistics} totalTarget={extractionConfig.totalTarget} />

          {/* 먼 거리 리 경고 - 통계 대시보드 바로 아래 */}
          {distantRis.length > 0 && (
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
              <div className="flex items-start gap-2 mb-2">
                <svg className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <p className="text-sm font-semibold text-yellow-800">먼 거리 리 감지</p>
                  <p className="text-xs text-yellow-700 mt-0.5">
                    다음 리는 주요 지역에서 먼 거리에 있어 추출에서 제외를 권장합니다:
                  </p>
                </div>
              </div>
              <ul className="ml-7 flex flex-wrap gap-x-6 gap-y-1">
                {distantRis.map(({ ri, distKm }) => (
                  <li key={ri} className="text-sm text-yellow-800">
                    - {ri}{' '}
                    <span className="text-yellow-600">({distKm.toFixed(1)}km)</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* PNU 코드 자동 생성 */}
          <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-indigo-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-indigo-800">PNU 코드 자동 생성</p>
                  <p className="text-xs text-indigo-600">
                    읍면동·리·본번·부번 정보로 19자리 PNU 코드를 생성합니다. (봉화군 전용)
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                {pnuGenResult && (
                  <button
                    onClick={() => runPnuGeneration(true)}
                    disabled={isGeneratingPnu}
                    className="inline-flex items-center gap-1.5 px-3 py-2 border border-indigo-300 text-indigo-700 text-sm font-medium rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    전체 재생성
                  </button>
                )}
                <button
                  onClick={() => runPnuGeneration(false)}
                  disabled={isGeneratingPnu}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  {isGeneratingPnu ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      생성 중...
                    </>
                  ) : (
                    <>PNU 생성</>
                  )}
                </button>
              </div>
            </div>

            {/* PNU 생성 결과 */}
            {pnuGenResult && (
              <div className="mt-3 pt-3 border-t border-indigo-200">
                <div className="flex items-center gap-4 text-sm">
                  <span className="inline-flex items-center gap-1 text-green-700">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    생성 {pnuGenResult.generated}건
                  </span>
                  {pnuGenResult.skipped > 0 && (
                    <span className="text-gray-500">
                      기존 유지 {pnuGenResult.skipped}건
                    </span>
                  )}
                  {pnuGenResult.errors.length > 0 && (
                    <span className="text-amber-600">
                      매핑 실패 {pnuGenResult.errors.length}건
                    </span>
                  )}
                </div>
                {pnuGenResult.errors.length > 0 && (
                  <details className="mt-2">
                    <summary className="text-xs text-amber-600 cursor-pointer hover:text-amber-700">
                      매핑 실패 상세 보기
                    </summary>
                    <ul className="mt-1 text-xs text-amber-700 space-y-0.5 ml-4">
                      {pnuGenResult.errors.map((err, i) => (
                        <li key={i}>- {err}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </div>

          {/* 좌표 변환 (수동 실행) */}
          {geocoding.isAvailable && !geocoding.state.isRunning && !geocoding.state.isComplete && (
            <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-blue-800">좌표 변환 (선택사항)</p>
                    <p className="text-xs text-blue-600">PNU 코드 기반으로 필지 좌표를 변환합니다. 지도 표시 및 공간 분석에 활용됩니다.</p>
                  </div>
                </div>
                <button
                  onClick={runGeocoding}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors flex-shrink-0 ml-4"
                >
                  좌표 변환 시작
                </button>
              </div>
            </div>
          )}

          {/* Geocoding 진행률 */}
          {(geocoding.state.isRunning || geocoding.state.isComplete) && (
            <div className="space-y-2">
              <GeocodingProgress
                done={geocoding.state.progress.done}
                total={geocoding.state.progress.total}
                failed={geocoding.state.progress.failed}
                isRunning={geocoding.state.isRunning}
                onCancel={geocoding.cancelGeocoding}
              />
              {geocoding.state.isComplete && !geocoding.state.isRunning && (
                <button
                  onClick={rerunGeocoding}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  캐시 초기화 및 좌표 재변환
                </button>
              )}
            </div>
          )}

          {/* Geocoding 오류 */}
          {geocoding.state.error && (
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
              <div className="flex items-start gap-2">
                <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>Geocoding 오류: {geocoding.state.error}</span>
              </div>
            </div>
          )}

          {/* 리별 분포 차트 */}
          <RiDistributionChart distribution={riDistribution} />
        </>
      )}

      {/* 네비게이션 버튼 */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
        <button
          onClick={() => navigate('/mapping')}
          className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          이전: 컬럼 매핑
        </button>

        <button
          onClick={() => navigate('/extract')}
          disabled={!hasAnalyzed}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          다음: 추출 설정
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
