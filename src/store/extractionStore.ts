import { create } from 'zustand';
import type { ExtractionConfig, ExtractionResult, Parcel, SpatialConfig, ValidationResult } from '../types';
import { extractParcels } from '../lib/extractionAlgorithm';

const DEFAULT_CONFIG: ExtractionConfig = {
  totalTarget: 700,
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
      const repCount = representativeParcels.length;
      const effectiveTarget = Math.max(0, config.totalTarget - repCount);

      // 공익직불제 필지만 추출 알고리즘에 전달
      const effectiveConfig = { ...config, totalTarget: effectiveTarget };
      const result = effectiveTarget > 0
        ? extractParcels(allParcels, effectiveConfig)
        : { selectedParcels: [], riStats: [], farmerStats: [], validation: { isValid: true, warnings: [], errors: [] } };

      // 대표필지를 앞에 병합
      const finalSelected = [
        ...representativeParcels.map(p => ({ ...p, isSelected: true })),
        ...result.selectedParcels,
      ];

      set({
        result: { ...result, selectedParcels: finalSelected },
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
