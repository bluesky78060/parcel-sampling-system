import { describe, expect, it } from 'vitest';
import {
  calculateCentroid,
  calculateDensity,
  calculateRiCentroids,
  clusterParcelsInRi,
  findDistantPairs,
  findDistantRis,
  haversineDistance,
  meanPlusTwoSigma,
} from '../spatialUtils';
import { coordsAt, makeParcel } from './factories';

describe('haversineDistance', () => {
  it('같은 점은 0이다', () => {
    expect(haversineDistance({ lat: 36.89, lng: 128.88 }, { lat: 36.89, lng: 128.88 })).toBe(0);
  });

  it('대칭이다', () => {
    const a = { lat: 36.853, lng: 128.771 };
    const b = { lat: 37.0, lng: 128.836 };
    expect(haversineDistance(a, b)).toBeCloseTo(haversineDistance(b, a), 10);
  });

  it('위도 1도는 약 111.2km다', () => {
    // 지구 반지름 6371km 기준: 6371 * π/180 = 111.195km
    const d = haversineDistance({ lat: 36, lng: 128 }, { lat: 37, lng: 128 });
    expect(d).toBeCloseTo(111.195, 2);
  });

  it('같은 경도차라도 고위도에서 더 짧다', () => {
    const atEquator = haversineDistance({ lat: 0, lng: 128 }, { lat: 0, lng: 129 });
    const atBonghwa = haversineDistance({ lat: 36.89, lng: 128 }, { lat: 36.89, lng: 129 });
    expect(atBonghwa).toBeLessThan(atEquator);
  });

  /**
   * PROJ1-1-19가 실측으로 확보한 두 좌표.
   * 상운면 운계리(128.771, 36.853) ↔ 춘양면 서벽리(128.836, 37.000)
   */
  it('봉화군 두 리 사이 거리가 실측 범위 안이다', () => {
    const d = haversineDistance({ lat: 36.853, lng: 128.771 }, { lat: 37.0, lng: 128.836 });
    expect(d).toBeGreaterThan(16);
    expect(d).toBeLessThan(19);
  });
});

describe('calculateCentroid', () => {
  it('좌표가 있는 필지의 평균을 낸다', () => {
    const parcels = [
      makeParcel({ coords: { lat: 36, lng: 128 } }),
      makeParcel({ coords: { lat: 38, lng: 130 } }),
    ];
    expect(calculateCentroid(parcels)).toEqual({ lat: 37, lng: 129 });
  });

  it('좌표 없는 필지는 평균에서 뺀다', () => {
    const parcels = [
      makeParcel({ coords: { lat: 36, lng: 128 } }),
      makeParcel({ coords: { lat: 38, lng: 130 } }),
      makeParcel({ coords: null }),
      makeParcel({}), // coords 자체가 없는 경우
    ];
    expect(calculateCentroid(parcels)).toEqual({ lat: 37, lng: 129 });
  });

  it('좌표가 하나도 없으면 null이다', () => {
    expect(calculateCentroid([makeParcel({}), makeParcel({ coords: null })])).toBeNull();
    expect(calculateCentroid([])).toBeNull();
  });
});

/**
 * PROJ1-1-5. 예전에는 자동 임계값이 **중위값**이라 정의상 리의 절반이 항상
 * 제외됐다. 봉화군 실측(71개 리, 0.8~26.8km)에서 중위값 10.5km는 35개를,
 * 평균+2σ 22.6km는 2개를 잘라냈다.
 */
describe('meanPlusTwoSigma', () => {
  it('편차가 없으면 평균과 같다', () => {
    expect(meanPlusTwoSigma([5, 5, 5, 5])).toBe(5);
  });

  it('평균 + 2σ를 돌려준다', () => {
    // [0, 10] → 평균 5, 분산 25, σ 5 → 5 + 10 = 15
    expect(meanPlusTwoSigma([0, 10])).toBe(15);
  });

  it('빈 배열은 0이다', () => {
    expect(meanPlusTwoSigma([])).toBe(0);
  });

  it('중위값과 달리 절반을 자르지 않는다', () => {
    // 균등하게 모여 있는 분포에서 임계값을 넘는 값이 없어야 한다.
    const values = [10, 10.5, 11, 10.2, 10.8, 10.1, 10.9];
    const threshold = meanPlusTwoSigma(values);
    expect(values.filter((v) => v > threshold)).toHaveLength(0);
  });
});

