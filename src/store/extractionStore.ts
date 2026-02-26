import { create } from 'zustand';
import type { ExtractionConfig, ExtractionResult, Parcel, SpatialConfig, ValidationResult } from '../types';
import { extractParcels, getParcelArea, MIN_AREA } from '../lib/extractionAlgorithm';
import { calculateCentroid, haversineDistance } from '../lib/spatialUtils';

const DEFAULT_CONFIG: ExtractionConfig = {
  totalTarget: 700,
  publicPaymentTarget: 700,
  representativeTarget: 0,
  perRiTarget: 10,
  minPerFarmer: 1,
  maxPerFarmer: 2,
  extractionMethod: 'random',
  underfillPolicy: 'supplement',
  randomSeed: undefined,
  excludedRis: [],
  riTargetOverrides: {},
  landCategoryRatios: {},
  enableLandCategoryFilter: false,
  spatialConfig: {
    enableSpatialFilter: true,
    maxRiDistanceKm: 0,           // 0 = 자동 계산
    maxParcelDistanceKm: 1,       // 1km
    densityWeight: 0.7,
  },
};

interface ExtractionStore {
  config: ExtractionConfig;
  result: ExtractionResult | null;
  isRunning: boolean;
  error: string | null;

  updateConfig: (updates: Partial<ExtractionConfig>) => void;
  updateSpatialConfig: (updates: Partial<SpatialConfig>) => void;
  setRiTargetOverride: (ri: string, target: number) => void;
  removeRiTargetOverride: (ri: string) => void;
  toggleExcludedRi: (ri: string) => void;
  setLandCategoryRatio: (category: string, ratio: number) => void;
  resetLandCategoryRatios: (distribution: Record<string, number>) => void;
  toggleLandCategoryFilter: (enabled: boolean) => void;

  runExtraction: (allParcels: Parcel[], representativeParcels?: Parcel[]) => void;
  toggleParcelSelection: (farmerId: string, parcelId: string) => void;
  addParcel: (parcel: Parcel) => void;
  removeParcel: (farmerId: string, parcelId: string) => void;

  getValidation: () => ValidationResult | null;
  reset: () => void;
}

