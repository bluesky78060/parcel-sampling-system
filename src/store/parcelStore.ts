import { create } from 'zustand';
import type { Parcel, Statistics, DuplicateResult } from '../types';
import { clearGeocodeCache } from '../lib/kakaoGeocoder';

interface ParcelStore {
  allParcels: Parcel[];
  sampled2024: Parcel[];
  sampled2025: Parcel[];
  representativeParcels: Parcel[];
  duplicateResult: DuplicateResult | null;
  statistics: Statistics | null;

  setAllParcels: (parcels: Parcel[]) => void;
  setSampled2024: (parcels: Parcel[]) => void;
  setSampled2025: (parcels: Parcel[]) => void;
  setRepresentativeParcels: (parcels: Parcel[]) => void;
  setDuplicateResult: (result: DuplicateResult) => void;
  updateParcels: (parcels: Parcel[]) => void;
  calculateStatistics: (totalTarget?: number) => void;
  getEligibleParcels: () => Parcel[];
  getRiList: () => string[];
  getRiDistribution: () => Record<string, { total: number; eligible: number }>;
  reset: () => void;
}

export const useParcelStore = create<ParcelStore>((set, get) => ({
  allParcels: [],
  sampled2024: [],
  sampled2025: [],
  representativeParcels: [],
  duplicateResult: null,
  statistics: null,

  setAllParcels: (parcels) => set({ allParcels: parcels }),
  setSampled2024: (parcels) => set({ sampled2024: parcels }),
  setSampled2025: (parcels) => set({ sampled2025: parcels }),
  setRepresentativeParcels: (parcels) => set({ representativeParcels: parcels }),
  setDuplicateResult: (result) => set({ duplicateResult: result }),

  updateParcels: (parcels) => set({ allParcels: parcels }),

  calculateStatistics: (totalTarget = 700) => {
    const { allParcels, representativeParcels } = get();
    const eligible = allParcels.filter((p) => p.isEligible);
    const riSet = new Set(eligible.map((p) => p.ri));
    const sampled2024Count = allParcels.filter((p) => p.sampledYears.includes(2024)).length;
    const sampled2025Count = allParcels.filter((p) => p.sampledYears.includes(2025)).length;

    set({
      statistics: {
        totalParcels: allParcels.length,
        sampled2024: sampled2024Count,
        sampled2025: sampled2025Count,
        eligibleParcels: eligible.length,
        uniqueRis: riSet.size,
        canMeetTarget: eligible.length + representativeParcels.length >= totalTarget,
        representativeParcels: representativeParcels.length,
      },
    });
  },

  getEligibleParcels: () => get().allParcels.filter((p) => p.isEligible),

  getRiList: () => {
    const riSet = new Set(get().allParcels.map((p) => p.ri));
    return Array.from(riSet).sort();
  },

  getRiDistribution: () => {
    const { allParcels } = get();
    const dist: Record<string, { total: number; eligible: number }> = {};
    for (const p of allParcels) {
      if (!dist[p.ri]) dist[p.ri] = { total: 0, eligible: 0 };
      dist[p.ri].total++;
      if (p.isEligible) dist[p.ri].eligible++;
    }
    return dist;
  },

  reset: () => {
    clearGeocodeCache();
    set({
      allParcels: [],
      sampled2024: [],
      sampled2025: [],
      representativeParcels: [],
      duplicateResult: null,
      statistics: null,
    });
  },
}));
