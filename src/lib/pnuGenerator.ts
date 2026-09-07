/**
 * PNU(Parcel Number Unit) 코드 생성기
 * korea-parcel-tools 스킬 기반 — 경상북도 봉화군 전용
 *
 * PNU 19자리 구조:
 *   [시도 2자리][시군구 3자리][읍면동 3자리][리 2자리][산여부 1자리][본번 4자리][부번 4자리]
 */

const SIDO_CODE = '47'; // 경상북도
const SIGUNGU_CODE = '920'; // 봉화군

/**
 * 읍면+리 → (읍면동 코드, 리 코드)
 *
 * **이 표가 틀리면 다른 리의 필지 좌표를 가져온다.** 좌표 검증(`isValidBonghwaCoord`)은
 * 봉화군 전체를 통과시키므로 걸러지지 않고, 지도에 조용히 엉뚱한 곳이 찍힌다.
 *
 * 2026-09-07 VWorld 연속지적도로 전수 실측해 3건을 고쳤다.
 *   - `소천면_신라리 → 4792035025`가 실제로는 **소천면 서천리**였다.
 *     소천면에 신라리는 없다(주소 검색도 NOT_FOUND). 신라리는 상운면에만 있다.
 *   - 춘양면 우구치리(`340`,`28`), 소천면 남회룡리(`350`,`26`)가 누락돼 있었다.
 *
 * 표를 고쳤으면 반드시 실측으로 확인할 것:
 *   `node scripts/verify-eumri-map.mjs`
 */
const EUMRI_MAP: Record<string, [string, string]> = {
  // 봉화읍 (250)
  '봉화읍_삼계리': ['250', '22'], '봉화읍_유곡리': ['250', '23'],
  '봉화읍_거촌리': ['250', '24'], '봉화읍_석평리': ['250', '25'],
  '봉화읍_해저리': ['250', '26'], '봉화읍_적덕리': ['250', '27'],
  '봉화읍_화천리': ['250', '28'], '봉화읍_도촌리': ['250', '29'],
  '봉화읍_문단리': ['250', '30'], '봉화읍_내성리': ['250', '31'],
  // 물야면 (310)
  '물야면_오록리': ['310', '21'], '물야면_가평리': ['310', '22'],
  '물야면_개단리': ['310', '23'], '물야면_오전리': ['310', '24'],
  '물야면_압동리': ['310', '25'], '물야면_두문리': ['310', '26'],
  '물야면_수식리': ['310', '27'], '물야면_북지리': ['310', '28'],
  // 봉성면 (320)
  '봉성면_봉성리': ['320', '21'], '봉성면_외삼리': ['320', '23'],
  '봉성면_창평리': ['320', '24'], '봉성면_동양리': ['320', '25'],
  '봉성면_금봉리': ['320', '26'], '봉성면_우곡리': ['320', '27'],
  '봉성면_봉양리': ['320', '28'],
  // 법전면 (330)
  '법전면_법전리': ['330', '21'], '법전면_풍정리': ['330', '22'],
  '법전면_척곡리': ['330', '23'], '법전면_소천리': ['330', '24'],
  '법전면_눌산리': ['330', '25'], '법전면_어지리': ['330', '26'],
  '법전면_소지리': ['330', '27'],
  // 춘양면 (340)
  '춘양면_의양리': ['340', '21'], '춘양면_학산리': ['340', '22'],
  '춘양면_서동리': ['340', '23'], '춘양면_석현리': ['340', '24'],
  '춘양면_애당리': ['340', '25'], '춘양면_도심리': ['340', '26'],
  '춘양면_서벽리': ['340', '27'], '춘양면_우구치리': ['340', '28'],
  '춘양면_소로리': ['340', '29'],
  // 소천면 (350)
  '소천면_현동리': ['350', '21'], '소천면_고선리': ['350', '22'],
  '소천면_임기리': ['350', '23'], '소천면_두음리': ['350', '24'],
  '소천면_서천리': ['350', '25'], '소천면_남회룡리': ['350', '26'],
  '소천면_분천리': ['350', '27'],
  // 재산면 (360)
  '재산면_현동리': ['360', '21'], '재산면_남면리': ['360', '22'],
  '재산면_동면리': ['360', '23'], '재산면_갈산리': ['360', '24'],
  '재산면_상리': ['360', '25'],
  // 명호면 (370)
  '명호면_도천리': ['370', '21'], '명호면_삼동리': ['370', '22'],
  '명호면_양곡리': ['370', '23'], '명호면_고감리': ['370', '24'],
  '명호면_풍호리': ['370', '25'], '명호면_고계리': ['370', '26'],
  '명호면_북곡리': ['370', '27'], '명호면_관창리': ['370', '28'],
  // 상운면 (380)
  '상운면_가곡리': ['380', '21'], '상운면_운계리': ['380', '22'],
  '상운면_문촌리': ['380', '23'], '상운면_하눌리': ['380', '24'],
  '상운면_토일리': ['380', '25'], '상운면_구천리': ['380', '26'],
  '상운면_설매리': ['380', '27'], '상운면_신라리': ['380', '28'],
  // 석포면 (390)
  '석포면_석포리': ['390', '21'], '석포면_대현리': ['390', '22'],
  '석포면_승부리': ['390', '23'],
};

