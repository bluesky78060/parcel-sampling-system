import { describe, expect, it } from 'vitest';
import { applyColumnMapping } from '../excelParser';
import type { ColumnMapping } from '../../types';

/**
 * `applyColumnMapping`은 **프로덕션에서 `Parcel`이 만들어지는 유일한 지점**이다.
 *
 * PROJ1-1-38 리뷰가 실측한 결과 `rowUid: newRowUid()`를 `rowUid: 'FIXED'`로 바꿔도
 * 268건이 전부 통과했다. 행 식별자를 지키는 테스트가 팩토리(`makeParcel`)에만 있고
 * 프로덕션 부여 지점은 무보호였다 — `sameParcelPredicate`를 아무리 지켜도
 * 입력이 상수면 무의미하다.
 *
 * 상수가 되면 일어나는 일이 정확히 PROJ1-1-37의 증상이다:
 * 문단리 한 건을 빼면 내성리도 함께 사라지고, 두 번째 키 없는 필지는 추가가 조용히
 * 거부되며, 표는 키 없는 행 전부를 체크된 것으로 그린다.
 */

const mapping: ColumnMapping = {
  farmerId: '경영체번호',
  parcelId: '필지번호',
  address: '필지주소',
  ri: '리',
};

const row = (over: Record<string, unknown> = {}) => ({
  경영체번호: '12345',
  필지번호: '100-1',
  필지주소: '경상북도 봉화군 봉화읍 문단리 100-1',
  리: '문단리',
  ...over,
});

describe('applyColumnMapping — rowUid', () => {
  it('행마다 다른 rowUid를 부여한다', () => {
    const out = applyColumnMapping([row(), row({ 필지번호: '200' })], mapping, 'master.xlsx');
    expect(out).toHaveLength(2);
    expect(out[0].rowUid).toBeTruthy();
    expect(out[1].rowUid).toBeTruthy();
    expect(out[0].rowUid).not.toBe(out[1].rowUid);
  });

  /**
   * 이 케이스가 없으면 `rowUid: 내용해시` 같은 잘못된 구현이 살아남는다.
   * 원본 엑셀에 완전히 같은 두 행이 있으면 **다른 행**이므로 식별자도 달라야 한다.
   */
  it('내용이 똑같은 두 행에도 서로 다른 rowUid를 준다', () => {
    const out = applyColumnMapping([row(), row()], mapping, 'master.xlsx');
    expect(out).toHaveLength(2);
    expect(out[0].rowUid).not.toBe(out[1].rowUid);
  });

  /** 정체성을 데이터 품질에서 떼어낸 것이 이 티켓의 목적이다. */
  it('경영체번호·주소·지번이 모두 비어도 rowUid는 부여된다', () => {
    const out = applyColumnMapping(
      [row({ 경영체번호: '', 필지번호: '', 필지주소: '', 리: '' })],
      { ...mapping, ri: undefined },
      'master.xlsx',
    );
    // 세 값이 모두 비면 마지막 filter에서 걸러진다 — 지번만 남겨 통과시킨다
    const kept = applyColumnMapping(
      [row({ 경영체번호: '', 필지주소: '' })],
      { ...mapping, ri: undefined },
      'master.xlsx',
    );
    expect(out).toHaveLength(0);
    expect(kept).toHaveLength(1);
    expect(kept[0].rowUid).toBeTruthy();
  });

  it('여러 번 호출해도 rowUid가 겹치지 않는다', () => {
    const a = applyColumnMapping([row()], mapping, 'a.xlsx');
    const b = applyColumnMapping([row()], mapping, 'b.xlsx');
    expect(a[0].rowUid).not.toBe(b[0].rowUid);
  });

  it('많은 행에서도 rowUid가 모두 고유하다', () => {
    const rows = Array.from({ length: 500 }, () => row());
    const out = applyColumnMapping(rows, mapping, 'master.xlsx');
    expect(new Set(out.map((p) => p.rowUid)).size).toBe(500);
  });
});
