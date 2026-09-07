export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * 필지가 어느 경로로 결과에 들어왔는가.
 *
 * `'both'`가 필요한 이유: 대표필지가 공익직불제 추출에도 뽑히는 일이 흔한데,
 * 예전에는 그 경우 카테고리를 `'representative'`로 **덮어써서** 공익직불제 시트에서
 * 사라졌다. 담당자에게 나가는 제출 파일의 행 수가 조용히 줄어든다.
 * 두 성격을 동시에 갖는 상태를 명시적으로 둔다.
 *
 * 판정은 `isRepresentative` / `isPublicPayment` 헬퍼를 쓴다.
 * `=== 'representative'`로 직접 비교하면 `'both'`를 놓친다.
 */
export type ParcelCategory = 'public-payment' | 'representative' | 'both';

export interface Parcel {
  farmerId: string;
  farmerName: string;
  parcelId: string;
  mainLotNum: string;         // 본번
  subLotNum: string;          // 부번
  address: string;             // 필지 주소
  farmerAddress: string;       // 경영체(농가) 주소
  sido: string;               // 시도
  ri: string;
  sigungu: string;
  eubmyeondong: string;
  cropType?: string;
  landCategoryOfficial?: string;   // 공부지목 (전, 답, 과수원, 임야 등)
  landCategoryActual?: string;     // 실지목
  area?: number;
  sampledYears: number[];
  isEligible: boolean;
  isSelected: boolean;
  fileSource: string;
  coords?: LatLng | null;
  pnu?: string;
  rawData?: Record<string, unknown>;
  parcelCategory: ParcelCategory;
}

export interface FileConfig {
  id: string;
  filename: string;
  /** 이 파일이 담당하는 연도. 조사 연도(surveyStore)에서 파생된 값이 들어온다 */
  year: number;
  role: 'sampled' | 'master' | 'representative';
  columnMapping: ColumnMapping;
  /** 대표 시트명 (표시용). 여러 시트를 합친 경우 첫 시트 */
  sheetName?: string;
  /** 실제로 읽어들인 시트 목록. 여러 개면 합쳐서 로드된 것 */
  sheetNames?: string[];
  /** 읽어들인 시트별 행 수 */
  sheetRowCounts?: Record<string, number>;
  /** 파일에 존재하는 전체 시트 목록 (선택 UI용) */
  allSheetNames?: string[];
  /** 전체 시트별 행 수 (선택 UI 표시용) */
  allSheetRowCounts?: Record<string, number>;
  /** 원본 File 핸들. 페이지를 이동했다 돌아와도 시트를 다시 고를 수 있게 유지한다 */
  sourceFile?: File;
  rowCount: number;
  status: 'pending' | 'mapped' | 'loaded';
  rawData?: Record<string, unknown>[];
  headers?: string[];
}

export interface ColumnMapping {
  farmerId: string;
  farmerName?: string;
  parcelId: string;
  mainLotNum?: string;        // 본번 (분리형)
  subLotNum?: string;         // 부번 (분리형)
  parcelIdMode?: 'single' | 'split';  // 통합 / 본번+부번 분리
  address: string;             // 필지 주소
  farmerAddress?: string;      // 경영체(농가) 주소
  sido?: string;              // 시도
  ri?: string;
  sigungu?: string;
  eubmyeondong?: string;
  area?: string;
  cropType?: string;
  landCategoryOfficial?: string;    // 공부지목
  landCategoryActual?: string;     // 실지목
  pnu?: string;
}

export interface SpatialConfig {
  enableSpatialFilter: boolean;     // 공간 필터 활성화 (기본: true)
  maxRiDistanceKm: number;          // 먼 리 제외 기준 거리 (기본: 0 = 자동 계산)
  maxParcelDistanceKm: number;      // 필지 간 최대 거리 (기본: 1)
  densityWeight: number;            // 밀집도 가중치 0~1 (기본: 0.7)
}

