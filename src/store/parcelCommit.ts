import type { Parcel } from '../types';
import { useParcelStore } from './parcelStore';
import { applyGeocodedCoords } from '../lib/geocodeApply';
import { generatePnuForParcels } from '../lib/pnuGenerator';
import type { PnuGenerationResult } from '../lib/pnuGenerator';

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
 * `updateParcels`는 병합이 아니라 **전체 교체**다. 그래서 `await` 앞에서 읽어 둔
 * 배열로 교체하면, 기다리는 동안 다른 경로가 써 넣은 것이 **전부 사라진다.**
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
 *
 * ## 관례에서 구조로 (PROJ1-1-49)
 *
 * 위 규칙은 오래 **관례**였다 — 이 파일의 두 함수가 지키기로 한 약속일 뿐,
 * 다음에 추가될 async 핸들러가 낡은 배열을 넘기는 것을 막는 장치가 없었다.
 *
 * 그래서 `updateParcels`·`updateRepresentativeParcels`의 시그니처를
 * **함수형만 받도록** 좁혔다. 이전 배열은 zustand의 `set` 안에서 읽히므로
 * 낡은 배열을 넘긴다는 것 자체가 타입 수준에서 표현 불가능하다. 규칙이
 * 문서에서 시그니처로 옮겨 갔고, 이 파일이 그 규칙의 **유일한 수호자**이기를
 * 그만두었다.
 *
 * 부수 효과로 "`getState()`를 한 번 잡아 두고 쓰기 **이후에** 그 스냅샷에서
 * 다시 읽는" 모양 두 곳이 사라졌다. 오늘은 등가였지만 이 파일이 존재하는
 * 이유인 규칙을 그대로 위반하는 형태였다.
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
  // 쓰기가 전부 사라진다. 함수형 갱신이므로 이전 배열은 zustand의 `set`
  // 안에서 읽힌다 — 여기서 미리 읽어 둔 것을 넘길 수단 자체가 없다.
  useParcelStore.getState().updateParcels((prev) =>
    applyGeocodedCoords(prev, geocoded),
  );

  // 빈 대표필지에 새 배열을 쓰면 참조만 바뀌어 불필요한 리렌더를 부른다.
  // 판정도 `set` 안에서 한다 — 밖에서 하면 쓰기 전에 읽은 값으로 판단하는 것이라
  // 이 파일이 금지하는 바로 그 모양이 된다.
  useParcelStore.getState().updateRepresentativeParcels((prev) =>
    prev.length > 0 ? applyGeocodedCoords(prev, geocoded) : prev,
  );

  return useParcelStore.getState().allParcels;
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
  // 요약은 갱신 함수 밖으로 꺼낸다. zustand의 `set(fn)`은 `fn`을 **동기적으로
  // 정확히 한 번** 부르므로, 여기서 받는 값은 실제로 쓰인 것의 요약이다.
  let resultAll!: PnuGenerationResult;
  useParcelStore.getState().updateParcels((prev) => {
    const { updated, result } = generatePnuForParcels(prev, overwrite);
    resultAll = result;
    return updated;
  });

  // 세 값을 **전부** 합친다. 예전에는 `generated`만 합치고 `skipped`·`errors`는
  // 공익 쪽에서만 가져와, 대표필지가 매핑조차 안 돼도 화면에 "생성 n건, 오류 없음"이
  // 떴다. 화면은 이 요약을 그대로 찍으므로(생성/기존 유지/매핑 실패) 담당자는
  // PNU가 다 채워진 줄 알고 다음 단계로 넘어간다.
  let repGenerated = 0;
  let repSkipped = 0;
  let repErrors: string[] = [];
  useParcelStore.getState().updateRepresentativeParcels((prev) => {
    if (prev.length === 0) return prev;
    const { updated, result } = generatePnuForParcels(prev, overwrite);
    repGenerated = result.generated;
    repSkipped = result.skipped;
    repErrors = result.errors;
    return updated;
  });

  return {
    generated: resultAll.generated + repGenerated,
    skipped: resultAll.skipped + repSkipped,
    // 양쪽을 합친 뒤 같은 리를 한 줄로 접는다(같은 리가 양쪽에 있는 것이 흔하다).
    // `slice(10)`은 화면 표시용 상한일 뿐이다 — 오류 유무는 `errors.length > 0`으로
    // 판단하므로, 잘려도 "오류 없음"으로 보이지는 않는다.
    errors: [...new Set([...resultAll.errors, ...repErrors])].slice(0, 10),
  };
}