function toInt(val: string | number | null | undefined): number {
  if (val == null) return 0;
  const s = String(val).trim();
  if (!s || s === 'None' || s === 'nan' || s === 'NaN') return 0;
  const n = parseInt(s, 10);
  return isNaN(n) ? 0 : Math.abs(n);
}

function pad4(n: number): string {
  return String(n).padStart(4, '0');
}

/**
 * 읍면+리 → 리(里)까지의 법정동코드 10자리 (PNU 앞 10자리, 예: 4792025031).
 *
 * 헬스체크처럼 "실재하는 리 하나"가 필요한 곳에서 쓴다. 리터럴을 따로 적어 두면
 * `EUMRI_MAP` 검증(`scripts/verify-eumri-map.mjs`)이 그 값을 덮지 못한다 —
 * 실제로 존재하지 않는 코드가 헬스체크에 박혀 있던 적이 있다(2026-09-07).
 *
 * 표에 없는 이름은 프로그래밍 오류이므로 던진다.
 */
export function riCodePrefix(eubmyeondong: string, ri: string): string {
  const codes = EUMRI_MAP[`${eubmyeondong}_${ri}`];
  if (!codes) throw new Error(`EUMRI_MAP에 없는 리: ${eubmyeondong} ${ri}`);
  return `${SIDO_CODE}${SIGUNGU_CODE}${codes[0]}${codes[1]}`;
}

export interface PnuInput {
  eubmyeondong: string; // 읍면동 (예: '봉화읍')
  ri: string;           // 리동 (예: '적덕리')
  mainLotNum: string;   // 본번 (예: '402' 또는 '0402')
  subLotNum: string;    // 부번 (예: '1' 또는 '0001' 또는 '')
  isSan?: boolean;      // 산 번지 여부
}

/**
 * 주소 구성요소로부터 19자리 PNU 코드를 생성한다.
 * 매핑이 없으면 빈 문자열 반환.
 */
export function generatePnu(input: PnuInput): string {
  const eum = input.eubmyeondong.trim();
  const ri = input.ri.trim();
  const key = `${eum}_${ri}`;

  const codes = EUMRI_MAP[key];
  if (!codes) return '';

  const [eumCode, riCode] = codes;
  const bon = toInt(input.mainLotNum);
  const bub = toInt(input.subLotNum);
  const san = input.isSan ? '2' : '1';

  return `${SIDO_CODE}${SIGUNGU_CODE}${eumCode}${riCode}${san}${pad4(bon)}${pad4(bub)}`;
}

export interface PnuGenerationResult {
  totalProcessed: number;
  generated: number;
  skipped: number;
  errors: string[];
}

/**
 * Parcel 배열에서 PNU가 없는 필지에 대해 주소 정보로부터 PNU를 일괄 생성한다.
 * 기존 PNU가 있는 필지는 건드리지 않는다 (overwrite = false).
 */
export function generatePnuForParcels<T extends {
  pnu?: string;
  eubmyeondong: string;
  ri: string;
  mainLotNum: string;
  subLotNum: string;
  address: string;
}>(parcels: T[], overwrite = false): { updated: T[]; result: PnuGenerationResult } {
  const result: PnuGenerationResult = {
    totalProcessed: 0,
    generated: 0,
    skipped: 0,
    errors: [],
  };

  const updated = parcels.map((p) => {
    // 기존 PNU 유지 (overwrite가 false이고 이미 있을 때)
    if (!overwrite && p.pnu) {
      result.skipped++;
      return p;
    }

    result.totalProcessed++;

    // 산 번지 감지: 주소에 "산" 포함 여부
    const isSan = /\s산\s?\d/.test(p.address) || /산\d/.test(p.mainLotNum);

    const pnu = generatePnu({
      eubmyeondong: p.eubmyeondong,
      ri: p.ri,
      mainLotNum: p.mainLotNum.replace(/^산/, ''),
      subLotNum: p.subLotNum,
      isSan,
    });

    if (pnu) {
      result.generated++;
      return { ...p, pnu };
    }

    result.errors.push(`(${p.eubmyeondong}, ${p.ri}) 매핑 없음`);
    return p;
  });

  return { updated, result };
}

/** EUMRI_MAP에 등록된 전체 리 목록 반환 (디버깅/검증용) */
export function getRegisteredRis(): string[] {
  return Object.keys(EUMRI_MAP).map((k) => k.replace('_', ' '));
}
