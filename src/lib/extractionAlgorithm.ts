import type {
  Parcel,
  LatLng,
  ExtractionConfig,
  ExtractionResult,
  RiStat,
  FarmerStat,
  ValidationResult,
  ValidationMessage,
  SpatialConfig,
} from '../types';
import { calculateDensity, clusterParcelsInRi, calculateRiCentroids, findDistantRis, findDistantPairs, haversineDistance } from './spatialUtils';

/**
 * 실지목 우선, 없으면 공부지목, 둘 다 없으면 '미분류'
 */
function getActualLandCategory(p: Parcel): string {
  return p.landCategoryActual || p.landCategoryOfficial || '미분류';
}

/** 최소 면적 기준 (㎡) */
export const MIN_AREA = 500;

/**
 * 필지 면적 가져오기 (area 필드 → rawData 폴백)
 * 면적 정보가 없으면 null 반환
 * 우선순위: 합산면적 > 전체면적 > 개별면적(노지) 순
 */
export function getParcelArea(p: Parcel): number | null {
  if (p.area != null && p.area > 0) return p.area;
  if (!p.rawData) return null;

  // 합산/전체 면적 키를 우선 탐색 (부분면적 제외)
  const areaKeys = ['재배면적(노지+시설)', '재배면적', '필지면적', '경작면적', '면적'];
  const rawKeys = Object.keys(p.rawData);

  // 1차: 정확 매칭
  for (const ak of areaKeys) {
    const v = p.rawData[ak];
    if (v != null) {
      const n = parseFloat(String(v));
      if (!isNaN(n) && n > 0) return n;
    }
  }

  // 2차: 공백 제거 매칭
  for (const ak of areaKeys) {
    const normAk = ak.replace(/\s/g, '');
    for (const rk of rawKeys) {
      if (rk.replace(/\s/g, '') === normAk) {
        const n = parseFloat(String(p.rawData[rk]));
        if (!isNaN(n) && n > 0) return n;
      }
    }
  }

  return null;
}

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
 * repCoords가 있으면 해당 좌표(대표필지) 근처 클러스터를 우선 선택
 */
