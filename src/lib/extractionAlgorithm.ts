import type {
  Parcel,
  ExtractionConfig,
  ExtractionResult,
  RiStat,
  FarmerStat,
  ValidationResult,
  ValidationMessage,
  SpatialConfig,
} from '../types';
import { calculateDensity, clusterParcelsInRi, findDistantRis, findDistantPairs, haversineDistance } from './spatialUtils';

/**
 * 시드 기반 의사 난수 생성기 (Mulberry32)
 */
function createRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 시드 기반 배열 셔플 (Fisher-Yates)
 */
function shuffle<T>(array: T[], rng: () => number): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * 배열을 키 기준으로 그룹핑
 */
function groupBy<T>(array: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const item of array) {
    const key = keyFn(item);
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  return groups;
}

/**
 * 밀집도 기반 가중 추출 (공간 필터 활성화 시 사용)
 */
function extractWithDensity(
  pool: Parcel[],
  target: number,
  spatialConfig: SpatialConfig,
  rng: () => number
): Parcel[] {
  // 좌표 있는 필지와 없는 필지 분리
  const withCoords = pool.filter(p => p.coords != null);
  const withoutCoords = pool.filter(p => p.coords == null);

  // 클러스터링으로 밀집 지역 식별
  const clusters = clusterParcelsInRi(withCoords, spatialConfig.maxParcelDistanceKm);

  // 큰 클러스터 우선, 클러스터 내에서 밀집도 높은 필지 우선
  clusters.sort((a, b) => b.length - a.length);

  const maxDistKm = spatialConfig.maxParcelDistanceKm;
  const selected: Parcel[] = [];

  for (const cluster of clusters) {
    if (selected.length >= target) break;

    // 이미 선택된 필지가 있으면, 이 클러스터가 거리 내 연결 가능한지 확인
    if (selected.length > 0) {
      const isConnected = cluster.some(cp =>
        cp.coords && selected.some(s =>
          s.coords && haversineDistance(s.coords, cp.coords!) <= maxDistKm
        )
      );
      if (!isConnected) continue; // 멀리 떨어진 클러스터 건너뜀
    }

    // 밀집도 점수 계산 후 가중 정렬
    const scored = cluster.map(p => ({
      parcel: p,
      density: calculateDensity(p, withCoords, maxDistKm)
    }));

    // densityWeight로 가중: 높으면 밀집도 우선, 낮으면 랜덤에 가까움
    scored.sort((a, b) => {
      const densityDiff = b.density - a.density;
      const randomFactor = (rng() - 0.5) * 2 * (1 - spatialConfig.densityWeight);
      return densityDiff * spatialConfig.densityWeight + randomFactor;
    });

    for (const { parcel } of scored) {
      if (selected.length >= target) break;
      // 하드 거리 필터: 선택된 필지 중 하나라도 maxDistKm 이내여야 함
      if (selected.length > 0 && parcel.coords) {
        const isClose = selected.some(s =>
          s.coords && haversineDistance(s.coords, parcel.coords!) <= maxDistKm
        );
        if (!isClose) continue;
      }
      selected.push(parcel);
    }
  }

  // 좌표 없는 필지는 마지막에 추가 (부족할 경우)
  if (selected.length < target) {
    const shuffledNoCoords = shuffle(withoutCoords, rng);
    for (const p of shuffledNoCoords) {
      if (selected.length >= target) break;
      selected.push(p);
    }
  }

  return selected;
}

/**
 * 리(里)에서 농가 제한을 적용하여 필지 추출
 */
function extractFromRi(
  parcels: Parcel[],
  target: number,
  config: ExtractionConfig,
  rng: () => number
): Parcel[] {
  const spatialConfig = config.spatialConfig;
  const hasCoords = parcels.some(p => p.coords != null);

  // 농가별 그룹핑 → 농가당 최대 제한 적용 (기존 로직)
  const farmerGroups = groupBy(parcels, p => p.farmerId);
  const pool: Parcel[] = [];
  for (const farmerParcels of Object.values(farmerGroups)) {
    const shuffled = shuffle(farmerParcels, rng);
    pool.push(...shuffled.slice(0, config.maxPerFarmer));
  }

  // 공간 필터가 활성화되고 좌표가 있으면 밀집도 기반 추출
  if (spatialConfig?.enableSpatialFilter && hasCoords) {
    return extractWithDensity(pool, target, spatialConfig, rng);
  }

  // 기존 로직: 단순 셔플 후 슬라이스
  return shuffle(pool, rng).slice(0, target);
}

