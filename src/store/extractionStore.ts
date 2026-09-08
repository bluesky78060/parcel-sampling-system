import { create } from 'zustand';
import type { ExtractionConfig, ExtractionResult, Parcel, SpatialConfig, ValidationResult } from '../types';
import { extractParcels, getParcelArea, validateExtraction, generateRiStats, generateFarmerStats, MIN_AREA } from '../lib/extractionAlgorithm';
import { calculateCentroid, haversineDistance } from '../lib/spatialUtils';
import { isRepresentative, markAsRepresentative, representativeCategoryOf } from '../lib/parcelCategory';
import { parcelMatchKey, parcelFarmerKey, countUniqueParcels, keySetOf } from '../lib/parcelKey';

/**
 * 대표필지를 상한만큼 리별로 고르게 남긴다.
 *
 * 예전에는 `representativeTarget`을 아무도 읽지 않아 적격 대표필지가 **전부** 들어갔다.
 * 그것이 공익 목표를 넘으면 초과분 제거가 비대표만 걷어내므로, 적격 대표가 목표보다
 * 많으면 **결과가 전원 대표필지**가 됐다(공익 800 / 대표 260 설정에서 실제로 그랬다).
 *
 * 앞에서부터 자르면 파일 순서에 따라 특정 리에 몰린다. 리별 라운드로빈으로 뽑아
 * 공간 분포를 유지한다.
 */
function limitRepresentativesByRi(reps: Parcel[], limit: number): Parcel[] {
  if (limit <= 0 || reps.length <= limit) return reps;

  const byRi = new Map<string, Parcel[]>();
  for (const p of reps) {
    if (!byRi.has(p.ri)) byRi.set(p.ri, []);
    byRi.get(p.ri)!.push(p);
  }

  const picked: Parcel[] = [];
  const queues = [...byRi.values()];
  let cursor = 0;
  // 각 리에서 한 건씩 돌아가며 뽑는다. 모든 큐가 비면 종료(무한루프 방지).
  while (picked.length < limit) {
    let progressed = false;
    for (let i = 0; i < queues.length && picked.length < limit; i++) {
      const q = queues[(cursor + i) % queues.length];
      const item = q.shift();
      if (item) { picked.push(item); progressed = true; }
    }
    if (!progressed) break;
    cursor++;
  }
  return picked;
}

// 키 공식은 lib/parcelKey 하나만 쓴다 — 예전에 네 곳에 복제돼 있었다
const matchKey = parcelMatchKey;
const farmerKey = parcelFarmerKey;

/**
 * "이 필지와 같은 것인가"를 판정하는 술어.
 *
 * 예전에는 `p.farmerId === farmerId && p.parcelId === parcelId`로 비교했다.
 * 지번은 리를 넘어 고유하지 않고 경영체번호는 빌 수 있으므로,
 * **검토 화면에서 문단리의 농가 미상 지번 100을 한 건 빼면 내성리의 것도 함께
 * 700건에서 사라졌다.** 화면에는 아무 표시도 없었다.
 *
 * 키가 있으면 **필지 단위**로 판정한다. 사용자가 보는 단위가 그것이기 때문이다 —
 * 화면의 선택 수도, 엑셀 출력도 겹치는 필지를 1건으로 접는다. 한 행만 지우면
 * 카운트는 그대로이고 체크박스도 켜져 있어 클릭이 먹히지 않은 것으로 보인다.
 *
 * 키가 없으면 **행 단위**(`rowUid`)로 판정한다. 예전에는 참조로 비교했는데,
 * `addParcel`이 `{...parcel, isSelected: true}` 사본을 저장하는 순간 참조가 끊겨
 * 중복 검사가 매번 실패했다 — 클릭할 때마다 700에 행이 쌓였다.
 * `rowUid`는 파싱 시점에 부여되어 사본에도 따라가므로 그 구멍이 없다.
 */
