import type { Parcel } from '../types';
import { useParcelStore } from './parcelStore';
import { applyGeocodedCoords } from '../lib/geocodeApply';
import { generatePnuForParcels } from '../lib/pnuGenerator';

/**
 * 필지 스토어에 **오래 걸리는 작업의 결과를 기입하는** 지점들.
 *
 * 화면(`AnalyzePage`·`ReviewPage`)에 흩어져 있던 것을 여기로 모았다. 옮긴 이유는
 * 재사용이 아니라 **불변식을 한 곳에서 지키기 위해서다.**
 *
 * ## 지켜야 하는 불변식
 *
 * > `await` 뒤의 쓰기는 **그 시점의 스토어**를 읽어서 만들어야 한다.
 *
 * `updateParcels`는 병합이 아니라 **전체 교체**다(`set({ allParcels })`). 그래서
 * `await` 앞에서 읽어 둔 배열로 교체하면, 기다리는 동안 다른 경로가 써 넣은 것이
 * **전부 사라진다.**
 *
 * 실제로 이렇게 유실됐다 (PROJ1-1-44).
 *
 * 1. 4만 필지 좌표 변환 시작 — 수 분 걸린다
 * 2. 진행 중에 PNU 생성을 누른다 (버튼이 잠기지 않았다)
 * 3. PNU가 스토어에 채워진다
 * 4. 좌표 변환이 끝나 **PNU 생성 이전 스냅샷**을 통째로 써 넣는다
 * 5. 생성한 PNU가 전부 사라진다
 *
 * 화면 쪽 원인은 `const parcelStore = useParcelStore()` — 셀렉터 없이 스토어를
 * 통째로 받은 것이다. zustand는 `set`마다 그 객체를 갈아치우므로 그것은
 * **렌더 시점 스냅샷**이고, `await` 뒤의 `parcelStore.allParcels`는 새 값이 아니다.
 *
 * `useCallback` 의존성에 `allParcels`를 넣어도 이 경합은 막지 못한다. 의존성은
 * **다음 호출**이 받을 클로저를 새로 만들 뿐, 이미 `await`에 들어가 있는 호출이
 * 붙잡은 배열은 바꾸지 않는다. `ReviewPage.runGeocodingInReview`가 그 형태였고,
 * 겉보기와 달리 `AnalyzePage`와 정확히 같은 창이 열려 있었다. 그래서 두 화면을
 * 같은 규칙으로 맞춘다.
 *
 * 버튼 잠금(실행 중 PNU 생성 비활성화)은 이 창을 **좁히지만 닫지는 못한다** —
 * 잠금은 화면 하나의 UI 상태일 뿐이고, 스토어를 쓰는 경로가 늘어나면 다시 새는다.
 * 그래서 잠금은 보조 수단이고, 근본은 여기의 "사용 시점에 읽는다"이다.
 */

/**
 * 지오코딩을 실행하고 결과 좌표를 스토어에 기입한다.
 *
 * @param start 실제 지오코딩 실행기. `useGeocoding().startGeocoding`을 감싸 넘긴다
 *              (`force` 인자는 호출자가 클로저에 담는다).
 * @returns 좌표가 반영된 `allParcels`. 대상이 없으면 `null`.
 */
export async function runGeocodingAndCommit(
  start: (parcels: Parcel[]) => Promise<Parcel[]>,
): Promise<Parcel[] | null> {
  const before = useParcelStore.getState();

  // 대상 선정은 시작 시점의 스토어로 하는 것이 맞다 — 보내는 목록이다.
  const targets = [
    ...before.allParcels.filter((p) => p.isEligible),
    ...before.representativeParcels,
  ];
  if (targets.length === 0) return null;

  const geocoded = await start(targets);

  // ⚠️ 여기부터는 await 뒤다. `before`를 쓰면 안 된다 — 기다리는 동안 들어온
  // 쓰기가 전부 사라진다. 반드시 **지금의** 스토어를 다시 읽는다.
  const now = useParcelStore.getState();

  const updatedAll = applyGeocodedCoords(now.allParcels, geocoded);
  now.updateParcels(updatedAll);

  if (now.representativeParcels.length > 0) {
    now.setRepresentativeParcels(
      applyGeocodedCoords(now.representativeParcels, geocoded),
    );
  }

  return updatedAll;
}

/** 화면이 표시하는 PNU 생성 요약. */
export interface PnuCommitSummary {
  generated: number;
  skipped: number;
  errors: string[];
}

/**
 * PNU를 생성해 스토어에 기입한다.
 *
 * 동기 함수지만 여기도 `getState()`로 읽는다. 화면이 붙잡고 있는 스냅샷은
 * 지오코딩이 스토어를 갱신한 뒤 리렌더가 오기 전까지 낡아 있고, 그 창에서
 * 이 함수가 실행되면 이번에는 **좌표가** 사라진다(방향만 반대인 같은 사고).
 */
export function generatePnuAndCommit(overwrite: boolean): PnuCommitSummary {
  const st = useParcelStore.getState();

  const { updated: updatedAll, result: resultAll } = generatePnuForParcels(
    st.allParcels,
    overwrite,
  );
  st.updateParcels(updatedAll);

  // 세 값을 **전부** 합친다. 예전에는 `generated`만 합치고 `skipped`·`errors`는
  // 공익 쪽에서만 가져와, 대표필지가 매핑조차 안 돼도 화면에 "생성 n건, 오류 없음"이
  // 떴다. 화면은 이 요약을 그대로 찍으므로(생성/기존 유지/매핑 실패) 담당자는
  // PNU가 다 채워진 줄 알고 다음 단계로 넘어간다.
  let repGenerated = 0;
  let repSkipped = 0;
  let repErrors: string[] = [];
  if (st.representativeParcels.length > 0) {
    const { updated: updatedRep, result: resultRep } = generatePnuForParcels(
      st.representativeParcels,
      overwrite,
    );
    st.setRepresentativeParcels(updatedRep);
    repGenerated = resultRep.generated;
    repSkipped = resultRep.skipped;
    repErrors = resultRep.errors;
  }

  return {
    generated: resultAll.generated + repGenerated,
    skipped: resultAll.skipped + repSkipped,
    // 양쪽을 합친 뒤 같은 리를 한 줄로 접는다(같은 리가 양쪽에 있는 것이 흔하다).
    // `slice(10)`은 화면 표시용 상한일 뿐이다 — 오류 유무는 `errors.length > 0`으로
    // 판단하므로, 잘려도 "오류 없음"으로 보이지는 않는다.
    errors: [...new Set([...resultAll.errors, ...repErrors])].slice(0, 10),
  };
}