describe('findDistantRis', () => {
  it('중심에서 멀리 떨어진 리만 골라낸다', () => {
    const parcels = [
      // 모여 있는 리 셋
      makeParcel({ ri: 'A리', coords: coordsAt(0, 0) }),
      makeParcel({ ri: 'B리', coords: coordsAt(0.01, 0) }),
      makeParcel({ ri: 'C리', coords: coordsAt(-0.01, 0) }),
      // 멀리 떨어진 리 하나. 중심점이 이 리 쪽으로 끌려가므로
      // 기준 거리는 남은 셋이 걸리지 않을 만큼 넉넉해야 한다.
      makeParcel({ ri: 'Z리', coords: coordsAt(0.5, 0) }),
    ];
    expect(findDistantRis(parcels, 20)).toEqual(['Z리']);
  });

  it('임계값을 넘는 리가 없으면 빈 배열이다', () => {
    const parcels = [
      makeParcel({ ri: 'A리', coords: coordsAt(0, 0) }),
      makeParcel({ ri: 'B리', coords: coordsAt(0.01, 0.01) }),
    ];
    expect(findDistantRis(parcels, 100)).toEqual([]);
  });

  /**
   * 표본이 적으면 평균+2σ가 이상치를 못 잡는다. `meanPlusTwoSigma`는 **모집단**
   * 표준편차(`÷ n`)를 쓰므로 n개 표본에서 나올 수 있는 최대 z는 `√(n-1)`이고,
   * **n이 6 미만이면 z가 2를 넘는 것이 수학적으로 불가능**하다
   * (n=5의 최대 z는 정확히 2인데 코드가 strict `>`를 쓴다).
   * 표본 표준편차(`÷ (n-1)`) 기준인 `(n-1)/√n`과 혼동하지 말 것 — 값이 다르다.
   * 봉화군은 리가 71개라 실사용에서는 문제가 없지만, 이 테스트를 리 5개로 짜면
   * 함수가 정상인데도 빈 배열이 나온다. 리를 9개 둔 이유다.
   */
  it('임계값을 안 주면 평균+2σ로 자동 계산한다', () => {
    const near = Array.from({ length: 8 }, (_, i) =>
      makeParcel({ ri: `R${i}리`, coords: coordsAt(i * 0.001, 0) }),
    );
    const parcels = [...near, makeParcel({ ri: 'Z리', coords: coordsAt(3, 0) })];
    expect(findDistantRis(parcels)).toEqual(['Z리']);
  });

  it('좌표가 없으면 빈 배열이다', () => {
    expect(findDistantRis([makeParcel({})])).toEqual([]);
    expect(findDistantRis([])).toEqual([]);
  });
});

describe('calculateRiCentroids', () => {
  it('리별로 평균 좌표를 낸다', () => {
    const centroids = calculateRiCentroids([
      makeParcel({ ri: 'A리', coords: { lat: 36, lng: 128 } }),
      makeParcel({ ri: 'A리', coords: { lat: 38, lng: 130 } }),
      makeParcel({ ri: 'B리', coords: { lat: 37, lng: 129 } }),
    ]);
    expect(centroids['A리']).toEqual({ lat: 37, lng: 129 });
    expect(centroids['B리']).toEqual({ lat: 37, lng: 129 });
  });

  it('좌표 없는 리는 결과에 없다', () => {
    const centroids = calculateRiCentroids([makeParcel({ ri: '없는리', coords: null })]);
    expect(centroids['없는리']).toBeUndefined();
  });
});

/**
 * 예전에는 자기 자신 제외를 `parcelId`로 판정했는데 지번은 고유하지 않아
 * (실데이터 기준 같은 리 안에서만 4,774종 중복, 한 지번이 최대 12행)
 * 같은 지번의 다른 필지까지 이웃에서 빠져 밀집도가 과소 계산됐다.
 * 지금은 **참조**로 판정한다.
 */
describe('calculateDensity', () => {
  it('반경 안 이웃 비율을 돌려준다', () => {
    const target = makeParcel({ coords: coordsAt(0, 0) });
    const near = makeParcel({ coords: coordsAt(0.001, 0.001) });
    const far = makeParcel({ coords: coordsAt(1, 1) });
    // 자기 자신 제외 후보 2건 중 1건이 1km 안 → 0.5
    expect(calculateDensity(target, [target, near, far], 1)).toBe(0.5);
  });

  it('같은 지번을 가진 다른 필지도 이웃으로 센다', () => {
    const target = makeParcel({ parcelId: '100', coords: coordsAt(0, 0) });
    // 지번이 같지만 별개 필지 — 참조가 다르므로 이웃이어야 한다
    const sameLot = makeParcel({ parcelId: '100', coords: coordsAt(0.001, 0) });
    expect(calculateDensity(target, [target, sameLot], 1)).toBe(1);
  });

  it('좌표가 없으면 0이다', () => {
    const target = makeParcel({ coords: null });
    expect(calculateDensity(target, [target, makeParcel({ coords: coordsAt() })], 1)).toBe(0);
  });

  it('자기 자신뿐이면 0이다', () => {
    const target = makeParcel({ coords: coordsAt() });
    expect(calculateDensity(target, [target], 1)).toBe(0);
  });
});

