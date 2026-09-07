import { describe, expect, it } from 'vitest';
import {
  buildParcelId,
  isSameAddress,
  normalizeAddress,
  normalizeAddressLotNumber,
  parseEubmyeondong,
  parseLotNumber,
  parseRi,
  parseSido,
  parseSigungu,
} from '../addressParser';

describe('parseRi', () => {
  it('리를 뽑는다', () => {
    expect(parseRi('경상북도 봉화군 봉화읍 내성리 100')).toBe('내성리');
    expect(parseRi('경상북도 봉화군 소천면 남회룡리 산123-4')).toBe('남회룡리');
  });

  it('지번이 공백 없이 붙어도 뽑는다', () => {
    expect(parseRi('경상북도 봉화군 봉화읍 내성리100')).toBe('내성리');
  });

  it('주소 끝이 리로 끝나도 뽑는다', () => {
    expect(parseRi('경상북도 봉화군 봉화읍 내성리')).toBe('내성리');
  });

  it('리가 없으면 읍면동으로 폴백한다', () => {
    expect(parseRi('서울특별시 강남구 역삼동 123')).toBe('역삼동');
    expect(parseRi('경상북도 봉화군 봉화읍 123')).toBe('봉화읍');
  });

  it('어느 것도 없으면 미분류다', () => {
    expect(parseRi('경상북도 봉화군')).toBe('미분류');
    expect(parseRi('')).toBe('미분류');
  });
});

describe('parseSigungu', () => {
  it('시군구를 뽑는다', () => {
    expect(parseSigungu('경상북도 봉화군 봉화읍 내성리 100')).toBe('봉화군');
    expect(parseSigungu('충남 아산시 염치읍 강청리 123-4')).toBe('아산시');
  });

  it('시군구가 없으면 빈 문자열이다', () => {
    expect(parseSigungu('')).toBe('');
  });

  /**
   * PROJ1-1-6에 기록된 결함. `[가-힣]+(?:시|군|구)`가 앞에서부터 매치하므로
   * 시도의 '시'를 먼저 물어 시도와 시군구가 같은 값이 된다.
   *
   * 현재 대상(봉화군)에서는 드러나지 않지만 다른 시군으로 확장하면 즉시 문제가 된다.
   * PROJ1-1-6에서 고치면 이 테스트가 "예상과 달리 통과했다"며 실패한다 —
   * 그때 `it.fails`를 `it`으로 바꾸면 된다.
   */
  it.fails('[PROJ1-1-6 미수정] 광역시·특별시를 시군구로 오인하지 않아야 한다', () => {
    expect(parseSigungu('서울특별시 강남구 역삼동 123')).toBe('강남구');
  });
});

describe('parseEubmyeondong', () => {
  it('읍·면·동을 뽑는다', () => {
    expect(parseEubmyeondong('경상북도 봉화군 봉화읍 내성리 100')).toBe('봉화읍');
    expect(parseEubmyeondong('경상북도 봉화군 상운면 운계리 165')).toBe('상운면');
    expect(parseEubmyeondong('서울특별시 강남구 역삼동 123')).toBe('역삼동');
  });
});

describe('parseSido', () => {
  it('정식 시도명을 뽑는다', () => {
    expect(parseSido('경상북도 봉화군 봉화읍 내성리 100')).toBe('경상북도');
    expect(parseSido('서울특별시 강남구 역삼동 123')).toBe('서울특별시');
  });

  /**
   * 실측으로 확인한 동작. 소스의 JSDoc은 `"충남 아산시…" → "충남"`이라고 적어
   * 두었지만 실제로는 빈 문자열을 돌려준다 — `[가-힣]+` 뒤에 접미사
   * (도/시/특별시/광역시/…)가 반드시 와야 하는데 "충남"의 '남'이 그 목록에 없다.
   *
   * 봉화군 데이터는 "경상북도"로 들어와 드러나지 않는다. 다만 다른 시군 파일이
   * 축약형으로 들어오면 시도가 통째로 비고, 조립 주소에서도 시도가 빠진다.
   * 지금 이 동작을 고칠지는 PROJ1-1-6(주소 파싱 정리)에서 함께 정한다.
   */
  it('축약형 시도명은 인식하지 못한다 (JSDoc 예시와 실제가 다름)', () => {
    expect(parseSido('충남 아산시 염치읍 강청리 123-4')).toBe('');
    expect(parseSido('경북 봉화군 봉화읍 거촌리 127번지')).toBe('');
  });
});

describe('parseLotNumber', () => {
  it('리 뒤의 본번·부번을 뽑는다', () => {
    expect(parseLotNumber('충남 아산시 염치읍 강청리 123-4')).toEqual({
      mainLotNum: '123',
      subLotNum: '4',
    });
  });

  it('부번이 없으면 빈 문자열이다', () => {
    expect(parseLotNumber('경상북도 봉화군 봉화읍 내성리 100')).toEqual({
      mainLotNum: '100',
      subLotNum: '',
    });
  });

  it('산 번지의 산을 본번에 붙여 돌려준다', () => {
    expect(parseLotNumber('경상북도 봉화군 소천면 남회룡리 산123-4')).toEqual({
      mainLotNum: '산123',
      subLotNum: '4',
    });
  });

  it('번지 접미사를 무시한다', () => {
    expect(parseLotNumber('경북 봉화군 봉화읍 거촌리 127번지')).toEqual({
      mainLotNum: '127',
      subLotNum: '',
    });
  });

  it('뒤에 건물 정보가 붙어도 지번만 뽑는다', () => {
    expect(parseLotNumber('경북 봉화군 봉화읍 내성리 183-2 목련맨션 103호')).toEqual({
      mainLotNum: '183',
      subLotNum: '2',
    });
  });

  it('지번이 없으면 빈 값이다', () => {
    expect(parseLotNumber('경상북도 봉화군 봉화읍 내성리')).toEqual({
      mainLotNum: '',
      subLotNum: '',
    });
  });
});

