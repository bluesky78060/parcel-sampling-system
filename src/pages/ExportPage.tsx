import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useParcelStore } from '../store/parcelStore';
import { useExtractionStore } from '../store/extractionStore';
import { useFileStore } from '../store/fileStore';
import { exportToExcel } from '../lib/excelExporter';

export function ExportPage() {
  const navigate = useNavigate();
  const { allParcels, representativeParcels, reset: resetParcel } = useParcelStore();
  const { result, config, reset: resetExtraction } = useExtractionStore();
  const { reset: resetFile } = useFileStore();
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    if (!result) {
      navigate('/extract');
    }
  }, [result, navigate]);

  if (!result) return null;

  const { selectedParcels, riStats, farmerStats, validation } = result;
  const spatialConfig = config.spatialConfig;

  // 제외된 필지: sampledYears.length > 0인 필지
  const excludedParcels = allParcels.filter((p) => p.sampledYears.length > 0);

  // 추출 결과 요약
  const totalSelected = selectedParcels.length;
  const uniqueRiCount = new Set(selectedParcels.map((p) => p.ri)).size;
  const avgPerRi = uniqueRiCount > 0 ? (totalSelected / uniqueRiCount).toFixed(1) : '0';
  const warningCount = validation.warnings.length;
  const hasErrors = validation.errors.length > 0;

  // 공간 필터: 제외된 리 (excludedRis)
  const excludedRiList = config.excludedRis;

  // 리별 분포 상위 10개 (추출 수 내림차순)
  const topRiStats = [...riStats]
    .sort((a, b) => b.selectedCount - a.selectedCount)
    .slice(0, 10);

  const publicPaymentCount = selectedParcels.filter(
    (p) => (p.parcelCategory ?? 'public-payment') !== 'representative'
  ).length;
  const repCount = selectedParcels.filter(
    (p) => (p.parcelCategory ?? 'public-payment') === 'representative'
  ).length;

  // 공익직불제 ↔ 대표필지 중복 키 계산
  const duplicateKeys = useMemo(() => {
    const repKeys = new Set<string>();
    for (const p of representativeParcels) {
      const key = p.pnu || `${p.address}__${p.parcelId}`;
      if (key) repKeys.add(key);
    }
    const dupKeys = new Set<string>();
    for (const p of allParcels) {
      const key = p.pnu || `${p.address}__${p.parcelId}`;
      if (key && repKeys.has(key)) dupKeys.add(key);
    }
    return dupKeys;
  }, [allParcels, representativeParcels]);

  const handleExport = () => {
    setExportError(null);
    try {
      exportToExcel({
        selectedParcels,
        representativeParcels,
        excludedParcels,
        allParcels,
        riStats,
        farmerStats,
        duplicateKeys,
      });
    } catch (err) {
      setExportError(err instanceof Error ? err.message : '엑셀 내보내기 중 오류가 발생했습니다.');
    }
  };

  const handleReset = () => {
    resetParcel();
    resetExtraction();
    resetFile();
    navigate('/upload');
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* 헤더 */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">결과 다운로드</h2>
        <p className="mt-1 text-gray-500">추출 결과를 엑셀 파일로 내보냅니다</p>
      </div>

      {/* 추출 결과 요약 */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-700">추출 결과 요약</h3>
        </div>
        <div className="px-4 py-4 space-y-2 text-sm text-gray-700">
          <div className="flex justify-between">
            <span className="text-gray-500">총 선택</span>
            <span className="font-medium">{totalSelected.toLocaleString()}필지</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">검증 상태</span>
            <span
              className={`font-medium ${hasErrors ? 'text-red-600' : 'text-green-600'}`}
            >
              {hasErrors ? '✗ 오류' : '✓ 통과'}
              {warningCount > 0 && (
                <span className="ml-1 text-yellow-600">(경고 {warningCount}건)</span>
              )}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">리(里) 수</span>
            <span className="font-medium">{uniqueRiCount}개</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">평균 리당 추출</span>
            <span className="font-medium">{avgPerRi}개</span>
          </div>
        </div>
      </div>

      {/* 공간 필터 요약 */}
      {spatialConfig && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
            <h3 className="text-sm font-semibold text-gray-700">공간 필터 요약</h3>
          </div>
          <div className="px-4 py-4 space-y-2 text-sm text-gray-700">
            <div className="flex justify-between">
              <span className="text-gray-500">공간 필터</span>
              <span
                className={`font-medium ${
                  spatialConfig.enableSpatialFilter ? 'text-blue-600' : 'text-gray-400'
                }`}
              >
                {spatialConfig.enableSpatialFilter ? '활성화' : '비활성화'}
              </span>
            </div>
            {spatialConfig.enableSpatialFilter && (
              <>
                <div className="flex justify-between">
                  <span className="text-gray-500">필지 간 최대 거리</span>
                  <span className="font-medium">{spatialConfig.maxParcelDistanceKm}km</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">밀집도 가중치</span>
                  <span className="font-medium">{spatialConfig.densityWeight}</span>
                </div>
                {excludedRiList.length > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">제외된 먼 리</span>
                    <span className="font-medium text-right max-w-xs">
                      {excludedRiList.join(', ')}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* 리별 분포 요약 */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-700">
            리별 분포 요약
            <span className="ml-1 text-gray-400 font-normal">(상위 10개 리)</span>
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-2 text-left font-medium text-gray-600">리명</th>
                <th className="px-4 py-2 text-right font-medium text-gray-600">추출 수</th>
                <th className="px-4 py-2 text-right font-medium text-gray-600">목표</th>
                <th className="px-4 py-2 text-right font-medium text-gray-600">달성률</th>
              </tr>
            </thead>
            <tbody>
              {topRiStats.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-4 text-center text-gray-400">
                    데이터가 없습니다
                  </td>
                </tr>
              ) : (
                topRiStats.map((stat, i) => {
                  const rate =
                    stat.targetCount > 0
                      ? Math.round((stat.selectedCount / stat.targetCount) * 100)
                      : 0;
                  return (
                    <tr
                      key={stat.ri}
                      className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                    >
                      <td className="px-4 py-2 text-gray-800">{stat.ri}</td>
                      <td className="px-4 py-2 text-right text-gray-800">
                        {stat.selectedCount}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-500">
                        {stat.targetCount}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <span
                          className={`font-medium ${
                            rate >= 100
                              ? 'text-green-600'
                              : rate >= 80
                              ? 'text-yellow-600'
                              : 'text-red-500'
                          }`}
                        >
                          {rate}%
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 다운로드 */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-700">다운로드</h3>
        </div>
        <div className="px-4 py-4">
          <p className="text-sm text-gray-500 mb-3">엑셀 파일 내용:</p>
          <ul className="space-y-1 text-sm text-gray-700 mb-6">
            <li>
              <span className="mr-2">📊</span>
              2026_필지선정 (공익직불제){' '}
              <span className="text-gray-400">({publicPaymentCount}행)</span>
            </li>
            {repCount > 0 && (
              <li>
                <span className="mr-2">📊</span>
                대표필지{' '}
                <span className="text-gray-400">({repCount}행)</span>
              </li>
            )}
            <li>
              <span className="mr-2">📊</span>
              리별_통계{' '}
              <span className="text-gray-400">({riStats.length}행)</span>
            </li>
            <li>
              <span className="mr-2">📊</span>
              농가별_통계
            </li>
            <li>
              <span className="mr-2">📊</span>
              제외필지
            </li>
            <li>
              <span className="mr-2">📊</span>
              전체필지 (구분 포함)
            </li>
          </ul>
          <div className="flex justify-center">
            <button
              onClick={handleExport}
              className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 active:bg-blue-800 transition-colors shadow-sm"
            >
              <span>📥</span>
              엑셀 다운로드
            </button>
          </div>
          {exportError && (
            <p className="mt-3 text-sm text-red-600 text-center">{exportError}</p>
          )}
        </div>
      </div>

      {/* 하단 네비게이션 */}
      <div className="flex justify-between items-center pb-6">
        <button
          onClick={() => navigate('/review')}
          className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <span>←</span>
          이전: 결과 검토
        </button>
        <button
          onClick={handleReset}
          className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <span>🔄</span>
          처음부터 다시
        </button>
      </div>
    </div>
  );
}
