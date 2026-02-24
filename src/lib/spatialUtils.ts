import type { LatLng, Parcel } from '../types';

const EARTH_RADIUS_KM = 6371;

/**
 * Haversine 공식으로 두 좌표 사이 거리 계산 (km)
 */
export function haversineDistance(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const haversine =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;

  const c = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));

  return EARTH_RADIUS_KM * c;
}

/**
 * 필지 배열의 중심점 계산 (좌표 있는 필지만)
 */
export function calculateCentroid(parcels: Parcel[]): LatLng | null {
  const coordParcels = parcels.filter((p) => p.coords != null);

  if (coordParcels.length === 0) return null;

  const sumLat = coordParcels.reduce((acc, p) => acc + p.coords!.lat, 0);
  const sumLng = coordParcels.reduce((acc, p) => acc + p.coords!.lng, 0);

  return {
    lat: sumLat / coordParcels.length,
    lng: sumLng / coordParcels.length,
  };
}

/**
 * 한 필지 주변 반경 내 이웃 필지 수로 밀집도 점수 계산
 * @param parcel 대상 필지
 * @param allParcels 전체 필지 (좌표 있는 것만)
 * @param radiusKm 반경 (기본 1km)
 * @returns 0~1 정규화된 밀집도 점수
 */
export function calculateDensity(
  parcel: Parcel,
  allParcels: Parcel[],
  radiusKm = 1,
): number {
  if (parcel.coords == null) return 0;

  const coordParcels = allParcels.filter(
    (p) => p.coords != null && p.parcelId !== parcel.parcelId,
  );

  if (coordParcels.length === 0) return 0;

  const neighborCount = coordParcels.filter(
    (p) => haversineDistance(parcel.coords!, p.coords!) <= radiusKm,
  ).length;

  // 전체 필지 수 대비 정규화 (0~1)
  return neighborCount / coordParcels.length;
}

/**
 * 전체 중심점에서 일정 거리 이상 떨어진 리(里) 식별
 * @param parcels 좌표가 있는 전체 필지
 * @param thresholdKm 기준 거리 (기본: 자동 계산 - 표준편차 * 2)
 * @returns 먼 리 이름 배열
 */
export function findDistantRis(parcels: Parcel[], thresholdKm?: number): string[] {
  const centroid = calculateCentroid(parcels);
  if (centroid == null) return [];

  const riCentroids = calculateRiCentroids(parcels);
  const riNames = Object.keys(riCentroids);

  if (riNames.length === 0) return [];

  const distances = riNames.map((ri) => ({
    ri,
    dist: haversineDistance(centroid, riCentroids[ri]),
  }));

  let threshold = thresholdKm;

  if (threshold == null || threshold <= 0) {
    // 자동 계산: 평균 + 표준편차 * 2
    const dists = distances.map((d) => d.dist);
    const mean = dists.reduce((a, b) => a + b, 0) / dists.length;
    const variance =
      dists.reduce((acc, d) => acc + Math.pow(d - mean, 2), 0) / dists.length;
    const stdDev = Math.sqrt(variance);
    threshold = mean + stdDev * 2;
  }

  return distances.filter((d) => d.dist > threshold!).map((d) => d.ri);
}

/**
 * 근접 필지 클러스터링 (simple grid-based)
 * 같은 리 내에서 maxDistKm 이내의 필지들을 그룹화
 */
export function clusterParcelsInRi(parcels: Parcel[], maxDistKm = 0.5): Parcel[][] {
  const coordParcels = parcels.filter((p) => p.coords != null);

  if (coordParcels.length === 0) return [];

  const visited = new Set<string>();
  const clusters: Parcel[][] = [];

  for (const parcel of coordParcels) {
    if (visited.has(parcel.parcelId)) continue;

    const cluster: Parcel[] = [parcel];
    visited.add(parcel.parcelId);

    // BFS로 가까운 필지 탐색
    const queue: Parcel[] = [parcel];

    while (queue.length > 0) {
      const current = queue.shift()!;

      const neighbors = coordParcels.filter(
        (p) =>
          !visited.has(p.parcelId) &&
          p.ri === current.ri &&
          haversineDistance(current.coords!, p.coords!) <= maxDistKm,
      );

      for (const neighbor of neighbors) {
        visited.add(neighbor.parcelId);
        cluster.push(neighbor);
        queue.push(neighbor);
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

/**
 * 리별 평균 좌표 계산
 */
export function calculateRiCentroids(parcels: Parcel[]): Record<string, LatLng> {
  const riMap: Record<string, LatLng[]> = {};

  for (const parcel of parcels) {
    if (parcel.coords == null) continue;

    if (!riMap[parcel.ri]) {
      riMap[parcel.ri] = [];
    }
    riMap[parcel.ri].push(parcel.coords);
  }

  const result: Record<string, LatLng> = {};

  for (const [ri, coords] of Object.entries(riMap)) {
    if (coords.length === 0) continue;

    const sumLat = coords.reduce((acc, c) => acc + c.lat, 0);
    const sumLng = coords.reduce((acc, c) => acc + c.lng, 0);

    result[ri] = {
      lat: sumLat / coords.length,
      lng: sumLng / coords.length,
    };
  }

  return result;
}

/**
 * 선택된 필지들 간 평균 거리 계산
 */
export function calculateAverageDistance(parcels: Parcel[]): number {
  const coordParcels = parcels.filter((p) => p.coords != null);

  if (coordParcels.length < 2) return 0;

  let totalDist = 0;
  let pairCount = 0;

  for (let i = 0; i < coordParcels.length; i++) {
    for (let j = i + 1; j < coordParcels.length; j++) {
      totalDist += haversineDistance(coordParcels[i].coords!, coordParcels[j].coords!);
      pairCount++;
    }
  }

  return pairCount > 0 ? totalDist / pairCount : 0;
}

/**
 * 선택된 필지들 중 maxDistKm 초과 쌍 찾기
 */
export function findDistantPairs(
  parcels: Parcel[],
  maxDistKm: number,
): Array<{ a: Parcel; b: Parcel; distKm: number }> {
  const coordParcels = parcels.filter((p) => p.coords != null);
  const results: Array<{ a: Parcel; b: Parcel; distKm: number }> = [];

  for (let i = 0; i < coordParcels.length; i++) {
    for (let j = i + 1; j < coordParcels.length; j++) {
      const distKm = haversineDistance(
        coordParcels[i].coords!,
        coordParcels[j].coords!,
      );

      if (distKm > maxDistKm) {
        results.push({ a: coordParcels[i], b: coordParcels[j], distKm });
      }
    }
  }

  return results;
}
