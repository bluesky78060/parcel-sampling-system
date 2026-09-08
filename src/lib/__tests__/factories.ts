import type { ExtractionConfig, LatLng, Parcel } from '../../types';
import { newRowUid } from '../parcelKey';

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
  // 주소를 지번에서 파생시킨다. 고정 문자열로 두면 `parcelId`만 다른 두 필지가
  // 같은 주소를 갖고, `parcelMatchKey`의 주소 폴백과 `duplicateDetector`의
  // 주소 매칭이 서로 다른 필지를 같은 것으로 취급한다. 실제로 이 함정 때문에
  // duplicateDetector 테스트 3건이 처음에 엉뚱하게 통과·실패했다.
  // 주소 자체를 검증하는 테스트는 `address`를 명시적으로 덮어쓰면 된다.
  const parcelId = overrides.parcelId ?? '100';
  return {
    // 행마다 고유해야 한다 — 고정값을 주면 서로 다른 필지가 같은 행으로 취급된다
    rowUid: newRowUid(),
    farmerId: 'F001',
    farmerName: '홍길동',
    parcelId,
    mainLotNum: parcelId.split('-')[0],
    subLotNum: parcelId.split('-')[1] ?? '',
    address: `경상북도 봉화군 봉화읍 내성리 ${parcelId}`,
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
 *
 * ⚠️ **`perRiTarget: 0`은 Step 3(리별 추출, `extractFromRi`)을 통째로 건너뛴다.**
 * `extractParcels`가 리별 목표를 `riTargetOverrides[ri] ?? perRiTarget`으로 잡는데
 * 그것이 0이면 `slice(0, 0)`이라 빈 배열이 나오고, 결과는 전부 Step 4(미달 보충)에서
 * 채워진다. 실측: Step 3만으로는 선택 0건, Step 4까지 돌면 20건.
 *
 * 따라서 이 기본값으로 쓰는 테스트는 **리별 할당·농가별 슬라이스·대표필지 우선·
 * 밀집도 추출·지목 비율 경로를 검증하지 않는다.** 그 경로를 다루려면
 * `perRiTarget`을 양수로 준 별도 config를 만들어야 한다.
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
