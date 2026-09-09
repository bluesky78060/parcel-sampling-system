import { describe, expect, it } from 'vitest';
import type { Parcel } from '../../types';
import {
  buildMapSelectedParcels,
  buildTableParcels,
  countMapLegend,
  isParcelSelected,
  mergeWithRepresentatives,
} from '../reviewSelectors';
import { isRepresentative } from '../parcelCategory';
import { makeParcel } from './factories';

/**
 * 이 계산들은 `ReviewPage`의 `useMemo` 안에 있어 DOM 없이는 테스트할 수 없었다.
 * PROJ1-1-37에서 리뷰가 실측한 결과, 키 처리를 되돌려도 테스트가 전부 통과했다 —
 * 검토 표에서 필지가 증발하고 지도가 안 뽑힌 것을 뽑힌 것으로 그리던 결함들이
 * 무보호였다.
 */

/** 경영체번호가 비고 지번이 같은 두 필지. 리가 달라 실제로는 서로 다른 필지다. */
const munDan = (over = {}) =>
  makeParcel({
    farmerId: '',
    ri: '문단리',
    parcelId: '100',
    address: '경상북도 봉화군 봉화읍 문단리 100',
    pnu: '',
    ...over,
  });

const beopJeon = (over = {}) =>
  makeParcel({
    farmerId: '',
    ri: '법전리',
    parcelId: '100',
    address: '경상북도 봉화군 법전면 법전리 100',
    pnu: '',
    ...over,
  });

/**
 * `useMarkerLayer`가 대표필지를 세는 술어를 그대로 복제한다(필터·경계 게이트 제외).
 * 훅은 DOM을 요구해 node에서 렌더할 수 없으므로, 계수 조건만 떼어 범례와 대조한다.
 */
const badgeRepresentativeCount = (mapParcels: Parcel[]) =>
  mapParcels.filter((p) => p.coords && isRepresentative(p)).length;

/** 기채취 연도 두 개(최근순). 아래 여러 describe가 공유한다 */
const SAMPLED_YEARS: readonly [number, number] = [2025, 2024];