function extractWithDensity(
  pool: Parcel[],
  target: number,
  spatialConfig: SpatialConfig,
  rng: () => number,
  repCoords?: LatLng[]
): Parcel[] {
  // 좌표 있는 필지와 없는 필지 분리
  const withCoords = pool.filter(p => p.coords != null);
  const withoutCoords = pool.filter(p => p.coords == null);

  // 클러스터링으로 밀집 지역 식별
  const clusters = clusterParcelsInRi(withCoords, spatialConfig.maxParcelDistanceKm);

  const maxDistKm = spatialConfig.maxParcelDistanceKm;

  // 클러스터 정렬: 대표필지 좌표가 있으면 대표필지 근처 클러스터 우선
  if (repCoords && repCoords.length > 0) {
    // 각 클러스터 → 대표필지까지의 최소 거리 계산
    clusters.sort((a, b) => {
      const minDistA = Math.min(...a.map(p =>
        Math.min(...repCoords.map(rc => haversineDistance(rc, p.coords!)))
      ));
      const minDistB = Math.min(...b.map(p =>
        Math.min(...repCoords.map(rc => haversineDistance(rc, p.coords!)))
      ));
      return minDistA - minDistB;  // 대표필지에 가까운 클러스터 우선
    });
  } else {
    // 대표필지 없으면 큰 클러스터 우선
    clusters.sort((a, b) => b.length - a.length);
  }

  const selected: Parcel[] = [];

  for (const cluster of clusters) {
    if (selected.length >= target) break;

    // 대표필지 좌표가 없을 때만 클러스터 연결 제약 적용
    // 대표필지가 있으면 대표필지 근처 클러스터는 서로 연결 안 되어도 포함
    if (!repCoords?.length && selected.length > 0) {
      const isConnected = cluster.some(cp =>
        cp.coords && selected.some(s =>
          s.coords && haversineDistance(s.coords, cp.coords!) <= maxDistKm
        )
      );
      if (!isConnected) continue;
    }

    // 밀집도 + 대표필지 근접도 점수 계산
    const scored = cluster.map(p => {
      const density = calculateDensity(p, withCoords, maxDistKm);
      // 대표필지 좌표가 있으면 근접도 보너스 (가까울수록 높은 점수)
      let repProximity = 0;
      if (repCoords && repCoords.length > 0 && p.coords) {
        const minRepDist = Math.min(...repCoords.map(rc => haversineDistance(rc, p.coords!)));
        repProximity = 1 / (minRepDist + 0.1);  // 0.1km 보정
      }
      return { parcel: p, density, repProximity };
    });

    // 정렬: 대표필지 근접도 + 밀집도 결합
    scored.sort((a, b) => {
      const repWeight = repCoords && repCoords.length > 0 ? 0.6 : 0;
      const densityWeight = 1 - repWeight;
      const scoreA = a.repProximity * repWeight + a.density * densityWeight;
      const scoreB = b.repProximity * repWeight + b.density * densityWeight;
      const scoreDiff = scoreB - scoreA;
      const randomFactor = (rng() - 0.5) * 2 * (1 - spatialConfig.densityWeight);
      return scoreDiff * spatialConfig.densityWeight + randomFactor;
    });

    for (const { parcel } of scored) {
      if (selected.length >= target) break;
      // 하드 거리 필터: 대표필지 없을 때만 적용
      if (!repCoords?.length && selected.length > 0 && parcel.coords) {
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
 * 공간 필터 활성화 시 밀집도 기반 정렬, 아니면 셔플
 */
function extractWithDensityOrShuffle(
  parcels: Parcel[],
  config: ExtractionConfig,
  rng: () => number,
  repCoords?: LatLng[]
): Parcel[] {
  const spatialConfig = config.spatialConfig;
  const hasCoords = parcels.some(p => p.coords != null);
  if (spatialConfig?.enableSpatialFilter && hasCoords) {
    return extractWithDensity(parcels, parcels.length, spatialConfig, rng, repCoords);
  }
  return shuffle(parcels, rng);
}

/**
 * 리(里)에서 농가 제한을 적용하여 필지 추출
 * - 공간 필터 활성화 시: 리 내부에서 대표필지 근처 밀집 필지 우선
 * - 비활성화 시: 단순 랜덤 셔플
 */
function extractFromRi(
  parcels: Parcel[],
  target: number,
  config: ExtractionConfig,
  rng: () => number,
  repCoords?: LatLng[]
): Parcel[] {
  const spatialConfig = config.spatialConfig;
  const hasCoords = parcels.some(p => p.coords != null);
  const repKeys = config.repParcelKeys;

  // 농가별 그룹핑 → 농가당 최대 제한 적용 (대표필지는 우선 포함)
  const farmerGroups = groupBy(parcels, p => p.farmerId);
  const pool: Parcel[] = [];
  for (const farmerParcels of Object.values(farmerGroups)) {
    if (repKeys && repKeys.size > 0) {
      // 대표필지를 앞에, 나머지를 뒤에 배치하여 maxPerFarmer 슬라이스 시 대표필지 우선
      const repFirst = farmerParcels.filter(p =>
        repKeys.has(p.pnu || `${p.address}__${p.parcelId}`) ||
        repKeys.has(`${p.farmerId}_${p.parcelId}`)
      );
      const rest = farmerParcels.filter(p =>
        !repKeys.has(p.pnu || `${p.address}__${p.parcelId}`) &&
        !repKeys.has(`${p.farmerId}_${p.parcelId}`)
      );
      pool.push(...[...repFirst, ...shuffle(rest, rng)].slice(0, config.maxPerFarmer));
    } else {
      const shuffled = shuffle(farmerParcels, rng);
      pool.push(...shuffled.slice(0, config.maxPerFarmer));
    }
  }

  // 대표필지를 먼저 선택하고, 나머지 목표를 밀집도 기반으로 채움
  const prioritized: Parcel[] = [];
  const remaining: Parcel[] = [];
  if (repKeys && repKeys.size > 0) {
    for (const p of pool) {
      const isRep = repKeys.has(p.pnu || `${p.address}__${p.parcelId}`) ||
        repKeys.has(`${p.farmerId}_${p.parcelId}`);
      if (isRep) {
        prioritized.push(p);
      } else {
        remaining.push(p);
      }
    }
  }

  // 대표필지 우선 포함 후 나머지 추출
  if (prioritized.length > 0) {
    const selected = prioritized.slice(0, target);
    const restTarget = target - selected.length;
    if (restTarget > 0) {
      if (spatialConfig?.enableSpatialFilter && hasCoords) {
        selected.push(...extractWithDensity(remaining, restTarget, spatialConfig, rng, repCoords));
      } else {
        selected.push(...shuffle(remaining, rng).slice(0, restTarget));
      }
    }
    return selected;
  }

  // 공간 필터 활성화 시: 리 내부 밀집도 + 대표필지 근접도 기반 추출
  if (spatialConfig?.enableSpatialFilter && hasCoords) {
    return extractWithDensity(pool, target, spatialConfig, rng, repCoords);
  }

  // 기본: 단순 셔플 후 슬라이스
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

  // Step 1b: 면적 500㎡ 미만 필지 제외
  const beforeAreaFilter = candidates.length;
  candidates = candidates.filter(p => {
    const area = getParcelArea(p);
    if (area === null) return true; // 면적 정보 없으면 제외하지 않음
    return area >= MIN_AREA;      // 0 포함, 500㎡ 미만 모두 제외
  });
  const areaExcluded = beforeAreaFilter - candidates.length;
  if (areaExcluded > 0) {
    console.info(`[추출] 면적 ${MIN_AREA}㎡ 미만 제외: ${areaExcluded}건`);
  }

  // Step 1-1: 먼 리 자동 제외
  const refCenter = config.referenceCentroid;

  if (config.spatialConfig?.enableSpatialFilter) {
    if (refCenter) {
      // 대표필지 중심 기준으로 먼 리 제외 (maxRiDistanceKm 사용, 0이면 자동 계산)
      const riCentroids = calculateRiCentroids(candidates.filter(p => p.coords != null));
      const riNames = Object.keys(riCentroids);
      const riDists = riNames.map(ri => ({
        ri,
        dist: haversineDistance(refCenter, riCentroids[ri]),
      }));

      let threshold = config.spatialConfig.maxRiDistanceKm;
      if (!threshold || threshold <= 0) {
        // 자동 계산: 대표필지 중심에서 리별 거리의 중위값 사용
        const dists = riDists.map(d => d.dist);

        if (dists.length > 0) {
          const sorted = [...dists].sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)];
          threshold = median;
        }
      }

      if (threshold && threshold > 0) {
        // 대표필지가 있는 리도 먼 리면 제외 (대표필지는 우선 선택일 뿐 고정이 아님)
        const distantRiNames = riDists
          .filter(d => d.dist > threshold!)
          .map(d => d.ri);
        if (distantRiNames.length > 0) {
          console.info(`[추출] 대표필지 기준 먼 리 제외 (임계값 ${threshold.toFixed(1)}km): ${distantRiNames.join(', ')}`);
          candidates = candidates.filter(p => !distantRiNames.includes(p.ri));
        }
      }
    } else {
      // 대표필지 없으면 기존 전체 중심 기준 먼 리 제외
      const distantRis = findDistantRis(candidates, config.spatialConfig.maxRiDistanceKm || undefined);
      candidates = candidates.filter(p => !distantRis.includes(p.ri));
    }
  }

  // Step 2: 리별 그룹핑
  const riGroups = groupBy(candidates, p => p.ri);
  const selected: Parcel[] = [];

  // Step 3: 리별 균등 추출 (각 리 내부에서 대표필지 근처 밀집 필지 우선)
  const repCoordsByRi = config.repCoordsByRi;
  const riNames = Object.keys(riGroups);
  for (const ri of riNames) {
    const target = config.riTargetOverrides[ri] ?? config.perRiTarget;
    const riRepCoords = repCoordsByRi?.[ri];
    const riSelected = extractFromRi(riGroups[ri], target, config, rng, riRepCoords);
    selected.push(...riSelected);
  }

  // Step 4: 미달 보충
  if (selected.length < config.totalTarget && config.underfillPolicy === 'supplement') {
    const useSpatialFilter = config.spatialConfig?.enableSpatialFilter ?? false;
    const maxDistKm = config.spatialConfig?.maxParcelDistanceKm ?? Infinity;

    const selectedKeySet = new Set(selected.map(p => `${p.farmerId}_${p.parcelId}`));
    const remaining = candidates.filter(p => !selectedKeySet.has(`${p.farmerId}_${p.parcelId}`));

    const remainingByRi = groupBy(remaining, p => p.ri);
    // 보충 시 대표필지 중심에 가까운 리부터 우선
    const riCentroidsForSupp = calculateRiCentroids(remaining.filter(p => p.coords != null));
    const sortedRis = Object.entries(remainingByRi)
      .sort((a, b) => {
        if (refCenter) {
          const distA = riCentroidsForSupp[a[0]]
            ? haversineDistance(refCenter, riCentroidsForSupp[a[0]])
            : Infinity;
          const distB = riCentroidsForSupp[b[0]]
            ? haversineDistance(refCenter, riCentroidsForSupp[b[0]])
            : Infinity;
          return distA - distB; // 가까운 리 우선
        }
        return b[1].length - a[1].length; // refCenter 없으면 기존 방식
      });

    for (const [suppRi, riParcels] of sortedRis) {
      if (selected.length >= config.totalTarget) break;

      const farmerCounts: Record<string, number> = {};
      for (const s of selected) {
        farmerCounts[s.farmerId] = (farmerCounts[s.farmerId] ?? 0) + 1;
      }

      // 밀집도 기반 추출로 보충 (리 내부 대표필지 근처 밀집 유지)
      const suppRepCoords = repCoordsByRi?.[suppRi];
      const supplemented = extractWithDensityOrShuffle(riParcels, config, rng, suppRepCoords);
      for (const p of supplemented) {
        if (selected.length >= config.totalTarget) break;
        const currentCount = farmerCounts[p.farmerId] ?? 0;
        if (currentCount >= config.maxPerFarmer) continue;

        if (useSpatialFilter && p.coords && selected.some(s => s.coords && s.ri === p.ri)) {
          const sameRiSelected = selected.filter(s => s.ri === p.ri && s.coords != null);
          const isClose = sameRiSelected.length === 0 || sameRiSelected.some(s =>
            haversineDistance(s.coords!, p.coords!) <= maxDistKm
          );
          if (!isClose) continue;
        }

        selected.push(p);
        farmerCounts[p.farmerId] = currentCount + 1;
      }
    }
  }

  // Step 5: 지목별 비율 필터 적용
  if (config.enableLandCategoryFilter && Object.keys(config.landCategoryRatios).length > 0) {
    applyLandCategoryRatios(selected, candidates, config, rng);
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

  // 지목별 비율 검증 (실지목 기준)
  if (config.enableLandCategoryFilter && Object.keys(config.landCategoryRatios).length > 0) {
    const catCounts: Record<string, number> = {};
    for (const p of selectedParcels) {
      const cat = getActualLandCategory(p);
      catCounts[cat] = (catCounts[cat] ?? 0) + 1;
    }
    const totalSelected = selectedParcels.length;
    const deviations: string[] = [];
    for (const [cat, targetRatio] of Object.entries(config.landCategoryRatios)) {
      if (targetRatio <= 0) continue;
      const actualCount = catCounts[cat] ?? 0;
      const actualRatio = totalSelected > 0 ? (actualCount / totalSelected) * 100 : 0;
      const diff = Math.abs(actualRatio - targetRatio);
      if (diff > 5) {
        deviations.push(`${cat}: 목표 ${targetRatio.toFixed(1)}% → 실제 ${actualRatio.toFixed(1)}%`);
      }
    }
    if (deviations.length > 0) {
      warnings.push({
        code: 'LAND_CATEGORY_DEVIATION',
        message: `${deviations.length}개 지목에서 비율 편차가 5%p 이상입니다`,
        details: deviations.join(', '),
      });
    }
  }

  return {
    isValid: errors.length === 0,
    warnings,
    errors,
  };
}

/**
 * 지목별 비율에 따라 선택된 필지를 조정
 * - 초과 지목에서 제거 → 미달 지목에서 보충
 */
function applyLandCategoryRatios(
  selected: Parcel[],
  candidates: Parcel[],
  config: ExtractionConfig,
  rng: () => number
): void {
  const ratios = config.landCategoryRatios;
  const totalTarget = config.totalTarget;
  const totalRatio = Object.values(ratios).reduce((s, r) => s + r, 0);
  if (totalRatio <= 0) return;

  // 지목별 목표 수 계산
  const categoryTargets: Record<string, number> = {};
  let assignedCount = 0;
  const entries = Object.entries(ratios).filter(([, r]) => r > 0);
  for (let i = 0; i < entries.length; i++) {
    const [cat, ratio] = entries[i];
    if (i === entries.length - 1) {
      // 마지막 지목은 나머지를 할당 (반올림 오차 방지)
      categoryTargets[cat] = totalTarget - assignedCount;
    } else {
      const t = Math.round((ratio / totalRatio) * totalTarget);
      categoryTargets[cat] = t;
      assignedCount += t;
    }
  }

  // 현재 선택된 필지의 지목별 그룹핑
  const selectedByCategory: Record<string, Parcel[]> = {};
  for (const p of selected) {
    const cat = getActualLandCategory(p);
    if (!selectedByCategory[cat]) selectedByCategory[cat] = [];
    selectedByCategory[cat].push(p);
  }

  // 선택되지 않은 후보 필지
  const selectedKeySet = new Set(selected.map(p => `${p.farmerId}_${p.parcelId}`));
  const remaining = candidates.filter(p => !selectedKeySet.has(`${p.farmerId}_${p.parcelId}`));
  const remainingByCategory: Record<string, Parcel[]> = {};
  for (const p of remaining) {
    const cat = getActualLandCategory(p);
    if (!remainingByCategory[cat]) remainingByCategory[cat] = [];
    remainingByCategory[cat].push(p);
  }

  // 초과 지목에서 제거
  const removed: Parcel[] = [];
  for (const [cat, target] of Object.entries(categoryTargets)) {
    const current = selectedByCategory[cat] ?? [];
    if (current.length > target) {
      const shuffled = shuffle(current, rng);
      const excess = shuffled.slice(target);
      removed.push(...excess);
      selectedByCategory[cat] = shuffled.slice(0, target);
    }
  }

  // 비율 목표에 없는 지목의 필지도 초과분으로 처리
  for (const [cat, parcels] of Object.entries(selectedByCategory)) {
    if (!(cat in categoryTargets)) {
      removed.push(...parcels);
      selectedByCategory[cat] = [];
    }
  }

  // selected 배열 재구성 (초과분 제거)
  const keptKeys = new Set<string>();
  for (const parcels of Object.values(selectedByCategory)) {
    for (const p of parcels) keptKeys.add(`${p.farmerId}_${p.parcelId}`);
  }

  // selected 배열에서 초과분 제거
  let i = selected.length;
  while (i--) {
    const key = `${selected[i].farmerId}_${selected[i].parcelId}`;
    if (!keptKeys.has(key)) {
      selected.splice(i, 1);
    }
  }

  // 미달 지목에서 보충
  for (const [cat, target] of Object.entries(categoryTargets)) {
    const current = (selectedByCategory[cat] ?? []).length;
    if (current < target) {
      const pool = remainingByCategory[cat] ?? [];
      // 제거된 필지 중 이 지목의 필지도 후보에 추가
      const removedOfCat = removed.filter(p => (getActualLandCategory(p)) === cat);
      const combinedPool = [...pool, ...removedOfCat];
      const shuffled = shuffle(combinedPool, rng);
      const need = target - current;
      let added = 0;
      for (let j = 0; j < shuffled.length && added < need; j++) {
        const p = shuffled[j];
        const key = `${p.farmerId}_${p.parcelId}`;
        if (!keptKeys.has(key)) {
          selected.push(p);
          keptKeys.add(key);
          added++;
        }
      }
    }
  }
}
