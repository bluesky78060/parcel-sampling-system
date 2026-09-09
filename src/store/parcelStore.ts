import { create } from 'zustand';
import type { Parcel, Statistics, DuplicateResult } from '../types';
import { clearGeocodeCache } from '../lib/kakaoGeocoder';
import { countUniqueParcels } from '../lib/parcelKey';
import { useSurveyStore, sampledYearsOf } from './surveyStore';

interface ParcelStore {
  allParcels: Parcel[];
  /** 기채취 필지. 키는 연도 — 예전에는 sampled2024/sampled2025 두 필드였다 */
  sampledByYear: Record<number, Parcel[]>;
  representativeParcels: Parcel[];
  duplicateResult: DuplicateResult | null;
  statistics: Statistics | null;

  /**
   * 아래 `set*`는 **적재용**이다 — 방금 파싱한 파일에서 만든 값으로 통째 교체한다.
   * 인자가 스토어에서 온 것이 아니므로 낡을 수가 없다. 반대로 스토어를 읽어
   * 고쳐 쓰는 것은 전부 `update*`이며, 그쪽은 **함수형만** 받는다.
   */
  setAllParcels: (parcels: Parcel[]) => void;
  setSampledByYear: (byYear: Record<number, Parcel[]>) => void;
  setRepresentativeParcels: (parcels: Parcel[]) => void;
  setDuplicateResult: (result: DuplicateResult) => void;

  /**
   * `allParcels`를 읽고-고쳐-쓴다.
   *
   * **배열을 직접 받지 않는다.** 예전 시그니처(`(parcels: Parcel[]) => void`)는
   * 전체 교체였고, 호출자가 `await` 앞에서 읽어 둔 배열을 넘기면 기다리는 동안
   * 들어온 쓰기가 전부 사라졌다(PROJ1-1-44: 좌표 변환 중 생성한 PNU 유실).
   *
   * 그때 고친 것은 호출부 두 곳의 **관례**였다 — "await 뒤에는 getState()로 다시
   * 읽는다". 관례는 다음에 추가될 async 핸들러를 막지 못한다. 함수형만 받으면
   * 읽기가 zustand의 `set` 안에서 원자적으로 일어나므로 **어떤 호출자도 낡은
   * 배열을 넘길 수 없다.** 타입 수준에서 표현 자체가 불가능해진다.
   */
  updateParcels: (updater: (prev: Parcel[]) => Parcel[]) => void;
  /** `representativeParcels`를 읽고-고쳐-쓴다. 이유는 `updateParcels`와 같다. */
  updateRepresentativeParcels: (updater: (prev: Parcel[]) => Parcel[]) => void;
  calculateStatistics: (totalTarget?: number) => void;
  getEligibleParcels: () => Parcel[];
  getRiList: () => string[];
  getRiDistribution: () => Record<string, { total: number; eligible: number }>;
  reset: () => void;
}

export const useParcelStore = create<ParcelStore>((set, get) => ({
  allParcels: [],
  sampledByYear: {},
  representativeParcels: [],
  duplicateResult: null,
  statistics: null,

  setAllParcels: (parcels) => set({ allParcels: parcels }),
  setSampledByYear: (byYear) => set({ sampledByYear: byYear }),
  setRepresentativeParcels: (parcels) => set({ representativeParcels: parcels }),
  setDuplicateResult: (result) => set({ duplicateResult: result }),

  updateParcels: (updater) => set((s) => ({ allParcels: updater(s.allParcels) })),
  updateRepresentativeParcels: (updater) =>
    set((s) => ({ representativeParcels: updater(s.representativeParcels) })),

  calculateStatistics: (totalTarget = 700) => {
    const { allParcels, representativeParcels } = get();
    const eligible = allParcels.filter((p) => p.isEligible);
    const riSet = new Set(eligible.map((p) => p.ri));
    // 연도를 리터럴로 두지 않는다 — 조사 연도에서 파생된 값으로 센다
    const sampledCountByYear: Record<number, number> = {};
    for (const y of sampledYearsOf(useSurveyStore.getState().surveyYear)) {
      sampledCountByYear[y] = allParcels.filter((p) => p.sampledYears.includes(y)).length;
    }

    set({
      statistics: {
        totalParcels: allParcels.length,
        sampledCountByYear,
        eligibleParcels: eligible.length,
        uniqueRis: riSet.size,
        // 고유 필지 기준으로 센다. 단순 합산은 대표필지가 마스터와 겹칠 때
        // 같은 필지를 두 번 세어 "달성 가능"으로 잘못 판정한다 — 분석 화면에서
        // 가능하다고 보고 진행했다가 추출 후에야 목표 미달을 만난다.
        // 'exclude' — 식별 불가능한 필지는 가용 재고로 세지 않는다.
        // 그것들은 리 그룹에 들어가지 못하고 지오코딩도 안 되며 현장 지시서로 쓸 수 없다.
        // 세면 "달성 가능"이 낙관 쪽으로 기울어, 분석 화면에서 가능하다고 보고
        // 진행했다가 추출 후에야 미달을 만난다.
        canMeetTarget: countUniqueParcels(
          [...eligible, ...representativeParcels.filter(p => p.isEligible)],
          'exclude',
        ) >= totalTarget,
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
      sampledByYear: {},
      representativeParcels: [],
      duplicateResult: null,
      statistics: null,
    });
  },
}));
