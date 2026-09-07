import type { ExtractionConfig, LatLng, Parcel } from '../../types';

/**
 * 테스트용 Parcel 생성기.
 *
 * `Parcel`은 필수 필드가 17개라 테스트마다 전부 적으면 정작 검증하려는 필드가
 * 묻힌다. 기본값을 채우고 관심 있는 필드만 덮어쓴다.
 *
 * 기본값은 **추출에 걸리지 않는 중립값**이다(적격, 미선택, 채취이력 없음).
 * 면적을 비워 두는 이유는 `getParcelArea`가 null을 "정보 없음"으로 보고
 * 면적 필터를 통과시키기 때문이다 — 면적을 검증하는 테스트만 명시적으로 준다.
 */
export function makeParcel(overrides: Partial<Parcel> = {}): Parcel {
  return {
    farmerId: 'F001',
    farmerName: '홍길동',
    parcelId: '100',
    mainLotNum: '100',
    subLotNum: '',
    address: '경상북도 봉화군 봉화읍 내성리 100',
    farmerAddress: '경상북도 봉화군 봉화읍 내성리 1',
    sido: '경상북도',
    sigungu: '봉화군',
    eubmyeondong: '봉화읍',
    ri: '내성리',
    sampledYears: [],
    isEligible: true,
    isSelected: false,
    fileSource: 'test.xlsx',
    parcelCategory: 'public-payment',
    ...overrides,
  };
}

/**
 * 테스트용 ExtractionConfig 생성기.
 *
 * 기본값은 **공간 필터와 지목 비율을 끈 상태**다. 둘 다 켜면 결과가 좌표 분포와
 * 지목 구성에 함께 좌우돼, 무엇이 결과를 갈랐는지 테스트가 말해주지 못한다.
 * 각각을 검증하는 테스트에서만 켠다.
 */
export function makeConfig(overrides: Partial<ExtractionConfig> = {}): ExtractionConfig {
  return {
    totalTarget: 10,
    publicPaymentTarget: 10,
    representativeTarget: 0,
    perRiTarget: 0,
    minPerFarmer: 1,
    maxPerFarmer: 2,
    extractionMethod: 'random',
    underfillPolicy: 'supplement',
    randomSeed: 42,
    excludedRis: [],
    riTargetOverrides: {},
    landCategoryRatios: {},
    enableLandCategoryFilter: false,
    ...overrides,
  };
}

/** 봉화군 안의 임의 좌표. 리별로 떨어뜨리고 싶을 때 오프셋을 준다. */
export function coordsAt(latOffset = 0, lngOffset = 0): LatLng {
  return { lat: 36.89 + latOffset, lng: 128.88 + lngOffset };
}
