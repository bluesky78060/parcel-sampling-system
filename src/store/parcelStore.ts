import { create } from 'zustand';
import type { Parcel, Statistics, DuplicateResult } from '../types';
import { clearGeocodeCache } from '../lib/kakaoGeocoder';
import { parcelMatchKey } from '../lib/parcelKey';

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
        // 고유 필지 기준으로 센다. 단순 합산은 대표필지가 마스터와 겹칠 때
        // 같은 필지를 두 번 세어 "달성 가능"으로 잘못 판정한다 — 분석 화면에서
        // 가능하다고 보고 진행했다가 추출 후에야 목표 미달을 만난다.
        canMeetTarget: new Set([
          ...eligible.map(parcelMatchKey),
          ...representativeParcels.filter(p => p.isEligible).map(parcelMatchKey),
        ]).size >= totalTarget,
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
    // zustand action은 동기라 기다릴 수 없다. reset 직후 지오코딩을 시작하는
    // 경로는 없으므로(파일 업로드부터 다시 한다) 여기서는 경합이 문제되지 않는다.
    void clearGeocodeCache();
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
