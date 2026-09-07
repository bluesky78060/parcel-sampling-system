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
import { calculateDensity, clusterParcelsInRi, calculateRiCentroids, findDistantRis, findDistantPairs, haversineDistance, meanPlusTwoSigma } from './spatialUtils';
import { parseNumericCell } from './excelParser';
import { parcelMatchKey, parcelFarmerKey } from './parcelKey';

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
      const n = parseNumericCell(v);
      if (!isNaN(n) && n > 0) return n;
    }
  }

  // 2차: 공백 제거 매칭
  for (const ak of areaKeys) {
    const normAk = ak.replace(/\s/g, '');
    for (const rk of rawKeys) {
      if (rk.replace(/\s/g, '') === normAk) {
        const n = parseNumericCell(p.rawData[rk]);
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
    // 각 클러스터 → 대표필지까지의 최소 거리를 정렬 '전에' 1회만 계산한다.
    // 비교자 안에서 계산하면 O(n log n · m)으로 같은 거리를 수없이 다시 재고,
    // Math.min(...arr) 스프레드는 클러스터가 크면 스택을 넘긴다.
    const minDistToRep = new Map<Parcel[], number>();
    for (const cluster of clusters) {
      let min = Infinity;
      for (const p of cluster) {
        if (!p.coords) continue;
        for (const rc of repCoords) {
          const d = haversineDistance(rc, p.coords);
          if (d < min) min = d;
        }
      }
      minDistToRep.set(cluster, min);
    }
    // 대표필지에 가까운 클러스터 우선.
    // min은 Infinity로 시작해 `d < min`일 때만 갱신되고 `NaN < x`는 항상
    // false이므로 min 자체는 NaN이 될 수 없다. 따라서 차가 NaN인 경우는
    // Infinity - Infinity 하나뿐이고, 그것은 실제로 동순위다(양쪽 다 유효한
    // 거리를 못 구한 클러스터). `|| 0`은 NaN을 덮는 눈가림이 아니라
    // 참인 동순위를 표현하는 것이며, 이렇게 해야 비교자가 전순서를 이룬다.
    clusters.sort((a, b) => {
      // 위에서 전 클러스터를 set했으므로 ?? 분기는 실제로는 미도달 — 타입 좁히기용
      const da = minDistToRep.get(a) ?? Infinity;
      const db = minDistToRep.get(b) ?? Infinity;
      return (da - db) || 0;
    });
  } else {
    // 대표필지 없으면 큰 클러스터 우선
    clusters.sort((a, b) => b.length - a.length);
  }

  const selected: Parcel[] = [];

  // 세 가중치는 클러스터와 무관한 상수다. 루프 안에 두면 클러스터마다
  // 달라지는 값처럼 읽힌다.
  // 주의: `densityShare`(밀집도 대 대표필지 근접도의 배분)와
  // `spatialConfig.densityWeight`(점수 대 노이즈의 배분)는 이름만 비슷할 뿐
  // 서로 다른 값이다.
  const repWeight = repCoords && repCoords.length > 0 ? 0.6 : 0;
  const densityShare = 1 - repWeight;
  const noiseWeight = 1 - spatialConfig.densityWeight;

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

    const scored = cluster.map(p => {
      const density = calculateDensity(p, withCoords, maxDistKm);
      // 대표필지 좌표가 있으면 근접도 보너스 (가까울수록 높은 점수)
      // 루프 형태라 NaN 거리는 건너뛴다. 구 Math.min(...)은 거리 하나만
      // NaN이어도 전체가 NaN이 되어 그 필지의 점수가 통째로 오염됐다.
      let repProximity = 0;
      if (repCoords && repCoords.length > 0 && p.coords) {
        let minRepDist = Infinity;
        for (const rc of repCoords) {
          const d = haversineDistance(rc, p.coords);
          if (d < minRepDist) minRepDist = d;
        }
        repProximity = 1 / (minRepDist + 0.1);  // 0.1km 보정
      }
      const score = repProximity * repWeight + density * densityShare;
      // 점수와 노이즈를 미리 하나의 순위 키로 합친다.
      // 진폭에 주의: 비교값에는 두 항목의 노이즈 '차'가 들어가므로,
      // 예전 비교자(노이즈 1회, 범위 ±noiseWeight)와 폭을 맞추려면
      // 항목별 노이즈를 절반 폭으로 뽑아야 한다.
      //
      // 지켜야 하는 것은 표준편차가 아니라 '지지집합'이다. 이 범위가
      // "점수 격차가 noiseWeight를 넘으면 노이즈로는 순위가 뒤집히지 않는다"는
      // 경계를 정하고, 그것이 densityWeight 슬라이더의 실질적 의미다.
      // `* 2`를 쓰면 격차가 noiseWeight를 넘는 쌍도 25% 확률로 뒤집혀
      // 구 코드에 없던 동작이 생긴다.
      //
      // 대가로 표준편차는 1/√2배(≈0.71배)가 된다(기본값 0.7에서 0.173→0.123).
      // 범위와 표준편차를 동시에 맞출 수는 없다 — i.i.d. 노이즈의 차는
      // 특성함수가 |φ(t)|² ≥ 0이라 음수 구간을 갖는 균등분포가 될 수 없다.
      // 원리적으로 불가능하므로 다시 시도하지 말 것.
      const rank = score * spatialConfig.densityWeight
        + (rng() - 0.5) * noiseWeight;
      return { parcel: p, rank };
    });

    // 정렬: 순위 키 내림차순 (순수 비교자 — 정렬 계약을 지키므로
    // 결과 순서가 엔진 구현과 무관하게 점수의 함수가 된다)
    scored.sort((a, b) => b.rank - a.rank);

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
 * 필지가 대표필지 키 셋에 해당하는지 판정
 * 경영체번호가 비어 있으면 `_필지번호` 형태의 키가 서로 충돌하므로 그 키는 쓰지 않는다.
 */
function matchesRepKeys(p: Parcel, repKeys: Set<string>): boolean {
  if (repKeys.has(parcelMatchKey(p))) return true;
  const fk = parcelFarmerKey(p);
  return fk !== null && repKeys.has(fk);
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
      const repFirst = farmerParcels.filter(p => matchesRepKeys(p, repKeys));
      const rest = farmerParcels.filter(p => !matchesRepKeys(p, repKeys));
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
      if (matchesRepKeys(p, repKeys)) {
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
        // 자동 계산: 평균 + 2σ.
        //
        // 예전에는 중위값을 썼다. 중위값은 정의상 절반을 넘기므로 **리가 아무리
        // 모여 있어도 항상 절반이 제외된다.** 봉화군 실측(71개 리, 리 중심 기준
        // 거리 0.8~26.8km)에서 중위값 10.5km는 35개 리를 잘라냈다. 상리(10.9km)
        // 같은 평범한 거리까지 날아간다. 평균+2σ(22.6km)는 2개만 제외한다.
        //
        // 대표필지가 없는 경로(spatialUtils.findDistantRis)가 이미 평균+2σ를
        // 쓰고 있었으므로, 기준이 갈라져 있던 것을 함께 맞춘 것이기도 하다.
        const dists = riDists.map(d => d.dist);
        if (dists.length > 0) {
          threshold = meanPlusTwoSigma(dists);
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

    // `farmerId_parcelId`는 고유하지 않다. 같은 농가가 같은 지번을 작물별로
    // 여러 행 등록하면, 그중 하나만 선택돼도 나머지 행이 전부 보충 후보에서
    // 빠진다. 이 시점의 selected는 아직 원본 참조이므로 참조로 거른다.
    const selectedSet = new Set(selected);
    const remaining = candidates.filter(p => !selectedSet.has(p));

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
export function generateRiStats(
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
export function generateFarmerStats(selectedParcels: Parcel[]): FarmerStat[] {
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
/**
 * 추출 결과 검증.
 *
 * `extractParcels` 안에서 한 번 호출되지만, 그 시점의 대상은 **공익직불제 필지만**이고
 * 목표도 `publicPaymentTarget`으로 덮인 값이다. 대표필지까지 병합한 최종 결과를
 * 화면에 띄우려면 병합 후 이 함수를 다시 불러야 숫자가 맞는다(extractionStore).
 */
export function validateExtraction(
  selectedParcels: Parcel[],
  config: ExtractionConfig,
  riStats: RiStat[],
  options?: {
    /** 총 추출 수 비교 기준. 없으면 `config.totalTarget`을 쓴다 */
    totalTarget?: number;
    /**
     * 농가당 최대 제한 검증에서 뺄 필지의 키(`pnu` 또는 `주소__필지번호`).
     * 카테고리가 아니라 키로 받는 이유는, `parcelCategory === 'representative'`가
     * 사용자 지정 필지·알고리즘이 고른 대체분·이미 슬라이스를 거친 필지를
     * 모두 싸잡기 때문이다. 면제는 사용자가 직접 지정한 것에만 줘야 한다.
     */
    exemptFarmerLimitKeys?: Set<string>;
  }
): ValidationResult {
  const errors: ValidationMessage[] = [];
  const warnings: ValidationMessage[] = [];

  // 총 추출 수 검증
  // 목표는 호출자가 넘긴 값을 우선한다. 대표필지는 총 목표 '안에' 들어가므로
  // `representativeTarget`(상한, 0은 "전부 포함")을 더한 값은 실제 결과와 다르다.
  const totalTarget = options?.totalTarget ?? config.totalTarget;
  if (selectedParcels.length !== totalTarget) {
    const level = Math.abs(selectedParcels.length - totalTarget) > 10 ? errors : warnings;
    level.push({
      code: 'TOTAL_MISMATCH',
      message: `총 추출 수가 목표(${totalTarget})와 다릅니다: ${selectedParcels.length}개`,
    });
  }

  // 농가당 최대 제한 검증
  // 사용자가 직접 지정해 넣은 필지는 농가별 슬라이스를 거치지 않고 추가되므로
  // 이 제한으로 재면 고칠 방법이 없는 오류가 뜬다. 그 키만 면제한다.
  const exempt = options?.exemptFarmerLimitKeys;
  const farmerLimitTargets = exempt
    ? selectedParcels.filter(p => !exempt.has(parcelMatchKey(p)))
    : selectedParcels;
  const farmerCounts: Record<string, number> = {};
  for (const p of farmerLimitTargets) {
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

  // 중복 체크 (기채취 필지가 포함되었는지)
  const sampledIncluded = selectedParcels.filter(p => p.sampledYears.length > 0);
  if (sampledIncluded.length > 0) {
    errors.push({
      code: 'SAMPLED_INCLUDED',
      message: `기채취 필지가 ${sampledIncluded.length}건 포함되었습니다`,
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

  // 선택되지 않은 후보 필지 (지번은 고유하지 않으므로 참조로 거른다)
  const selectedSet = new Set(selected);
  const remaining = candidates.filter(p => !selectedSet.has(p));
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
  // 참조로 담는다. `farmerId_parcelId`를 쓰면 같은 키를 가진 다른 행이 유지
  // 대상에 있을 때 초과분이 제거되지 않아 지목 비율이 설정대로 맞지 않는다.
  const kept = new Set<Parcel>();
  for (const parcels of Object.values(selectedByCategory)) {
    for (const p of parcels) kept.add(p);
  }

  // selected 배열에서 초과분 제거
  let i = selected.length;
  while (i--) {
    if (!kept.has(selected[i])) {
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
        if (!kept.has(p)) {
          selected.push(p);
          kept.add(p);
          added++;
        }
      }
    }
  }
}