/**
 * 예전에는 방문 표시를 `parcelId`로 했다. 지번이 고유하지 않아 같은 지번의 다른
 * 필지가 시드로도 이웃으로도 뽑히지 못해 **클러스터에서 통째로 빠졌고**,
 * 그만큼 추출 후보에서 사라졌다. 지금은 참조로 표시한다.
 */
describe('clusterParcelsInRi', () => {
  it('가까운 필지를 한 클러스터로 묶는다', () => {
    const parcels = [
      makeParcel({ ri: 'A리', coords: coordsAt(0, 0) }),
      makeParcel({ ri: 'A리', coords: coordsAt(0.001, 0) }),
      makeParcel({ ri: 'A리', coords: coordsAt(0.002, 0) }),
    ];
    const clusters = clusterParcelsInRi(parcels, 0.5);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(3);
  });

  it('먼 필지는 따로 묶는다', () => {
    const parcels = [
      makeParcel({ ri: 'A리', coords: coordsAt(0, 0) }),
      makeParcel({ ri: 'A리', coords: coordsAt(1, 1) }),
    ];
    expect(clusterParcelsInRi(parcels, 0.5)).toHaveLength(2);
  });

  it('리가 다르면 가까워도 묶지 않는다', () => {
    const parcels = [
      makeParcel({ ri: 'A리', coords: coordsAt(0, 0) }),
      makeParcel({ ri: 'B리', coords: coordsAt(0.001, 0) }),
    ];
    expect(clusterParcelsInRi(parcels, 0.5)).toHaveLength(2);
  });

  it('지번이 같아도 원소를 잃지 않는다', () => {
    const parcels = [
      makeParcel({ ri: 'A리', parcelId: '100', coords: coordsAt(0, 0) }),
      makeParcel({ ri: 'A리', parcelId: '100', coords: coordsAt(0.001, 0) }),
      makeParcel({ ri: 'A리', parcelId: '100', coords: coordsAt(0.002, 0) }),
    ];
    const total = clusterParcelsInRi(parcels, 0.5).flat();
    expect(total).toHaveLength(3);
  });

  it('모든 필지가 정확히 한 클러스터에 들어간다', () => {
    const parcels = [
      makeParcel({ ri: 'A리', coords: coordsAt(0, 0) }),
      makeParcel({ ri: 'A리', coords: coordsAt(0.001, 0) }),
      makeParcel({ ri: 'B리', coords: coordsAt(0.5, 0.5) }),
      makeParcel({ ri: 'B리', coords: coordsAt(0.501, 0.5) }),
      makeParcel({ ri: 'C리', coords: coordsAt(2, 2) }),
    ];
    const flat = clusterParcelsInRi(parcels, 0.5).flat();
    expect(flat).toHaveLength(parcels.length);
    expect(new Set(flat).size).toBe(parcels.length); // 중복 없음
  });

  it('좌표 없는 필지는 제외한다', () => {
    const parcels = [makeParcel({ ri: 'A리', coords: null }), makeParcel({ ri: 'A리' })];
    expect(clusterParcelsInRi(parcels, 0.5)).toEqual([]);
  });
});

describe('findDistantPairs', () => {
  it('기준 거리를 넘는 쌍만 돌려준다', () => {
    const a = makeParcel({ coords: coordsAt(0, 0) });
    const b = makeParcel({ coords: coordsAt(0.001, 0) });
    const c = makeParcel({ coords: coordsAt(1, 1) });
    const pairs = findDistantPairs([a, b, c], 1);
    // a-c, b-c 두 쌍만 1km 초과
    expect(pairs).toHaveLength(2);
    expect(pairs.every((p) => p.distKm > 1)).toBe(true);
  });

  it('모두 가까우면 빈 배열이다', () => {
    const parcels = [
      makeParcel({ coords: coordsAt(0, 0) }),
      makeParcel({ coords: coordsAt(0.001, 0) }),
    ];
    expect(findDistantPairs(parcels, 1)).toEqual([]);
  });
});
