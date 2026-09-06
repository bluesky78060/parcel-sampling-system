import { create } from 'zustand';
import type { ExtractionConfig, ExtractionResult, Parcel, SpatialConfig, ValidationResult } from '../types';
import { extractParcels, getParcelArea, validateExtraction, generateRiStats, generateFarmerStats, MIN_AREA } from '../lib/extractionAlgorithm';
import { calculateCentroid, haversineDistance } from '../lib/spatialUtils';

/** 필지 매칭 키: PNU 또는 주소+필지번호 (excelExporter.getParcelKey와 동일 공식) */
const matchKey = (p: Parcel) => p.pnu || `${p.address}__${p.parcelId}`;

/**
 * 경영체번호 기반 보조 키. 대표필지 파일에는 경영체번호가 없을 수 있는데,
 * 빈 값끼리 매칭시키면 무관한 필지가 같은 필지로 취급되므로 키 자체를 만들지 않는다.
 */
const farmerKey = (p: Parcel): string | null =>
  p.farmerId ? `${p.farmerId}_${p.parcelId}` : null;

/** 결과 배열에서 겹치는 필지를 1건으로 접은 배열 (공익직불제 행을 우선 보존) */
export function dedupeSelected(parcels: Parcel[]): Parcel[] {
  const seen = new Set<string>();
  const result: Parcel[] = [];
  for (const p of parcels) {
    const key = matchKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(p);
  }
  return result;
}