export interface ExtractionConfig {
  totalTarget: number;
  publicPaymentTarget: number;     // 공익직불제 추출 목표
  representativeTarget: number;    // 대표필지 추출 목표
  perRiTarget: number;
  minPerFarmer: number;
  maxPerFarmer: number;
  extractionMethod: 'random' | 'area' | 'farmerId';
  underfillPolicy: 'supplement' | 'skip';
  randomSeed?: number;
  excludedRis: string[];
  riTargetOverrides: Record<string, number>;
  landCategoryRatios: Record<string, number>;  // 지목별 비율 (예: { '전': 40, '답': 40, '과수원': 20 })
  enableLandCategoryFilter: boolean;            // 지목별 비율 필터 활성화
  spatialConfig?: SpatialConfig;
  referenceCentroid?: LatLng;  // 대표필지 중심 좌표 (먼 리 제외 기준)
  repCoordsByRi?: Record<string, LatLng[]>;  // 리별 대표필지 좌표 (리 내 추출 시 근처 우선)
  repParcelKeys?: Set<string>;  // 대표필지 키 셋 (우선 추출 대상)
}

export interface ExtractionResult {
  selectedParcels: Parcel[];
  riStats: RiStat[];
  farmerStats: FarmerStat[];
  validation: ValidationResult;
  /**
   * 대표필지가 어떻게 줄고 채워졌는지. 상한(`representativeTarget`)이 실제로 필지를
   * 잘라내므로, 콘솔에만 남기면 사용자는 "올린 대표필지가 왜 다 안 들어갔나"를 알 수 없다.
   */
  representativeSummary?: {
    uploaded: number;
    eligible: number;
    /** 실제 적용된 상한 (0 = 전부) */
    cap: number;
    /** 상한 적용 후 대상 수 */
    limited: number;
    /** 부적격 대표 대신 마스터에서 대체 복사한 수 */
    supplemented: number;
    /** 대체하려 했으나 후보가 모자라 못 채운 수 */
    supplementShortfall: number;
  };
}

export interface RiStat {
  ri: string;
  totalCount: number;
  eligibleCount: number;
  selectedCount: number;
  targetCount: number;
}

export interface FarmerStat {
  farmerId: string;
  farmerName: string;
  totalParcels: number;
  selectedParcels: number;
}

export interface ValidationResult {
  isValid: boolean;
  warnings: ValidationMessage[];
  errors: ValidationMessage[];
}

export interface ValidationMessage {
  code: string;
  message: string;
  details?: string;
}

export interface DuplicateResult {
  /** 기채취 연도별 중복 필지 키. 키는 연도, 값은 그 해에 채취된 필지 집합 */
  duplicateKeysByYear: Record<number, Set<string>>;
  /** 기채취 연도별 중복 건수 */
  duplicateCountByYear: Record<number, number>;
  eligibleCount: number;
}

export interface Statistics {
  totalParcels: number;
  /** 기채취 연도별 필지 수 */
  sampledCountByYear: Record<number, number>;
  eligibleParcels: number;
  uniqueRis: number;
  canMeetTarget: boolean;
  representativeParcels: number;
}

export type StepId = 'upload' | 'mapping' | 'analyze' | 'extract' | 'review' | 'export';

export interface Step {
  id: StepId;
  label: string;
  path: string;
  description: string;
}

export const STEPS: Step[] = [
  { id: 'upload', label: '파일 등록', path: '/upload', description: '엑셀 파일 업로드' },
  { id: 'mapping', label: '컬럼 매핑', path: '/mapping', description: '데이터 필드 매핑' },
  { id: 'analyze', label: '데이터 분석', path: '/analyze', description: '중복 감지 및 통계' },
  { id: 'extract', label: '추출 설정', path: '/extract', description: '추출 조건 설정' },
  { id: 'review', label: '결과 검토', path: '/review', description: '결과 확인 및 조정' },
  { id: 'export', label: '다운로드', path: '/export', description: '엑셀 내보내기' },
];
