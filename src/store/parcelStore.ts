import { create } from 'zustand';
import type { Parcel, Statistics, DuplicateResult } from '../types';

interface ParcelStore {
  allParcels: Parcel[];
  sampled2024: Parcel[];
  sampled2025: Parcel[];
  duplicateResult: DuplicateResult | null;
  statistics: Statistics | null;

  setAllParcels: (parcels: Parcel[]) => void;
  setSampled2024: (parcels: Parcel[]) => void;
  setSampled2025: (parcels: Parcel[]) => void;
  setDuplicateResult: (result: DuplicateResult) => void;
  updateParcels: (parcels: Parcel[]) => void;
  calculateStatistics: () => void;
  getEligibleParcels: () => Parcel[];
  getRiList: () => string[];
  getRiDistribution: () => Record<string, { total: number; eligible: number }>;
  reset: () => void;
}

export const useParcelStore = create<ParcelStore>((set, get) => ({
  allParcels: [],
  sampled2024: [],
  sampled2025: [],
  duplicateResult: null,
  statistics: null,

  setAllParcels: (parcels) => set({ allParcels: parcels }),
  setSampled2024: (parcels) => set({ sampled2024: parcels }),
  setSampled2025: (parcels) => set({ sampled2025: parcels }),
  setDuplicateResult: (result) => set({ duplicateResult: result }),

  updateParcels: (parcels) => set({ allParcels: parcels }),

  calculateStatistics: () => {
    const { allParcels, duplicateResult } = get();
    const eligible = allParcels.filter((p) => p.isEligible);
    const riSet = new Set(eligible.map((p) => p.ri));

    set({
      statistics: {
        totalParcels: allParcels.length,
        sampled2024: duplicateResult?.duplicateCount2024 ?? 0,
        sampled2025: duplicateResult?.duplicateCount2025 ?? 0,
        eligibleParcels: eligible.length,
        uniqueRis: riSet.size,
        canMeetTarget: eligible.length >= 700,
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

  reset: () =>
    set({
      allParcels: [],
      sampled2024: [],
      sampled2025: [],
      duplicateResult: null,
      statistics: null,
    }),
}));
