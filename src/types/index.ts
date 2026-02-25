export interface LatLng {
  lat: number;
  lng: number;
}

export type ParcelCategory = 'public-payment' | 'representative';

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
  year: 2024 | 2025 | 2026;
  role: 'sampled' | 'master' | 'representative';
  columnMapping: ColumnMapping;
  sheetName?: string;
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
  perRiTarget: number;
  minPerFarmer: number;
  maxPerFarmer: number;
  extractionMethod: 'random' | 'area' | 'farmerId';
  underfillPolicy: 'supplement' | 'skip';
  randomSeed?: number;
  excludedRis: string[];
  riTargetOverrides: Record<string, number>;
  spatialConfig?: SpatialConfig;
}

export interface ExtractionResult {
  selectedParcels: Parcel[];
  riStats: RiStat[];
  farmerStats: FarmerStat[];
  validation: ValidationResult;
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
  duplicateKeys2024: Set<string>;
  duplicateKeys2025: Set<string>;
  duplicateCount2024: number;
  duplicateCount2025: number;
  eligibleCount: number;
}

export interface Statistics {
  totalParcels: number;
  sampled2024: number;
  sampled2025: number;
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