/**
 * 메인 추출 함수
 * - Step 1: 추출 가능 필지만 필터링
 * - Step 2: 리별 그룹핑
 * - Step 3: 각 리에서 목표 수만큼 추출
 * - Step 4: 미달 시 보충
 * - Step 5: 검증
 */
export function extractParcels(
  allParcels: Parcel[],
  config: ExtractionConfig
): ExtractionResult {
  const seed = config.randomSeed ?? Date.now();
  const rng = createRng(seed);

  // Step 1: 추출 가능 필지만 필터링
  let candidates = allParcels.filter(
    p => p.isEligible && !config.excludedRis.includes(p.ri)
  );

  // Step 1-1: 공간 필터 활성화 시 먼 리 자동 제외
  if (config.spatialConfig?.enableSpatialFilter) {
    const distantRis = findDistantRis(candidates, config.spatialConfig.maxRiDistanceKm || undefined);
    // 자동 감지된 먼 리도 제외 (이미 excludedRis에 없는 것만)
    candidates = candidates.filter(p => !distantRis.includes(p.ri) || config.excludedRis.includes(p.ri));
    // 주의: excludedRis에 이미 있는 건 위에서 이미 제외됨. 여기서는 distantRis를 추가로 제외
  }

  // Step 2: 리별 그룹핑
  const riGroups = groupBy(candidates, p => p.ri);
  const selected: Parcel[] = [];

  // Step 3: 리별 추출
  for (const [ri, parcels] of Object.entries(riGroups)) {
    const target = config.riTargetOverrides[ri] ?? config.perRiTarget;
    const riSelected = extractFromRi(parcels, target, config, rng);
    selected.push(...riSelected);
  }

  // Step 4: 미달 보충 (거리 필터 적용)
  if (selected.length < config.totalTarget && config.underfillPolicy === 'supplement') {
    const useSpatialFilter = config.spatialConfig?.enableSpatialFilter ?? false;
    const maxDistKm = config.spatialConfig?.maxParcelDistanceKm ?? Infinity;

    const selectedKeySet = new Set(selected.map(p => `${p.farmerId}_${p.parcelId}`));
    const remaining = candidates.filter(p => !selectedKeySet.has(`${p.farmerId}_${p.parcelId}`));

    // 가용 필지 많은 리부터 보충
    const remainingByRi = groupBy(remaining, p => p.ri);
    const sortedRis = Object.entries(remainingByRi)
      .sort((a, b) => b[1].length - a[1].length);

    for (const [, riParcels] of sortedRis) {
      if (selected.length >= config.totalTarget) break;

      const farmerCounts: Record<string, number> = {};
      for (const s of selected) {
        farmerCounts[s.farmerId] = (farmerCounts[s.farmerId] ?? 0) + 1;
      }

      const shuffled = shuffle(riParcels, rng);
      for (const p of shuffled) {
        if (selected.length >= config.totalTarget) break;
        const currentCount = farmerCounts[p.farmerId] ?? 0;
        if (currentCount >= config.maxPerFarmer) continue;

        // 공간 필터 활성화 시 거리 체크
        if (useSpatialFilter && p.coords && selected.some(s => s.coords)) {
          const isClose = selected.some(s =>
            s.coords && haversineDistance(s.coords, p.coords!) <= maxDistKm
          );
          if (!isClose) continue;
        }

        selected.push(p);
        farmerCounts[p.farmerId] = currentCount + 1;
      }
    }
  }

  // 선택 마킹
  const markedParcels = selected.map(p => ({ ...p, isSelected: true }));

  // 통계 생성
  const riStats = generateRiStats(allParcels, markedParcels, config);
  const farmerStats = generateFarmerStats(markedParcels);
  const validation = validateExtraction(markedParcels, config, riStats);

  return {
    selectedParcels: markedParcels,
    riStats,
    farmerStats,
    validation,
  };
}

/**
 * 리별 통계 생성
 */