describe('mergeWithRepresentatives', () => {
  it('대표필지가 없으면 마스터를 그대로 돌려준다', () => {
    const all = [makeParcel({ pnu: 'PNU_A' })];
    expect(mergeWithRepresentatives(all, [])).toBe(all);
  });

  it('마스터에 없는 대표필지만 더한다', () => {
    const all = [makeParcel({ pnu: 'PNU_A' })];
    const reps = [makeParcel({ pnu: 'PNU_A' }), makeParcel({ pnu: 'PNU_B' })];
    const merged = mergeWithRepresentatives(all, reps);
    expect(merged).toHaveLength(2);
    expect(merged.map((p) => p.pnu)).toEqual(['PNU_A', 'PNU_B']);
  });

  it('같은 필지면 마스터 쪽을 남긴다 (좌표를 갖고 있다)', () => {
    const master = makeParcel({ pnu: 'PNU_A', coords: { lat: 36.9, lng: 128.9 } });
    const rep = makeParcel({ pnu: 'PNU_A', coords: null });
    expect(mergeWithRepresentatives([master], [rep])[0].coords).not.toBeNull();
  });

  /**
   * **재리뷰 3라운드에서 드러난 선재 결함.** 마스터 행을 남기면 그 행의
   * `parcelCategory`는 파싱 기본값 `'public-payment'`라, 겹치는 대표필지가
   * `isRepresentative`에서 거짓이 되어 지도에 파란 원으로 찍혔다.
   *
   * 선정 결과 경로는 `buildMapSelectedParcels`가 카테고리를 다시 써 줘 이 구멍이
   * 없었다. "추출 선택만"을 끈 모드만 재기입이 없어 갈라져 있었다.
   */
  it('겹치는 마스터 행에 대표필지 성격을 실어 준다', () => {
    const master = [makeParcel({ pnu: 'A', coords: { lat: 36.9, lng: 128.9 } })];
    const reps = [makeParcel({ pnu: 'A', parcelCategory: 'representative' })];
    const merged = mergeWithRepresentatives(master, reps);
    expect(merged).toHaveLength(1);
    // 좌표는 마스터 쪽을 남긴다 — 대표 업로드에는 없다
    expect(merged[0].coords).not.toBeNull();
    // 공익 추출 대상이기도 하므로 'both'다. 'representative'로 덮어쓰면 공익직불제
    // 시트에서 사라져 제출 파일의 행 수가 줄어든다.
    expect(merged[0].parcelCategory).toBe('both');
    expect(isRepresentative(merged[0])).toBe(true);
  });

  /**
   * 이 티켓(PROJ1-1-35 B)의 목적은 "나란히 놓인 두 숫자가 조용히 어긋나지 않는 것"이다.
   * 겹침이 있어도 범례와 배지가 같은 수를 말해야 한다.
   */
  it('겹침이 있어도 범례 대표 수와 지도 배지 대표 수가 같다 ("추출 선택만" 꺼짐)', () => {
    const IN = { lat: 36.9, lng: 128.9 };
    const master = [
      makeParcel({ pnu: 'R1', coords: IN }),   // 대표필지와 겹친다
      makeParcel({ pnu: 'X1', coords: IN }),
    ];
    const reps = [
      makeParcel({ pnu: 'R1', coords: IN, parcelCategory: 'representative' }),
      makeParcel({ pnu: 'R2', coords: IN, parcelCategory: 'representative' }),
      makeParcel({ pnu: 'R3', coords: IN, parcelCategory: 'representative' }), // 상한 초과
    ];
    const selected = [reps[0], reps[1]];

    const mapParcels = mergeWithRepresentatives(master, reps);
    const counts = countMapLegend(master, reps, selected, SAMPLED_YEARS, true);

    expect(badgeRepresentativeCount(mapParcels)).toBe(3);
    expect(counts.representative).toBe(3);
    // 꺼진 모드에서는 초과분도 지도에 있으므로 "결과 제외" 줄이 나오지 않는다
    expect(counts.representativeExcluded).toBe(0);
  });

  it('겹침이 없을 때도 두 수가 같다', () => {
    const IN = { lat: 36.9, lng: 128.9 };
    const master = [makeParcel({ pnu: 'X1', coords: IN })];
    const reps = [
      makeParcel({ pnu: 'R2', coords: IN, parcelCategory: 'representative' }),
      makeParcel({ pnu: 'R3', coords: IN, parcelCategory: 'representative' }),
    ];
    const mapParcels = mergeWithRepresentatives(master, reps);
    const counts = countMapLegend(master, reps, [reps[0]], SAMPLED_YEARS, true);
    expect(badgeRepresentativeCount(mapParcels)).toBe(2);
    expect(counts.representative).toBe(2);
  });

  /**
   * 키가 없으면 마스터와 같은 필지인지 판정할 수 없다. 접으면 조용히 사라지는데,
   * 대표필지는 반드시 조사해야 하는 고정 관측점이다.
   */
  it('키가 없는 대표필지는 새 것으로 본다', () => {
    const all = [makeParcel({ pnu: 'PNU_A' })];
    const rep = makeParcel({ pnu: '', address: '', parcelId: '' });
    expect(mergeWithRepresentatives(all, [rep])).toHaveLength(2);
  });
});

describe('buildTableParcels', () => {
  it('마스터가 비면 선정분만 돌려준다', () => {
    const selected = [makeParcel({ pnu: 'PNU_A' })];
    expect(buildTableParcels([], selected)).toBe(selected);
  });

  it('선정분을 앞에, 미선정 적격분을 뒤에 둔다', () => {
    const a = makeParcel({ pnu: 'PNU_A' });
    const b = makeParcel({ pnu: 'PNU_B' });
    const table = buildTableParcels([a, b], [a]);
    expect(table).toHaveLength(2);
    expect(table[0].pnu).toBe('PNU_A');
  });

  it('부적격 필지는 목록에 없다', () => {
    const a = makeParcel({ pnu: 'PNU_A', isEligible: false });
    expect(buildTableParcels([a], [])).toHaveLength(0);
  });

  it('선정된 필지가 미선정 목록에 다시 나오지 않는다', () => {
    const a = makeParcel({ pnu: 'PNU_A' });
    expect(buildTableParcels([a], [a])).toHaveLength(1);
  });

  /**
   * **이 결함이 이 파일이 존재하는 이유다.**
   *
   * 예전 키(`farmerId__parcelId`)는 경영체번호가 비면 `__100`이 되어 리를 넘어
   * 충돌했다. 선정된 문단리 필지 때문에 미선정 법전리 필지가 "이미 선택됨"으로
   * 판정되어 **대기 목록에서 빠졌다** — 대체 필지를 고르려 해도 목록에 없었다.
   */
  it('농가 미상 + 같은 지번이어도 리가 다르면 미선정분이 남는다', () => {
    const mun = munDan();
    const beop = beopJeon();
    const table = buildTableParcels([mun, beop], [mun]);
    expect(table).toHaveLength(2);
    expect(table.some((p) => p.ri === '법전리')).toBe(true);
  });

  it('키가 없는 필지는 목록에서 빼지 않는다', () => {
    const unidentified = makeParcel({ pnu: '', address: '', parcelId: '' });
    expect(buildTableParcels([unidentified], [])).toHaveLength(1);
  });

  /**
   * 예전에는 키가 없으면 "알 수 없으니 빼지 않는다"였다. 그래서 키 없는 필지를
   * 추가하는 순간 **같은 행이 표에 두 번 나오고 둘 다 체크된 채로 보였다.**
   * `rowUid`가 생긴 지금은 같은 행인지 알 수 있다.
   */
  it('키가 없어도 이미 선정된 그 행은 미선정 목록에 다시 나오지 않는다', () => {
    const p = makeParcel({ pnu: '', address: '', parcelId: '' });
    const stored = { ...p, isSelected: true }; // 스토어는 사본을 담는다
    expect(buildTableParcels([p], [stored])).toHaveLength(1);
  });

  it('키가 없는 다른 행은 그대로 남는다', () => {
    const a = makeParcel({ pnu: '', address: '', parcelId: '' });
    const b = makeParcel({ pnu: '', address: '', parcelId: '' });
    const table = buildTableParcels([a, b], [{ ...a, isSelected: true }]);
    expect(table).toHaveLength(2);
    expect(table.some((x) => x.rowUid === b.rowUid)).toBe(true);
  });
});

