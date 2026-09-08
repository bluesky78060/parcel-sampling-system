import { describe, expect, it } from 'vitest';
import { applyGeocodedCoords } from '../geocodeApply';
import { makeParcel } from './factories';

/**
 * PROJ1-1-42. 예전에는 이 매핑이 세 벌 복제돼 있었고 손으로 만든 키를 썼다.
 *
 * ```ts
 * const key = `${gp.farmerId}_${gp.parcelId}_${gp.address}`;
 * ```
 *
 * `ri`가 없어 리를 넘어 충돌하고, 빈 값 가드가 없어 `F001__`로 뭉쳤다.
 * `Map`은 마지막 것이 이기므로 **한 필지의 좌표가 나머지 전부에 기입됐다** —
 * 지도 마커가 엉뚱한 곳에 찍히고 엑셀의 위도·경도가 틀린다.
 *
 * PROJ1-1-38에서 이 키를 "값 동일성 키라 필지 정체성이 아니다"라고 판단해
 * 린트 규칙 범위에서 뺐는데, **오판이었다.** 코드를 읽고 분류했을 뿐
 * 실행해 보지 않은 것이 원인이다.
 */

const AT = (lat: number) => ({ lat, lng: 128.9 });

describe('applyGeocodedCoords', () => {
  it('좌표를 원본 필지에 반영한다', () => {
    const p = makeParcel({ pnu: 'A', coords: null });
    const out = applyGeocodedCoords([p], [{ ...p, coords: AT(36.1) }]);
    expect(out[0].coords).toEqual(AT(36.1));
  });

  it('지오코딩에 없던 필지는 그대로 둔다', () => {
    const a = makeParcel({ pnu: 'A', coords: AT(36.1) });
    const b = makeParcel({ pnu: 'B', coords: null });
    const out = applyGeocodedCoords([a, b], [{ ...a, coords: AT(37.0) }]);
    expect(out[0].coords).toEqual(AT(37.0));
    expect(out[1]).toBe(b); // 새 객체를 만들지도 않는다
  });

  /**
   * **재현 A.** 경영체번호만 있고 지번·주소가 빈 두 필지. 파싱 필터
   * (`farmerId || parcelId || address`)를 `farmerId` 하나로 통과하므로 실재하는
   * population이다. 예전 키로는 둘 다 `F001__`이었다.
   */
  it('지번도 주소도 빈 같은 농가의 두 필지가 좌표를 섞지 않는다', () => {
    const a = makeParcel({ farmerId: 'F001', ri: '내성리', parcelId: '', address: '', pnu: 'PNU_A' });
    const b = makeParcel({ farmerId: 'F001', ri: '문단리', parcelId: '', address: '', pnu: 'PNU_B' });
    const out = applyGeocodedCoords(
      [a, b],
      [{ ...a, coords: AT(36.1) }, { ...b, coords: AT(37.9) }],
    );
    expect(out.find((p) => p.pnu === 'PNU_A')!.coords).toEqual(AT(36.1));
    expect(out.find((p) => p.pnu === 'PNU_B')!.coords).toEqual(AT(37.9));
  });

  /**
   * **재현 B.** 지번이 **있어도** 충돌한다. 키에 `ri`가 없기 때문이다 —
   * `parcelKey.ts`가 "지번은 리를 넘어 고유하지 않다"고 길게 경고하는 그 보호가
   * 이 키에는 없었다.
   */
  it('리가 다른 같은 지번의 두 필지가 좌표를 섞지 않는다', () => {
    const mun = makeParcel({ farmerId: 'F001', ri: '문단리', parcelId: '100', address: '', pnu: 'PNU_MUN' });
    const beop = makeParcel({ farmerId: 'F001', ri: '법전리', parcelId: '100', address: '', pnu: 'PNU_BEOP' });
    const out = applyGeocodedCoords(
      [mun, beop],
      [{ ...mun, coords: AT(36.5) }, { ...beop, coords: AT(37.2) }],
    );
    expect(out.find((p) => p.pnu === 'PNU_MUN')!.coords).toEqual(AT(36.5));
    expect(out.find((p) => p.pnu === 'PNU_BEOP')!.coords).toEqual(AT(37.2));
  });

  /**
   * **역방향.** 이긴 항목의 좌표가 `null`이면 멀쩡한 좌표가 지워졌다.
   * 삼항이 좌표가 아니라 **항목 존재 여부**로 분기하기 때문이다.
   * 충돌이 없으면 이 경로 자체가 생기지 않는다.
   */
  it('좌표가 있는 필지가 같은 농가의 실패분 때문에 좌표를 잃지 않는다', () => {
    const ok = makeParcel({ farmerId: 'F001', ri: '내성리', parcelId: '', address: '', pnu: 'PNU_OK', coords: AT(36.1) });
    const failed = makeParcel({ farmerId: 'F001', ri: '문단리', parcelId: '', address: '', pnu: 'PNU_FAIL', coords: null });
    const out = applyGeocodedCoords(
      [ok, failed],
      // 지오코더는 실패분도 돌려주고, 그 coords는 원래 값 그대로다
      [{ ...ok }, { ...failed }],
    );
    expect(out.find((p) => p.pnu === 'PNU_OK')!.coords).toEqual(AT(36.1));
    expect(out.find((p) => p.pnu === 'PNU_FAIL')!.coords).toBeNull();
  });

  it('같은 행을 두 번 넣어도 그 행의 좌표만 쓴다', () => {
    const p = makeParcel({ pnu: 'A', coords: null });
    const other = makeParcel({ pnu: 'B', coords: AT(99) });
    const out = applyGeocodedCoords([p], [{ ...other }, { ...p, coords: AT(36.1) }]);
    expect(out[0].coords).toEqual(AT(36.1));
  });

  it('빈 배열을 넣어도 터지지 않는다', () => {
    expect(applyGeocodedCoords([], [])).toEqual([]);
    const p = makeParcel({ pnu: 'A', coords: AT(36.1) });
    expect(applyGeocodedCoords([p], [])[0]).toBe(p);
  });
});