function generateRiStats(
  allParcels: Parcel[],
  selectedParcels: Parcel[],
  config: ExtractionConfig
): RiStat[] {
  const allByRi = groupBy(allParcels, p => p.ri);
  const selectedByRi = groupBy(selectedParcels, p => p.ri);

  return Object.entries(allByRi).map(([ri, parcels]) => ({
    ri,
    totalCount: parcels.length,
    eligibleCount: parcels.filter(p => p.isEligible).length,
    selectedCount: (selectedByRi[ri] ?? []).length,
    targetCount: config.riTargetOverrides[ri] ?? config.perRiTarget,
  }));
}

/**
 * 농가별 통계 생성
 */
function generateFarmerStats(selectedParcels: Parcel[]): FarmerStat[] {
  const byFarmer = groupBy(selectedParcels, p => p.farmerId);

  return Object.entries(byFarmer).map(([farmerId, parcels]) => ({
    farmerId,
    farmerName: parcels[0].farmerName,
    totalParcels: parcels.length,
    selectedParcels: parcels.length,
  }));
}

/**
 * 추출 결과 검증
 */
function validateExtraction(
  selectedParcels: Parcel[],
  config: ExtractionConfig,
  riStats: RiStat[]
): ValidationResult {
  const errors: ValidationMessage[] = [];
  const warnings: ValidationMessage[] = [];

  // 총 추출 수 검증
  if (selectedParcels.length !== config.totalTarget) {
    const level = Math.abs(selectedParcels.length - config.totalTarget) > 10 ? errors : warnings;
    level.push({
      code: 'TOTAL_MISMATCH',
      message: `총 추출 수가 목표(${config.totalTarget})와 다릅니다: ${selectedParcels.length}개`,
    });
  }

  // 농가당 최대 제한 검증
  const farmerCounts: Record<string, number> = {};
  for (const p of selectedParcels) {
    farmerCounts[p.farmerId] = (farmerCounts[p.farmerId] ?? 0) + 1;
  }
  const overLimitFarmers = Object.entries(farmerCounts).filter(([, c]) => c > config.maxPerFarmer);
  if (overLimitFarmers.length > 0) {
    errors.push({
      code: 'FARMER_OVER_LIMIT',
      message: `농가당 ${config.maxPerFarmer}개 초과 필지가 있습니다: ${overLimitFarmers.length}개 농가`,
      details: overLimitFarmers.map(([id]) => id).join(', '),
    });
  }

  // 리당 미달 검증
  const underfilledRis = riStats.filter(r => r.selectedCount < r.targetCount && r.eligibleCount >= r.targetCount);
  if (underfilledRis.length > 0) {
    warnings.push({
      code: 'RI_UNDERFILL',
      message: `${underfilledRis.length}개 리(里)에서 목표 미달`,
      details: underfilledRis.map(r => `${r.ri}: ${r.selectedCount}/${r.targetCount}`).join(', '),
    });
  }

  // 공간 필터 검증: maxParcelDistanceKm 초과 필지 쌍 경고
  if (config.spatialConfig?.enableSpatialFilter) {
    const distantPairs = findDistantPairs(
      selectedParcels.filter(p => p.coords != null),
      config.spatialConfig.maxParcelDistanceKm
    );
    if (distantPairs.length > 0) {
      warnings.push({
        code: 'DISTANT_PARCELS',
        message: `${distantPairs.length}쌍의 필지가 ${config.spatialConfig.maxParcelDistanceKm}km 초과 거리입니다`,
        details: distantPairs.slice(0, 5).map(d =>
          `${d.a.ri} ${d.a.parcelId} ↔ ${d.b.ri} ${d.b.parcelId}: ${d.distKm.toFixed(1)}km`
        ).join(', '),
      });
    }
  }

  // 중복 체크 (2024/2025 채취 필지가 포함되었는지)
  const sampledIncluded = selectedParcels.filter(p => p.sampledYears.length > 0);
  if (sampledIncluded.length > 0) {
    errors.push({
      code: 'SAMPLED_INCLUDED',
      message: `2024/2025 채취 필지가 ${sampledIncluded.length}건 포함되었습니다`,
    });
  }

  return {
    isValid: errors.length === 0,
    warnings,
    errors,
  };
}