describe('buildMapSelectedParcels', () => {
  it('선정된 필지만 남긴다', () => {
    const a = makeParcel({ pnu: 'PNU_A' });
    const b = makeParcel({ pnu: 'PNU_B' });
    expect(buildMapSelectedParcels([a, b], [a])).toHaveLength(1);
  });

  /**
   * 좌표는 마스터 쪽에서, 분류는 결과 쪽에서 온다. 합치지 않으면 대표필지가
   * 지도에서 초록 별이 아니라 파란 원으로 찍히고 팝업도 "공익직불제"로 나온다.
   */
  it('결과 쪽 분류를 마스터 객체에 씌운다', () => {
    const master = makeParcel({ pnu: 'PNU_A', parcelCategory: 'public-payment' });
    const inResult = makeParcel({ pnu: 'PNU_A', parcelCategory: 'both' });
    const out = buildMapSelectedParcels([master], [inResult]);
    expect(out[0].parcelCategory).toBe('both');
  });

  it('분류가 같으면 새 객체를 만들지 않는다', () => {
    const master = makeParcel({ pnu: 'PNU_A', parcelCategory: 'both' });
    const inResult = makeParcel({ pnu: 'PNU_A', parcelCategory: 'both' });
    expect(buildMapSelectedParcels([master], [inResult])[0]).toBe(master);
  });

  /**
   * 같은 키를 가진 결과 행의 분류가 엇갈리면 어느 쪽도 믿을 수 없다.
   * 나중 항목으로 덮어쓰면 공익직불제 필지가 대표필지 별로 찍히는데,
   * 대표필지는 반드시 조사해야 하는 고정 관측점이라 그쪽이 더 나쁜 신호다.
   */
  it('분류가 엇갈리면 보정을 포기하고 원본을 둔다', () => {
    const master = makeParcel({ pnu: 'PNU_A', parcelCategory: 'public-payment' });
    const r1 = makeParcel({ pnu: 'PNU_A', parcelCategory: 'public-payment' });
    const r2 = makeParcel({ pnu: 'PNU_A', parcelCategory: 'representative' });
    expect(buildMapSelectedParcels([master], [r1, r2])[0].parcelCategory).toBe('public-payment');
  });

  it('키가 없는 필지는 지도에 올리지 않는다', () => {
    const unidentified = makeParcel({ pnu: '', address: '', parcelId: '' });
    expect(buildMapSelectedParcels([unidentified], [unidentified])).toHaveLength(0);
  });
});

describe('isParcelSelected', () => {
  it('같은 필지면 true다', () => {
    const a = makeParcel({ pnu: 'PNU_A' });
    expect(isParcelSelected(a, [makeParcel({ pnu: 'PNU_A' })])).toBe(true);
  });

  it('다른 필지면 false다', () => {
    expect(isParcelSelected(makeParcel({ pnu: 'PNU_A' }), [makeParcel({ pnu: 'PNU_B' })])).toBe(
      false,
    );
  });

  /**
   * 예전에는 `farmerId`·`parcelId` 비교라 이 둘이 같은 필지로 판정됐다 —
   * **마커 색은 회색인데 상세 패널만 "추출 선택"이라고 말했다.**
   */
  it('농가 미상 + 같은 지번이어도 리가 다르면 false다', () => {
    expect(isParcelSelected(beopJeon(), [munDan()])).toBe(false);
  });

  /**
   * 키가 없으면 행 식별자로 본다. 결과 배열에는 사본이 담기므로 참조로는 안 된다.
   */
  it('키가 없으면 행 식별자로 판정한다', () => {
    const p = makeParcel({ pnu: '', address: '', parcelId: '' });
    const copy = { ...p, isSelected: true };
    expect(isParcelSelected(p, [copy])).toBe(true);
  });

  it('키가 없고 행도 다르면 false다', () => {
    const a = makeParcel({ pnu: '', address: '', parcelId: '' });
    const b = makeParcel({ pnu: '', address: '', parcelId: '' });
    expect(isParcelSelected(a, [b])).toBe(false);
  });
});