/**
 * PROJ1-1-19. VWORLD가 선행 0이 붙은 본번을 인식하지 못해 2027 파일 40,809행이
 * 전량 NOT_FOUND가 났다. 지오코딩 조회용으로만 쓰는 정규화다 —
 * 엑셀 산출물의 필지주소는 원본을 유지해야 담당자가 대조할 수 있다.
 */
describe('normalizeAddressLotNumber', () => {
  it('본번의 선행 0을 뗀다', () => {
    expect(normalizeAddressLotNumber('경상북도 봉화군 상운면 운계리 0165-0001')).toBe(
      '경상북도 봉화군 상운면 운계리 165-1',
    );
  });

  it('부번이 전부 0이면 부번을 통째로 뗀다', () => {
    expect(normalizeAddressLotNumber('경상북도 봉화군 상운면 운계리 0165-00')).toBe(
      '경상북도 봉화군 상운면 운계리 165',
    );
    expect(normalizeAddressLotNumber('경상북도 봉화군 상운면 운계리 165-0')).toBe(
      '경상북도 봉화군 상운면 운계리 165',
    );
  });

  it('산 번지의 산 표기를 보존한다', () => {
    expect(normalizeAddressLotNumber('경상북도 봉화군 봉화읍 적덕리 산 0056')).toBe(
      '경상북도 봉화군 봉화읍 적덕리 산 56',
    );
    expect(normalizeAddressLotNumber('경상북도 봉화군 봉화읍 적덕리 산0056')).toBe(
      '경상북도 봉화군 봉화읍 적덕리 산56',
    );
  });

  it('이미 정상인 지번은 그대로 둔다', () => {
    const addr = '경상북도 봉화군 봉화읍 문단리 1043-2';
    expect(normalizeAddressLotNumber(addr)).toBe(addr);
  });

  it('지번이 아닌 뒤쪽 숫자는 건드리지 않는다', () => {
    // 끝 토큰이 건물 정보면 매치 자체가 일어나지 않아야 한다.
    const addr = '경북 봉화군 봉화읍 내성리 183-2 목련맨션 103호';
    expect(normalizeAddressLotNumber(addr)).toBe(addr);
  });

  /**
   * 실측으로 확인한 사각지대. 정규식이 `\s*$`로 끝나므로 지번 뒤에 "번지"가
   * 붙으면 매치되지 않아 선행 0이 남는다. 즉 `… 거촌리 0127번지`는
   * 정규화를 통과하지 못하고 VWORLD에서 NOT_FOUND가 난다.
   *
   * 2026-09-07 기준 실사용 파일(2026·2027)에서 "번지" 접미사와 0패딩이 함께
   * 나타나는 조합은 확인되지 않아 별도 티켓을 내지 않았다. 새 파일에서
   * 지오코딩이 특정 행만 실패하면 여기를 먼저 볼 것.
   */
  it('번지 접미사가 붙으면 정규화되지 않는다 (알려진 사각지대)', () => {
    const addr = '경북 봉화군 봉화읍 거촌리 0127번지';
    expect(normalizeAddressLotNumber(addr)).toBe(addr);
  });
});

describe('normalizeAddress / isSameAddress', () => {
  it('공백과 특수문자를 지운다', () => {
    expect(normalizeAddress('경상북도 봉화군 봉화읍 내성리 100-1')).toBe(
      '경상북도봉화군봉화읍내성리1001',
    );
  });

  it('표기가 달라도 같은 주소로 본다', () => {
    expect(
      isSameAddress('경상북도 봉화군 봉화읍 내성리 100-1', '경상북도봉화군봉화읍내성리100-1'),
    ).toBe(true);
  });

  /**
   * 중복 감지가 이 함수에 의존한다. 하이픈을 지우므로 `100-1`과 `1001`이
   * 같은 주소가 된다 — 실제로 충돌 가능한 지번 조합이다.
   * PNU가 있는 필지는 PNU로 먼저 비교하므로 이 폴백까지 내려오지 않는다.
   */
  it('하이픈을 지우기 때문에 100-1과 1001을 구분하지 못한다', () => {
    expect(
      isSameAddress('경상북도 봉화군 봉화읍 내성리 100-1', '경상북도 봉화군 봉화읍 내성리 1001'),
    ).toBe(true);
  });
});

describe('buildParcelId', () => {
  it('본번과 부번을 잇는다', () => {
    expect(buildParcelId('123', '4')).toBe('123-4');
  });

  it('부번이 없으면 본번만 쓴다', () => {
    expect(buildParcelId('123', '')).toBe('123');
  });

  it('영-부번은 모든 자릿수에서 무시한다', () => {
    expect(buildParcelId('123', '0')).toBe('123');
    expect(buildParcelId('123', '00')).toBe('123');
    expect(buildParcelId('123', '0000')).toBe('123');
  });

  it('본번이 없으면 빈 문자열이다', () => {
    expect(buildParcelId('', '4')).toBe('');
    expect(buildParcelId('  ', '4')).toBe('');
  });

  it('앞뒤 공백을 다듬는다', () => {
    expect(buildParcelId(' 123 ', ' 4 ')).toBe('123-4');
  });
});
