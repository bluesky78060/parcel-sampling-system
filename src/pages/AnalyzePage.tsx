import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFileStore } from '../store/fileStore';
import { useParcelStore } from '../store/parcelStore';
import { applyColumnMapping } from '../lib/excelParser';
import { markEligibility } from '../lib/duplicateDetector';
import { findDistantRis, calculateRiCentroids, calculateCentroid, haversineDistance } from '../lib/spatialUtils';
import { useGeocoding } from '../hooks/useGeocoding';
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

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [distantRis, setDistantRis] = useState<DistantRiInfo[]>([]);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const masterFile = files.find((f) => f.role === 'master');
  const sampled2024 = files.find((f) => f.year === 2024 && f.role === 'sampled');
  const sampled2025 = files.find((f) => f.year === 2025 && f.role === 'sampled');

  // 파일 없으면 업로드 페이지로
  useEffect(() => {
    if (!masterFile) {
      navigate('/upload');
      return;
    }
  }, [masterFile, navigate]);

  // 매핑 안 된 파일 있으면 매핑 페이지로
  useEffect(() => {
    const unmapped = files.filter((f) => f.status === 'pending');
    if (files.length > 0 && unmapped.length > 0) {
      navigate('/mapping');
    }
  }, [files, navigate]);

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

      // 3. parcelStore에 저장
      parcelStore.setAllParcels(markedParcels);
      parcelStore.setSampled2024(parcels2024);
      parcelStore.setSampled2025(parcels2025);
      parcelStore.calculateStatistics();

      setHasAnalyzed(true);

      // 4. Geocoding (API 키가 있으면)
      if (geocoding.isAvailable) {
        const eligibleParcels = markedParcels.filter((p) => p.isEligible);
        const geocodedParcels = await geocoding.startGeocoding(eligibleParcels);

        // geocoded 결과를 마스터에 반영
        const geocodedMap = new Map<string, Parcel>();
        for (const gp of geocodedParcels) {
          const key = `${gp.farmerId}_${gp.parcelId}_${gp.address}`;
          geocodedMap.set(key, gp);
        }

        const updatedParcels = markedParcels.map((p) => {
          const key = `${p.farmerId}_${p.parcelId}_${p.address}`;
          const geocoded = geocodedMap.get(key);
          return geocoded ? { ...p, coords: geocoded.coords } : p;
        });

        parcelStore.updateParcels(updatedParcels);

        // 먼 거리 리 감지
        computeDistantRis(updatedParcels);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '분석 중 오류가 발생했습니다.';
      setAnalysisError(message);
    } finally {
      setIsAnalyzing(false);
    }
  }, [masterFile, sampled2024, sampled2025, parcelStore, geocoding, computeDistantRis]);

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
          <StatsDashboard statistics={statistics} />

          {/* Geocoding 진행률 */}
          <GeocodingProgress
            done={geocoding.state.progress.done}
            total={geocoding.state.progress.total}
            failed={geocoding.state.progress.failed}
            isRunning={geocoding.state.isRunning}
          />

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

          {/* 먼 거리 리 경고 */}
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