describe('countMapLegend', () => {
  const years: readonly [number, number] = [2025, 2024];

  it('선정·미선정·기채취를 분류한다', () => {
    const all = [
      makeParcel({ pnu: 'A', coords: { lat: 36.9, lng: 128.9 } }),
      makeParcel({ pnu: 'B', coords: { lat: 36.9, lng: 128.9 } }),
      makeParcel({ pnu: 'C', coords: { lat: 36.9, lng: 128.9 }, sampledYears: [2025] }),
      makeParcel({ pnu: 'D', coords: { lat: 36.9, lng: 128.9 }, sampledYears: [2024] }),
    ];
    const counts = countMapLegend(all, [], [all[0]], years, false);
    expect(counts.selected).toBe(1);
    expect(counts.unselected).toBe(1);
    expect(counts.sampledByYear[2025]).toBe(1);
    expect(counts.sampledByYear[2024]).toBe(1);
  });

  it('좌표가 없으면 따로 센다', () => {
    const all = [makeParcel({ pnu: 'A', coords: null })];
    expect(countMapLegend(all, [], [], years, false).noCoords).toBe(1);
  });

  /**
   * 대표필지는 대표필지 배열에서 세고, 마스터 순회에서는 건너뛴다.
   * 건너뛰지 않으면 마스터에도 있는 대표필지가 두 번 세어진다.
   *
   * 예전에는 `selectedParcels`를 비워 두고 이 성질을 봤다. 그런데 결과에 든
   * 대표필지는 실제로는 **언제나** 그 배열에 있으므로(`repLimited`가 들어간다),
   * 빈 배열은 현실에 없는 상태였다. 아래 '결과 제외' 계약이 생기면서 그 픽스처가
   * "상한에 걸려 빠진 대표필지"를 뜻하게 됐다 — 픽스처를 현실에 맞춘다.
   * 단언 자체(두 번 세지 않는다)는 그대로다.
   */
  it('마스터에도 있는 대표필지를 두 번 세지 않는다', () => {
    const rep = makeParcel({ pnu: 'A', coords: { lat: 36.9, lng: 128.9 } });
    const master = makeParcel({ pnu: 'A', coords: { lat: 36.9, lng: 128.9 } });
    const counts = countMapLegend([master], [rep], [rep], years, false);
    expect(counts.representative).toBe(1);
    expect(counts.unselected).toBe(0);
    expect(counts.selected).toBe(0);
  });

  /**
   * **PROJ1-1-35 B.** `repCap`(리별 상한)을 넘은 대표필지는
   * `result.selectedParcels`에 들어가지 않아 지도에도 마커가 없다. 그런데 범례는
   * 업로드 **전량**을 세고 지도 배지는 실제 마커를 세어, 나란히 놓인 두 숫자가
   * 조용히 어긋났다(범례 "대표 260" / 배지 "대표 200").
   *
   * 범례가 배지와 같은 기준으로 세고, 차이 나는 건수를 따로 밝힌다.
   */
  it('상한에 걸려 결과에서 빠진 대표필지는 지도 기준에서 빼고 따로 센다', () => {
    const kept = makeParcel({ pnu: 'REP_KEPT', coords: { lat: 36.9, lng: 128.9 } });
    const dropped = makeParcel({ pnu: 'REP_OVER', coords: { lat: 36.9, lng: 128.9 } });
    const counts = countMapLegend([], [kept, dropped], [kept], years, false);
    expect(counts.representative).toBe(1);
    expect(counts.representativeExcluded).toBe(1);
    // 제외분을 좌표 미변환으로 흘려보내면 "좌표 변환을 다시 하라"는 엉뚱한 안내가 된다
    expect(counts.noCoords).toBe(0);
  });

  it('결과에 든 대표필지가 좌표를 못 얻었으면 제외가 아니라 좌표 미변환이다', () => {
    const rep = makeParcel({ pnu: 'REP_A', coords: null });
    const counts = countMapLegend([], [rep], [rep], years, false);
    expect(counts.noCoords).toBe(1);
    expect(counts.representative).toBe(0);
    expect(counts.representativeExcluded).toBe(0);
  });

  /**
   * 키를 만들 수 없는 대표필지는 `buildMapSelectedParcels`가 `key !== null`로 걸러
   * 지도에 그리지 않는다. 범례도 같은 판정을 해야 배지와 맞는다.
   */
  it('키가 없어 지도에 못 그리는 대표필지도 제외로 센다', () => {
    const keyless = makeParcel({ pnu: '', address: '', parcelId: '', coords: { lat: 36.9, lng: 128.9 } });
    const counts = countMapLegend([], [keyless], [keyless], years, false);
    expect(counts.representative).toBe(0);
    expect(counts.representativeExcluded).toBe(1);
  });

  /**
   * **재리뷰 지적 (PROJ1-1-35 B 후속).** "추출 선택만"을 끄면 지도가
   * `allParcelsWithRep`을 받고, `useMarkerLayer`는 `isRepresentative(p)`면 무조건
   * 대표로 센다 — 상한 초과분도 키 없는 것도 전부 마커가 된다.
   *
   * 처음 고칠 때 이 모드를 보지 않아, 기본 화면을 맞추면서 이쪽을 어긋나게 했다
   * (범례 200 / 배지 260). 범례 툴팁의 "지도에 없는 건수"도 그 모드에서 거짓이 됐다.
   */
  describe('지도가 결과 밖 필지까지 받는 모드 ("추출 선택만" 꺼짐)', () => {
    it('상한 초과분도 지도에 있으므로 대표로 세고 제외는 0이다', () => {
      const kept = makeParcel({ pnu: 'REP_KEPT', coords: { lat: 36.9, lng: 128.9 } });
      const dropped = makeParcel({ pnu: 'REP_OVER', coords: { lat: 36.9, lng: 128.9 } });
      const counts = countMapLegend([], [kept, dropped], [kept], years, true);
      expect(counts.representative).toBe(2);
      expect(counts.representativeExcluded).toBe(0);
    });

    it('키가 없는 대표필지도 이 모드에서는 지도에 그려지므로 대표로 센다', () => {
      const keyless = makeParcel({ pnu: '', address: '', parcelId: '', coords: { lat: 36.9, lng: 128.9 } });
      const counts = countMapLegend([], [keyless], [], years, true);
      expect(counts.representative).toBe(1);
      expect(counts.representativeExcluded).toBe(0);
    });

    it('초과분에 좌표가 없으면 제외가 아니라 좌표 미변환이다', () => {
      const dropped = makeParcel({ pnu: 'REP_OVER', coords: null });
      const counts = countMapLegend([], [dropped], [], years, true);
      expect(counts.noCoords).toBe(1);
      expect(counts.representativeExcluded).toBe(0);
    });

    /** 같은 입력이 모드에 따라 갈린다는 것 자체를 못박는다 */
    it('같은 입력이라도 기본 모드에서는 제외로 센다', () => {
      const dropped = makeParcel({ pnu: 'REP_OVER', coords: { lat: 36.9, lng: 128.9 } });
      expect(countMapLegend([], [dropped], [], years, false).representativeExcluded).toBe(1);
      expect(countMapLegend([], [dropped], [], years, true).representativeExcluded).toBe(0);
    });
  });

  it('전량이 결과에 들어가면 제외는 0이다', () => {
    const reps = [
      makeParcel({ pnu: 'R1', coords: { lat: 36.9, lng: 128.9 } }),
      makeParcel({ pnu: 'R2', coords: { lat: 36.9, lng: 128.9 } }),
    ];
    const counts = countMapLegend([], reps, reps, years, false);
    expect(counts.representative).toBe(2);
    expect(counts.representativeExcluded).toBe(0);
  });

  it('부적격이고 기채취도 아니면 어디에도 안 센다', () => {
    const all = [makeParcel({ pnu: 'A', coords: { lat: 36.9, lng: 128.9 }, isEligible: false })];
    const counts = countMapLegend(all, [], [], years, false);
    expect(counts.selected + counts.unselected).toBe(0);
  });

  it('기채취 연도가 바뀌어도 그 연도로 집계한다', () => {
    const all = [makeParcel({ pnu: 'A', coords: { lat: 36.9, lng: 128.9 }, sampledYears: [2030] })];
    const counts = countMapLegend(all, [], [], [2030, 2029], false);
    expect(counts.sampledByYear[2030]).toBe(1);
  });
});