/** 결과 배열의 고유 필지 수 (공익직불제 ↔ 대표필지 겹침을 1건으로 계산) */
export function countUniqueSelected(parcels: Parcel[]): number {
  return new Set(parcels.map(matchKey)).size;
}

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
        const fk = farmerKey(p);
        if (fk) masterByFarmerKey.set(fk, p);
      }

      let enrichedCount = 0;
      const enrichedEligibleRep = eligibleRep.map(rep => {
        const repFk = farmerKey(rep);
        const pub = masterByKey.get(matchKey(rep))
          // 경영체번호가 없으면 PNU/주소 매칭만 쓴다 — 빈 값 폴백은 오매칭을 부른다
          || (repFk ? masterByFarmerKey.get(repFk) : undefined)
          || (rep.farmerId
            ? allParcels.find(p => p.farmerId === rep.farmerId && p.parcelId === rep.parcelId)
              || allParcels.find(p => p.farmerId === rep.farmerId)
            : undefined);

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
        const fk = farmerKey(p);
        if (fk) repParcelKeys.add(fk);
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
      const selectedFarmerKeySet = new Set(
        result.selectedParcels.map(farmerKey).filter((k): k is string => k !== null)
      );

      // 대표필지는 총 목표(publicPaymentTarget) '안에' 포함된다.
      // 즉 공익직불제 700건 중 일부가 대표필지이지, 700에 더해지는 별도 쿼터가 아니다.
      //
      // 그래서 공익 추출에 이미 뽑힌 대표필지는 **행을 새로 만들지 않고 태깅만** 한다.
      // 예전에는 적격 대표필지 전부를 `repDirect`로 다시 넣어서, 같은 필지가
      // 공익직불제 행과 대표필지 행으로 두 번 실렸다(고유 700인데 화면 730행).
      const taggedPublic = result.selectedParcels.map(p => {
        const fk = farmerKey(p);
        const isRep = repParcelKeys.has(matchKey(p)) || (fk !== null && repParcelKeys.has(fk));
        return isRep ? { ...p, parcelCategory: 'representative' as const } : p;
      });
      const repInPublicCount = taggedPublic.filter(p => p.parcelCategory === 'representative').length;

      // 공익직불제에 뽑히지 않은 적격 대표필지만 추가한다.
      // 고정 관측점이므로 반드시 포함되어야 하고, 그만큼 신규 추출분이 밀려난다.
      const repNotInPublic = enrichedEligibleRep.filter(p => {
        const fk = farmerKey(p);
        return !selectedKeySet.has(matchKey(p)) && !(fk !== null && selectedFarmerKeySet.has(fk));
      });

      const repDirect = repNotInPublic.map(p => ({
        ...p,
        parcelCategory: 'representative' as const,
        isSelected: true,
      }));

      console.info(`[추출] 대표필지 처리: 적격 ${enrichedEligibleRep.length}건 — 공익직불제에서 선택됨 ${repInPublicCount}건(태깅만), 별도 추가 ${repDirect.length}건`);

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
      // 대표필지는 총 목표 '안에' 들어간다. 공익 추출에서 뽑히지 못한 대표필지를
      // 그냥 더하면 목표를 넘으므로, 넘는 만큼 비대표 필지를 덜어내 자리를 만든다.
      // 대표필지는 고정 관측점이라 반드시 포함되어야 하고, 밀려나는 쪽은 신규 추출분이다.
      const merged = [...taggedPublic, ...repDirect, ...repSupplements];
      const overflow = publicTarget > 0 ? merged.length - publicTarget : 0;

      let finalParcels = merged;
      if (overflow > 0) {
        // 리별 초과분부터 덜어낸다.
        //
        // 예전에는 배열 뒤에서부터 잘랐는데, `merged`는 점수 내림차순이 아니라
        // **리 단위로 순차 push된** 배열이다(extractParcels Step 3). 그래서
        // "뒤에서부터"는 "마스터에 늦게 등장한 리부터"였고, 리 71개 ×
        // perRiTarget 10 = 710처럼 리별 목표 합이 총 목표를 넘는 실사용 설정에서
        // **마지막 리가 통째로 날아갔다**(그 리 selectedCount 0 → RI_UNDERFILL).
        //
        // 목표를 가장 많이 초과한 리에서 한 건씩 돌아가며 빼면 특정 리만
        // 파먹히지 않는다. 각 리 안에서는 뒤쪽(점수가 낮은 쪽)부터 뺀다.
        // 대표필지는 애초에 후보에 넣지 않으므로 보호된다.
        const riPools = new Map<string, number[]>();
        for (let i = 0; i < merged.length; i++) {
          if (merged[i].parcelCategory === 'representative') continue;
          const ri = merged[i].ri;
          if (!riPools.has(ri)) riPools.set(ri, []);
          riPools.get(ri)!.push(i);
        }
        const pools = [...riPools.entries()].map(([ri, idxs]) => ({
          ri,
          idxs,
          target: config.riTargetOverrides[ri] ?? config.perRiTarget,
        }));

        const dropIdx = new Set<number>();
        while (dropIdx.size < overflow && pools.length > 0) {
          // 목표 대비 초과가 큰 리부터 (동률이면 많이 가진 리부터)
          pools.sort((a, b) =>
            (b.idxs.length - b.target) - (a.idxs.length - a.target) ||
            b.idxs.length - a.idxs.length
          );
          const top = pools[0];
          if (top.idxs.length === 0) break;
          dropIdx.add(top.idxs.pop()!);
        }

        finalParcels = merged.filter((_, i) => !dropIdx.has(i));
        const repAdded = repDirect.length + repSupplements.length;
        console.info(
          `[추출] 목표(${publicTarget}) 유지를 위해 신규 추출분 ${dropIdx.size}건 제외 ` +
          `— 대표필지 추가 ${repAdded}건, 리별 목표 합 초과 ${Math.max(0, overflow - repAdded)}건`
        );
        if (dropIdx.size < overflow) {
          console.warn(
            `[추출] 목표 초과 ${overflow - dropIdx.size}건 — 대표필지가 목표보다 많아 줄일 수 없습니다`
          );
        }
      }

      const uniqueCount = countUniqueSelected(finalParcels);
      const repCount = finalParcels.filter(p => p.parcelCategory === 'representative').length;
      console.info(
        `[추출] 최종 ${finalParcels.length}건 (고유 ${uniqueCount}건) — ` +
        `그중 대표필지 ${repCount}건, 신규 추출 ${finalParcels.length - repCount}건`
      );

      // ── 6. 최종 결과 기준으로 재검증 ──
      // extractParcels가 만든 validation은 공익직불제 필지만, 그것도
      // publicPaymentTarget으로 덮인 목표를 기준으로 계산한 것이다. 화면에는
      // 대표필지까지 병합한 결과가 뜨므로 그대로 두면 "목표 700인데 N개"
      // 경고가 실제 숫자와 어긋난다.
      // 검증·통계와 화면·엑셀이 서로 다른 배열을 보면 같은 화면에서 숫자가 갈린다.
      // 하나로 통일한다. matchKey는 마스터에서 고유하지 않으므로(같은 지번을
      // 작물별로 여러 행 등록) dedupe는 여전히 의미가 있다.
      finalParcels = dedupeSelected(finalParcels);

      // 목표는 공익직불제 목표 그 자체다. 대표필지는 그 안에 들어가므로 더하지 않는다.
      // `config.totalTarget`은 쓰지 않는다 — 사용자가 입력한 두 수의 합이라
      // "대표필지 별도 쿼터"를 전제하는데, 확정된 규칙은 '총 목표 안에 포함'이다.
      // publicTarget이 0이면 대표필지 전용 실행이므로 결과 자체가 목표다.
      const effectiveTotal = publicTarget > 0 ? publicTarget : finalParcels.length;

      // 통계도 병합 기준으로 다시 만든다. 그대로 두면 RI_UNDERFILL만 공익
      // 기준이 되어 같은 화면 안에서 숫자가 어긋난다.
      const mergedRiStats = generateRiStats(allParcels, finalParcels, config);
      const mergedFarmerStats = generateFarmerStats(finalParcels);

      // 농가 제한 면제는 **사용자가 지정한 대표필지**에만 준다.
      // 카테고리(`parcelCategory === 'representative'`)로 거르면 셋이 섞인다.
      //  - repDirect      : 사용자 지정, 농가별 슬라이스를 안 거침 → 면제 타당
      //  - taggedPublic   : 사용자 지정이지만 **슬라이스를 이미 거쳐** 뽑힌 것
      //  - repSupplements : 알고리즘이 고른 대체분, 사용자 지정이 아님
      // 뒤 둘까지 면제하면 한 농가에 몰려도 경고가 안 뜬다.
      const exemptKeys = new Set(repDirect.map(matchKey));

      const validation = validateExtraction(finalParcels, config, mergedRiStats, {
        totalTarget: effectiveTotal,
        exemptFarmerLimitKeys: exemptKeys,
      });

      set({
        result: {
          ...result,
          selectedParcels: finalParcels,
          riStats: mergedRiStats,
          farmerStats: mergedFarmerStats,
          validation,
        },
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