function sameParcelPredicate(target: Parcel): (p: Parcel) => boolean {
  const key = matchKey(target);
  if (key === null) return (p) => p.rowUid === target.rowUid;
  return (p) => matchKey(p) === key;
}

/** 결과 배열에서 겹치는 필지를 1건으로 접은 배열 (공익직불제 행을 우선 보존) */
export function dedupeSelected(parcels: Parcel[]): Parcel[] {
  const seen = new Set<string>();
  const result: Parcel[] = [];
  for (const p of parcels) {
    const key = matchKey(p);
    // 식별 불가능한 필지(PNU·주소·지번이 모두 빈 행)는 접지 않고 각각 남긴다.
    // 빈 키끼리 같은 필지로 볼 근거가 없다 — 접으면 결과에서 조용히 사라진다.
    if (key === null) {
      result.push(p);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(p);
  }
  return result;
}

/** 결과 배열의 고유 필지 수 (공익직불제 ↔ 대표필지 겹침을 1건으로 계산) */
export function countUniqueSelected(parcels: Parcel[]): number {
  // 결과 집계다 — 이 행들은 실제로 엑셀에 나가므로 식별 불가능해도 각각 1건이다.
  // (달성 가능성 판정은 반대로 'exclude'를 쓴다 — `parcelStore.canMeetTarget`)
  return countUniqueParcels(parcels, 'each');
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
  toggleParcelSelection: (parcel: Parcel) => void;
  addParcel: (parcel: Parcel) => void;
  removeParcel: (parcel: Parcel) => void;

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
          excludedRepReasons.push({ parcel: p, reason: '기채취 연도 중복' });
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
        const mk = matchKey(p);
        if (mk) masterByKey.set(mk, p);
        const fk = farmerKey(p);
        if (fk) masterByFarmerKey.set(fk, p);
      }

      // 리 표기는 파일마다 다를 수 있다("봉화읍 내성리" / "내성리"). 마지막 토큰으로 비교한다.
      // 한쪽이 비어 있으면 판단을 유보한다(빈 리로 걸러 버리면 보충이 통째로 끊긴다).
      const riTail = (ri: string) => ri.trim().split(/\s+/).pop() ?? '';
      const sameRi = (a: string, b: string) => !a || !b || riTail(a) === riTail(b);

      let enrichedCount = 0;
      const enrichedEligibleRep = eligibleRep.map(rep => {
        const repFk = farmerKey(rep);
        // 같은 필지를 가리키는 마스터 행. 경영체번호+지번 폴백에서도 리를 본다 —
        // 안 보면 farmerKey에 ri를 넣은 보호가 여기서 우회된다: 다른 리의 같은 지번이
        // 매칭되고 그 PNU가 대표필지 행에 기입되어 제출 파일로 나간다.
        const repMk = matchKey(rep);
        const sameParcel = (repMk ? masterByKey.get(repMk) : undefined)
          // 경영체번호가 없으면 PNU/주소 매칭만 쓴다 — 빈 값 폴백은 오매칭을 부른다
          || (repFk ? masterByFarmerKey.get(repFk) : undefined)
          // ⚠️ `parcelId`가 비면 이 폴백도 쓰지 않는다. 양쪽 다 `''`이면 `===`가 참이 되어
          // 무관한 필지가 같은 필지로 매칭되고, 그 PNU·좌표가 대표필지 행에 기입돼
          // 제출 파일로 나간다(PROJ1-1-40). `parcelFarmerKey`만 고치면 여기가 남는다 —
          // 템플릿 문자열이 아니라 `===` 비교라 `grep`으로도 안 잡힌다.
          || (rep.farmerId && rep.parcelId
            ? allParcels.find(p =>
                p.farmerId === rep.farmerId && p.parcelId === rep.parcelId && sameRi(p.ri, rep.ri))
            : undefined);
        // 같은 농가의 아무 필지 — 경영체 정보만 가져온다. 필지 식별 정보(PNU·좌표·주소)는
        // 다른 필지의 것이므로 복사하면 엉뚱한 PNU가 실린다.
        const sameFarmer = !sameParcel && rep.farmerId
          ? allParcels.find(p => p.farmerId === rep.farmerId)
          : undefined;
        const pub = sameParcel ?? sameFarmer;

        if (!pub) return rep;

        enrichedCount++;
        const merged: Parcel = { ...rep };

        // 경영체 3대 정보 — 마스터 기준 강제 복사
        if (pub.farmerId) merged.farmerId = pub.farmerId;
        if (pub.farmerName) merged.farmerName = pub.farmerName;
        if (pub.farmerAddress) merged.farmerAddress = pub.farmerAddress;

        if (!sameParcel) return merged;

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

      // 사용자가 지정한 대표필지 수만큼만 남긴다. 여기서 줄여야 추출 알고리즘의
      // 우선 선택과 이후 병합이 **같은 집합**을 본다. 뒤에서 자르면 알고리즘이 이미
      // 상한 밖 대표필지를 우선 선택해 자리를 차지한 뒤가 된다.
      // 좌표 기준점(중심·리별 좌표)보다도 앞이어야 한다. 상한 밖 대표필지까지 넣어
      // 기준점을 잡으면 결과에 없는 필지 주변으로 공간 필터가 끌린다.
      // 대표필지는 총 목표 '안에' 들어간다. 대표 목표가 총 목표보다 크면 그 규칙이 깨져
      // 결과가 전원 대표필지가 된다(공익 200 / 대표 260 → 260건 전부 대표) — 사용자가
      // 신고한 증상 그대로다. 설정 화면이 두 값을 따로 클램프하므로 여기서 막는다.
      const publicTarget = config.publicPaymentTarget;
      let repCap = config.representativeTarget;
      if (publicTarget > 0 && repCap > publicTarget) {
        console.warn(`[추출] 대표필지 목표(${repCap})가 총 목표(${publicTarget})보다 큽니다 — 총 목표로 낮춰 적용`);
        repCap = publicTarget;
      }
      const repLimited = limitRepresentativesByRi(enrichedEligibleRep, repCap);
      if (repLimited.length < enrichedEligibleRep.length) {
        console.info(
          `[추출] 대표필지 상한 적용: 적격 ${enrichedEligibleRep.length}건 → ` +
          `${repLimited.length}건 (설정 ${repCap}, 리별 균등 배분)`
        );
      }

      // 대표필지 좌표 정보 (추출 우선순위용)
      const repWithCoords = repLimited.filter(p => p.coords != null);
      const repCentroid = repWithCoords.length > 0 ? calculateCentroid(repWithCoords) : undefined;

      // 리별 대표필지 좌표 매핑
      const repCoordsByRi: Record<string, { lat: number; lng: number }[]> = {};
      for (const p of repWithCoords) {
        if (!repCoordsByRi[p.ri]) repCoordsByRi[p.ri] = [];
        repCoordsByRi[p.ri].push(p.coords!);
      }

      // 대표필지 매칭 키 셋 (추출 알고리즘에서 우선 선택용)
      const repParcelKeys = new Set<string>();
      for (const p of repLimited) {
        const mk = matchKey(p);
        if (mk) repParcelKeys.add(mk);
        const fk = farmerKey(p);
        if (fk) repParcelKeys.add(fk);
      }

      // ── 2. 공익직불제 추출 (대표필지 근처 우선) ──
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
      // `keySetOf`가 `null`을 거른다 — **직접 `new Set(...map(key))`를 쓰지 말 것.**
      // `has(null)`이 true가 되어, 공익 추출에 뽑힌 필지 중 키 없는 것이 하나라도 있으면
      // 무관한 키 없는 적격 대표필지가 전부 "이미 뽑혔다"로 판정돼 결과에서 조용히
      // 사라진다(PROJ1-1-39). 형제 줄도 `allUsedKeys`도 `exemptKeys`도 거르는데 여기만
      // 빠져 있었다 — 손으로 붙이는 필터는 한 곳을 빠뜨린다.
      const selectedKeySet = keySetOf(result.selectedParcels, matchKey);
      const selectedFarmerKeySet = keySetOf(result.selectedParcels, farmerKey);

      // 대표필지는 총 목표(publicPaymentTarget) '안에' 포함된다.
      // 즉 공익직불제 700건 중 일부가 대표필지이지, 700에 더해지는 별도 쿼터가 아니다.
      //
      // 그래서 공익 추출에 이미 뽑힌 대표필지는 **행을 새로 만들지 않고 태깅만** 한다.
      // 예전에는 적격 대표필지 전부를 `repDirect`로 다시 넣어서, 같은 필지가
      // 공익직불제 행과 대표필지 행으로 두 번 실렸다(고유 700인데 화면 730행).
      // 카테고리를 'representative'로 **덮어쓰지 않는다**. 덮어쓰면 공익직불제 시트에서
      // 사라져 담당자에게 나가는 제출 파일의 행 수가 조용히 줄어든다.
      // 'both'는 두 성격을 동시에 가지므로 양쪽 시트에 모두 실린다.
      const taggedPublic = result.selectedParcels.map(p => {
        const fk = farmerKey(p);
        const mk = matchKey(p);
        const isRep =
          (mk !== null && repParcelKeys.has(mk)) || (fk !== null && repParcelKeys.has(fk));
        return isRep ? { ...p, parcelCategory: markAsRepresentative(p.parcelCategory) } : p;
      });
      const repInPublicCount = taggedPublic.filter(isRepresentative).length;

      // 공익직불제에 뽑히지 않은 적격 대표필지만 추가한다.
      // 고정 관측점이므로 반드시 포함되어야 하고, 그만큼 신규 추출분이 밀려난다.
      // 키가 없는 대표필지는 `selectedKeySet`에는 안 걸린다. **다만 `farmerKey`는 여전히
      // 본다** — 파싱 필터가 `farmerId || parcelId || address`라, 키 없이 살아남은 행은
      // 반드시 `farmerId`를 갖는다. 즉 `parcelFarmerKey`는 이 population에서 절대 `null`이
      // 아니고, 아래 `fk` 절은 도달 불가능한 방어가 아니라 **항상 동작하는 판정**이다.
      // (여기에 "어느 집합에도 안 걸린다"고 적었다가 리뷰가 실측으로 뒤집었다.)
      //
      // ⚠️ 그 `fk` 절이 `parcelId`가 빈 두 필지를 한 농가 한 리에서 같은 것으로 접는다 —
      // `parcelMatchKey`가 이미 고친 것과 같은 결함 유형이다. PROJ1-1-40으로 분리했다.
      const repNotInPublic = repLimited.filter(p => {
        const mk = matchKey(p);
        const fk = farmerKey(p);
        return (
          !(mk !== null && selectedKeySet.has(mk)) &&
          !(fk !== null && selectedFarmerKeySet.has(fk))
        );
      });

      // 경영체번호가 있으면 공익직불제와 혼용된다 — 'both'라야 양쪽 시트에 실린다.
      // 무조건 'representative'로 덮어쓰면 공익직불제 시트에서 사라진다.
      const repDirect = repNotInPublic.map(p => ({
        ...p,
        parcelCategory: representativeCategoryOf(p),
        isSelected: true,
      }));

      console.info(`[추출] 대표필지 처리: 대상 ${repLimited.length}건 — 공익직불제에서 선택됨 ${repInPublicCount}건(태깅만), 별도 추가 ${repDirect.length}건`);

      // ── 4. 부적격 대표필지 → 마스터에서 대체 복사 ──
      let repSupplementCount = 0;
      let repShortage = 0;
      const repSupplements: Parcel[] = [];

      if (excludedRepReasons.length > 0) {
        // 이미 선택된 키 모음. `keySetOf`가 `null`을 거른다 — 거르지 않으면 식별 불가능한
        // 필지 하나가 마스터의 다른 식별 불가능 필지를 **전부** 대체 후보에서 밀어낸다
        // (PROJ1-1-37).
        const used = [...taggedPublic, ...repDirect];
        const allUsedKeys = keySetOf(used, matchKey);
        // 키가 없는 행은 위 집합이 못 지킨다. 그대로 두면 **이미 공익에 뽑힌 키 없는
        // 마스터 행이 대체 보충으로 다시 담겨** 같은 행이 결과에 두 번 실렸다.
        // `dedupeSelected`는 키 없는 필지를 접지 않고(의도된 규칙) `countUniqueSelected`는
        // 'each'라, 700 목표가 실제로는 699필지 + 중복 1행으로 채워진다(PROJ1-1-39).
        const usedRowUids = new Set<string>(used.map(p => p.rowUid));

        // **판정 공식은 여기 하나뿐이다.** 후보 선별과 담는 루프가 각각 자기 식을 갖고
        // 있으면 서로를 가려, 한쪽을 되돌려도 테스트가 전부 통과한다(실측 확인).
        // 그러면 다음 사람이 "중복이니 지워도 된다"고 판단할 근거가 생긴다.
        const isAlreadyUsed = (p: Parcel): boolean => {
          const k = matchKey(p);
          return k === null ? usedRowUids.has(p.rowUid) : allUsedKeys.has(k);
        };
        const markUsed = (p: Parcel): void => {
          const k = matchKey(p);
          if (k !== null) allUsedKeys.add(k);
          usedRowUids.add(p.rowUid);
        };

        // 마스터에서 대체 후보 (적격 + 미선택)
        const masterCandidates = allParcels.filter(p => {
          if (!p.isEligible) return false;
          if (config.excludedRis.includes(p.ri)) return false;
          const area = getParcelArea(p);
          if (area !== null && area < MIN_AREA) return false;
          // 이 줄은 **최적화다** — 정렬 입력을 줄인다. 정합성은 아래 루프의 같은 판정이
          // 책임진다(여기를 지워도 결과는 같다, 실측 확인).
          return !isAlreadyUsed(p);
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

        // 대체 복사도 상한 안에서만 한다. 상한을 적격분에만 걸고 대체분을 부적격 수만큼
        // 그대로 더하면 대표가 상한을 넘는다(적격 900 + 부적격 100, 상한 260 → 360건).
        // 상한이 0(전부)이면 예전처럼 부적격 수만큼 채운다.
        const shortage = repCap > 0
          ? Math.max(0, Math.min(excludedRepReasons.length, repCap - repLimited.length))
          : excludedRepReasons.length;
        repShortage = shortage;
        if (shortage < excludedRepReasons.length) {
          console.info(
            `[추출] 부적격 대표필지 ${excludedRepReasons.length}건 중 상한(${repCap}) 안에서 ${shortage}건만 대체`
          );
        }
        for (const p of sorted) {
          if (repSupplements.length >= shortage) break;
          // 담은 것을 바로 반영한다. 마스터에는 같은 지번이 작물별로 여러 행 있어,
          // 루프 전에 만든 집합만 보면 그 쌍이 둘 다 담기고 뒤의 dedupe가 하나로 접는다
          // — 대체 복사 200건이 조용히 100건이 됐고 "대체 부족" 경고도 안 떴다.
          if (isAlreadyUsed(p)) continue;
          markUsed(p);
          // 대체 보충분은 마스터(공익직불제 모집단)에서 복사해 온 행이다.
          // 대표필지 자리를 메우는 동시에 공익직불제 대상이기도 하다.
          repSupplements.push({
            ...p,
            parcelCategory: representativeCategoryOf(p),
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
      // dedupe를 **먼저** 한다. 예전에는 초과분을 제거해 정확히 목표 행수를 만든 뒤
      // dedupe를 돌려서, 중복이 있으면 그만큼 목표에 미달했다(700 설정에 680건).
      // 마스터에는 같은 지번이 작물별로 여러 행 있을 수 있어 중복은 상시 생긴다.
      const merged = dedupeSelected([...taggedPublic, ...repDirect, ...repSupplements]);
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
          if (isRepresentative(merged[i])) continue;
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
        // 빈 풀을 실제로 걷어낸다. 예전에는 정렬 키가 `길이 − 목표`라 **목표가 작은
        // 빈 풀**이 목표가 큰 비어있지 않은 풀보다 앞설 수 있었고, 그때 `break`가
        // 걸려 아직 뺄 수 있는데도 멈췄다(리별 목표를 다르게 준 경우).
        let live = pools.filter(x => x.idxs.length > 0);
        while (dropIdx.size < overflow && live.length > 0) {
          // 목표 대비 초과가 큰 리부터 (동률이면 많이 가진 리부터)
          live.sort((a, b) =>
            (b.idxs.length - b.target) - (a.idxs.length - a.target) ||
            b.idxs.length - a.idxs.length
          );
          dropIdx.add(live[0].idxs.pop()!);
          if (live[0].idxs.length === 0) live = live.filter(x => x.idxs.length > 0);
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
      const repCount = finalParcels.filter(isRepresentative).length;
      console.info(
        `[추출] 최종 ${finalParcels.length}건 (고유 ${uniqueCount}건) — ` +
        `그중 대표필지 ${repCount}건, 신규 추출 ${finalParcels.length - repCount}건`
      );

      // ── 6. 최종 결과 기준으로 재검증 ──
      // extractParcels가 만든 validation은 공익직불제 필지만, 그것도
      // publicPaymentTarget으로 덮인 목표를 기준으로 계산한 것이다. 화면에는
      // 대표필지까지 병합한 결과가 뜨므로 그대로 두면 "목표 700인데 N개"
      // 경고가 실제 숫자와 어긋난다.
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
      const exemptKeys = keySetOf(repDirect, matchKey);

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
          representativeSummary: {
            uploaded: allRepParcels.length,
            eligible: enrichedEligibleRep.length,
            cap: repCap,
            limited: repLimited.length,
            supplemented: repSupplementCount,
            supplementShortfall: repShortage - repSupplementCount,
          },
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

  toggleParcelSelection: (target) =>
    set((state) => {
      if (!state.result) return state;
      const selected = state.result.selectedParcels;
      const matches = sameParcelPredicate(target);
      const exists = selected.some(matches);
      const newSelected = exists ? selected.filter((p) => !matches(p)) : selected;

      return {
        result: { ...state.result, selectedParcels: newSelected },
      };
    }),

  addParcel: (parcel) =>
    set((state) => {
      if (!state.result) return state;
      // 이미 들어 있으면 아무 것도 하지 않는다 — `removeParcel`과 대칭이다.
      //
      // 사본(`{...parcel, isSelected: true}`)을 저장해도 `rowUid`가 따라가므로
      // 식별 불가능한 필지에도 정확히 동작한다. 예전에는 참조로 판정해
      // 사본이 만들어지는 순간 검사가 무력해졌다.
      if (state.result.selectedParcels.some(sameParcelPredicate(parcel))) return state;
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

  removeParcel: (target) =>
    set((state) => {
      if (!state.result) return state;
      const matches = sameParcelPredicate(target);
      return {
        result: {
          ...state.result,
          selectedParcels: state.result.selectedParcels.filter((p) => !matches(p)),
        },
      };
    }),

  getValidation: () => get().result?.validation ?? null,

  reset: () => set({ config: { ...DEFAULT_CONFIG }, result: null, isRunning: false, error: null }),
}));