export const useExtractionStore = create<ExtractionStore>((set, get) => ({
  config: { ...DEFAULT_CONFIG },
  result: null,
  isRunning: false,
  error: null,

  updateConfig: (updates) =>
    set((state) => ({ config: { ...state.config, ...updates } })),

  updateSpatialConfig: (updates) =>
    set((state) => ({
      config: {
        ...state.config,
        spatialConfig: { ...state.config.spatialConfig!, ...updates },
      },
    })),

  setRiTargetOverride: (ri, target) =>
    set((state) => ({
      config: {
        ...state.config,
        riTargetOverrides: { ...state.config.riTargetOverrides, [ri]: target },
      },
    })),

  removeRiTargetOverride: (ri) =>
    set((state) => {
      const overrides = { ...state.config.riTargetOverrides };
      delete overrides[ri];
      return { config: { ...state.config, riTargetOverrides: overrides } };
    }),

  toggleExcludedRi: (ri) =>
    set((state) => {
      const excluded = state.config.excludedRis.includes(ri)
        ? state.config.excludedRis.filter((r) => r !== ri)
        : [...state.config.excludedRis, ri];
      return { config: { ...state.config, excludedRis: excluded } };
    }),

  setLandCategoryRatio: (category, ratio) =>
    set((state) => ({
      config: {
        ...state.config,
        landCategoryRatios: { ...state.config.landCategoryRatios, [category]: ratio },
      },
    })),

  resetLandCategoryRatios: (distribution) =>
    set((state) => {
      const total = Object.values(distribution).reduce((s, n) => s + n, 0);
      if (total === 0) return state;
      const ratios: Record<string, number> = {};
      for (const [cat, count] of Object.entries(distribution)) {
        if (count > 0) {
          ratios[cat] = Math.round((count / total) * 1000) / 10;
        }
      }
      return { config: { ...state.config, landCategoryRatios: ratios } };
    }),

  toggleLandCategoryFilter: (enabled) =>
    set((state) => ({
      config: { ...state.config, enableLandCategoryFilter: enabled },
    })),

  runExtraction: (allParcels, representativeParcels = []) => {
    set({ isRunning: true, error: null });
    try {
      const config = get().config;

      // 매칭 키: PNU 또는 주소+필지번호
      const matchKey = (p: Parcel) => p.pnu || `${p.address}__${p.parcelId}`;

      // ── 1. 대표필지 조건 필터링 ──
      // 대표필지는 조건에 맞으면 직접 포함, 안 맞으면 마스터에서 대체 복사
      const allRepParcels = [...representativeParcels];
      const eligibleRep: Parcel[] = [];
      const excludedRepReasons: { parcel: Parcel; reason: string }[] = [];

      for (const p of allRepParcels) {
        if (!p.isEligible) {
          excludedRepReasons.push({ parcel: p, reason: '기채취(2024/2025) 중복' });
          continue;
        }
        if (p.ri && config.excludedRis.includes(p.ri)) {
          excludedRepReasons.push({ parcel: p, reason: `제외 리(${p.ri})` });
          continue;
        }
        const area = getParcelArea(p);
        if (area !== null && area < MIN_AREA) {
          excludedRepReasons.push({ parcel: p, reason: `면적 미달(${area}㎡ < ${MIN_AREA}㎡)` });
          continue;
        }
        eligibleRep.push(p);
      }

      console.info(`[추출] 대표필지: 전체 ${allRepParcels.length}건 → 적격 ${eligibleRep.length}건, 부적격 ${excludedRepReasons.length}건`);
      if (excludedRepReasons.length > 0) {
        const reasonCounts: Record<string, number> = {};
        for (const { reason } of excludedRepReasons) {
          reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
        }
        for (const [reason, count] of Object.entries(reasonCounts)) {
          console.info(`  - ${reason}: ${count}건`);
        }
      }

      // ── 1-2. 적격 대표필지 ↔ 마스터 매칭하여 데이터 보충 ──
      // 마스터 룩업 맵 구축
      const masterByKey = new Map<string, Parcel>();
      const masterByFarmerKey = new Map<string, Parcel>();
      for (const p of allParcels) {
        masterByKey.set(matchKey(p), p);
        masterByFarmerKey.set(`${p.farmerId}_${p.parcelId}`, p);
      }

      let enrichedCount = 0;
      const enrichedEligibleRep = eligibleRep.map(rep => {
        const pub = masterByKey.get(matchKey(rep))
          || masterByFarmerKey.get(`${rep.farmerId}_${rep.parcelId}`)
          || allParcels.find(p => p.farmerId === rep.farmerId && p.parcelId === rep.parcelId)
          || allParcels.find(p => p.farmerId === rep.farmerId);

        if (!pub) return rep;

        enrichedCount++;
        const merged: Parcel = { ...rep };

        // 경영체 3대 정보 — 마스터 기준 강제 복사
        if (pub.farmerId) merged.farmerId = pub.farmerId;
        if (pub.farmerName) merged.farmerName = pub.farmerName;
        if (pub.farmerAddress) merged.farmerAddress = pub.farmerAddress;

        // 나머지 필드: 비어있는 경우만 보충
        if (!merged.address && pub.address) merged.address = pub.address;
        if (!merged.sido && pub.sido) merged.sido = pub.sido;
        if (!merged.sigungu && pub.sigungu) merged.sigungu = pub.sigungu;
        if (!merged.eubmyeondong && pub.eubmyeondong) merged.eubmyeondong = pub.eubmyeondong;
        if (!merged.ri && pub.ri) merged.ri = pub.ri;
        if (!merged.mainLotNum && pub.mainLotNum) merged.mainLotNum = pub.mainLotNum;
        if (!merged.subLotNum && pub.subLotNum) merged.subLotNum = pub.subLotNum;
        if (!merged.landCategoryOfficial && pub.landCategoryOfficial) merged.landCategoryOfficial = pub.landCategoryOfficial;
        if (!merged.landCategoryActual && pub.landCategoryActual) merged.landCategoryActual = pub.landCategoryActual;
        if (merged.area == null && pub.area != null) merged.area = pub.area;
        if (!merged.cropType && pub.cropType) merged.cropType = pub.cropType;
        if (!merged.pnu && pub.pnu) merged.pnu = pub.pnu;
        if (!merged.coords && pub.coords) merged.coords = pub.coords;

        // rawData 병합
        if (pub.rawData) {
          const mergedRaw = { ...(merged.rawData ?? {}) };
          for (const [k, v] of Object.entries(pub.rawData)) {
            if (mergedRaw[k] == null || mergedRaw[k] === '') {
              mergedRaw[k] = v;
            }
          }
          merged.rawData = mergedRaw;
        }

        return merged;
      });

      console.info(`[추출] 대표필지 마스터 매칭: ${enrichedCount}건 / ${eligibleRep.length}건 보충 완료`);

      // 대표필지 좌표 정보 (추출 우선순위용)
      const repWithCoords = enrichedEligibleRep.filter(p => p.coords != null);
      const repCentroid = repWithCoords.length > 0 ? calculateCentroid(repWithCoords) : undefined;

      // 리별 대표필지 좌표 매핑
      const repCoordsByRi: Record<string, { lat: number; lng: number }[]> = {};
      for (const p of repWithCoords) {
        if (!repCoordsByRi[p.ri]) repCoordsByRi[p.ri] = [];
        repCoordsByRi[p.ri].push(p.coords!);
      }

      // 대표필지 매칭 키 셋 (추출 알고리즘에서 우선 선택용)
      const repParcelKeys = new Set<string>();
      for (const p of enrichedEligibleRep) {
        repParcelKeys.add(matchKey(p));
        repParcelKeys.add(`${p.farmerId}_${p.parcelId}`);
      }

      // ── 2. 공익직불제 추출 (대표필지 근처 우선) ──
      const publicTarget = config.publicPaymentTarget;

      const effectiveConfig = {
        ...config,
        totalTarget: publicTarget,
        referenceCentroid: repCentroid ?? undefined,
        repCoordsByRi,
        repParcelKeys,
      };

      const result = publicTarget > 0
        ? extractParcels(allParcels, effectiveConfig)
        : { selectedParcels: [], riStats: [], farmerStats: [], validation: { isValid: true, warnings: [], errors: [] } };

      // ── 3. 적격 대표필지를 결과에 직접 추가 (공익직불제와 중복되면 태깅만) ──
      const selectedKeySet = new Set(result.selectedParcels.map(matchKey));
      const selectedFarmerKeySet = new Set(result.selectedParcels.map(p => `${p.farmerId}_${p.parcelId}`));

      // 공익직불제 추출 결과 중 대표필지와 매칭되는 것은 카테고리 태깅 (공익직불제에 남김)
      let repInPublicCount = 0;
      const taggedPublic = result.selectedParcels.map(p => {
        const isRep = repParcelKeys.has(matchKey(p)) || repParcelKeys.has(`${p.farmerId}_${p.parcelId}`);
        if (isRep) repInPublicCount++;
        return p; // 공익직불제 카테고리 유지
      });

      // 공익직불제에 포함되지 않은 적격 대표필지 → 대표필지로 직접 추가
      const repNotInPublic = enrichedEligibleRep.filter(p =>
        !selectedKeySet.has(matchKey(p)) && !selectedFarmerKeySet.has(`${p.farmerId}_${p.parcelId}`)
      );

      const repDirect = enrichedEligibleRep.map(p => ({
        ...p,
        parcelCategory: 'representative' as const,
        isSelected: true,
      }));

      console.info(`[추출] 대표필지 처리: 적격 ${enrichedEligibleRep.length}건 전부 포함 (공익직불제 중복 ${repInPublicCount}건, 신규 추가 ${repNotInPublic.length}건)`);

      // ── 4. 부적격 대표필지 → 마스터에서 대체 복사 ──
      let repSupplementCount = 0;
      const repSupplements: Parcel[] = [];

      if (excludedRepReasons.length > 0) {
        // 이미 선택된 키 모음
        const allUsedKeys = new Set([
          ...taggedPublic.map(matchKey),
          ...repDirect.map(matchKey),
        ]);

        // 마스터에서 대체 후보 (적격 + 미선택)
        const masterCandidates = allParcels.filter(p => {
          if (!p.isEligible) return false;
          if (config.excludedRis.includes(p.ri)) return false;
          const area = getParcelArea(p);
          if (area !== null && area < MIN_AREA) return false;
          return !allUsedKeys.has(matchKey(p));
        });

        // 대표필지 중심 근처 우선 정렬
        let sorted: Parcel[];
        if (repCentroid) {
          sorted = masterCandidates
            .filter(p => p.coords != null)
            .sort((a, b) =>
              haversineDistance(repCentroid, a.coords!) - haversineDistance(repCentroid, b.coords!)
            );
          // 좌표 없는 후보도 뒤에 추가
          const noCoord = masterCandidates.filter(p => p.coords == null);
          sorted = [...sorted, ...noCoord];
        } else {
          sorted = masterCandidates;
        }

        const shortage = excludedRepReasons.length;
        for (const p of sorted) {
          if (repSupplements.length >= shortage) break;
          repSupplements.push({
            ...p,
            parcelCategory: 'representative' as const,
            isSelected: true,
          });
        }
        repSupplementCount = repSupplements.length;

        if (repSupplementCount > 0) {
          console.info(`[추출] 부적격 대표필지 ${excludedRepReasons.length}건 → 마스터에서 ${repSupplementCount}건 대체 복사`);
        }
        if (repSupplementCount < shortage) {
          console.warn(`[추출] 대표필지 대체 부족: ${shortage - repSupplementCount}건 미충족`);
        }
      }

      // ── 5. 최종 병합 ──
      // 공익직불제 + 적격 대표필지 + 대체 대표필지
      const finalParcels = [
        ...taggedPublic,
        ...repDirect,
        ...repSupplements,
      ];

      console.info(`[추출] 최종: 공익직불제 ${taggedPublic.length}건 + 대표필지 ${repDirect.length + repSupplements.length}건 = 총 ${finalParcels.length}건`);

      set({
        result: { ...result, selectedParcels: finalParcels },
        isRunning: false,
      });
    } catch (err) {
      set({
        isRunning: false,
        error: err instanceof Error ? err.message : '추출 중 오류가 발생했습니다.',
      });
    }
  },

  toggleParcelSelection: (farmerId, parcelId) =>
    set((state) => {
      if (!state.result) return state;
      const selected = state.result.selectedParcels;
      const exists = selected.some(
        (p) => p.farmerId === farmerId && p.parcelId === parcelId
      );
      const newSelected = exists
        ? selected.filter(
            (p) => !(p.farmerId === farmerId && p.parcelId === parcelId)
          )
        : selected;

      return {
        result: { ...state.result, selectedParcels: newSelected },
      };
    }),

  addParcel: (parcel) =>
    set((state) => {
      if (!state.result) return state;
      return {
        result: {
          ...state.result,
          selectedParcels: [
            ...state.result.selectedParcels,
            { ...parcel, isSelected: true },
          ],
        },
      };
    }),

  removeParcel: (farmerId, parcelId) =>
    set((state) => {
      if (!state.result) return state;
      return {
        result: {
          ...state.result,
          selectedParcels: state.result.selectedParcels.filter(
            (p) => !(p.farmerId === farmerId && p.parcelId === parcelId)
          ),
        },
      };
    }),

  getValidation: () => get().result?.validation ?? null,

  reset: () => set({ config: { ...DEFAULT_CONFIG }, result: null, isRunning: false, error: null }),
}));
