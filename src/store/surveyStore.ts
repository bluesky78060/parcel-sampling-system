import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * 조사 연도 — 앱 전체의 연도 기준점.
 *
 * 예전에는 2024·2025·2026이 타입·로직·UI 세 층에 리터럴로 박혀 있어서,
 * 다음 해 조사에 쓰려면 코드를 고쳐야 했다(`year: 2024 | 2025 | 2026` 유니온이라
 * 2027을 넣으면 컴파일조차 안 됐다).
 *
 * **기채취 연도는 여기서 파생시킨다.** 따로 입력받으면 둘이 어긋나고, 그 불일치를
 * 아무도 검사하지 않는다 — 이 저장소에서 반복된 실패 패턴이다.
 *
 * **연도를 바꾸면 등록한 파일·분석·추출 결과를 함께 버려야 한다.** 업로드 슬롯과
 * 기채취 파일 조회가 전부 연도로 키를 잡기 때문에, 값만 바꾸면 이전 연도로 올린
 * 파일이 어느 슬롯에도 안 보이는 채로 남아 분석에 섞여 들어간다. 그래서 화면에서는
 * `setSurveyYear`를 직접 부르지 않고 `changeSurveyYear`(store/changeSurveyYear.ts)를 쓴다.
 */
interface SurveyStore {
  surveyYear: number;
  setSurveyYear: (year: number) => void;
}

/** 조사 연도 기본값. 조사는 통상 해당 연도에 진행한다. */
export const defaultSurveyYear = (): number => new Date().getFullYear();

/**
 * 저장소에서 읽은 값이 조사 연도로 쓸 수 있는 값인가.
 *
 * persist는 localStorage의 JSON을 그대로 state에 덮어쓴다. 값이 손상돼 문자열이나
 * 터무니없는 숫자가 들어오면 `surveyYear - 1`이 NaN이 되고, 그 NaN이 업로드 슬롯·
 * 시트명(`NaN_필지선정`)까지 그대로 흘러간다. 정수이고 그럴듯한 범위일 때만 받는다.
 */
export function isValidSurveyYear(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return false;
  const now = defaultSurveyYear();
  // 과거 조사 파일을 다시 열어 볼 여지는 남기되, 미래는 선택지 범위(+3)만큼만
  return value >= 2000 && value <= now + 3;
}

export const useSurveyStore = create<SurveyStore>()(
  persist(
    (set) => ({
      surveyYear: defaultSurveyYear(),
      setSurveyYear: (year) => set({ surveyYear: year }),
    }),
    {
      name: 'parcel-sampling-survey-year',
      version: 1,
      partialize: (st) => ({ surveyYear: st.surveyYear }),
      // 저장된 값은 사용자가 직접 고른 값이다 (첫 방문 기본값은 저장되지 않는다).
      // 해가 바뀌어도 그 선택을 유지한다 — 연말에 시작한 조사를 연초에 이어서 하는 경우.
      // 메인 화면에 연도가 항상 보이므로 잘못돼 있으면 사용자가 바로 알 수 있다.
      merge: (persisted, current) => {
        const stored = (persisted as Partial<SurveyStore> | undefined)?.surveyYear;
        return { ...current, surveyYear: isValidSurveyYear(stored) ? stored : current.surveyYear };
      },
      // 버전 0(필드 이름 동일)에서 올라올 때도 merge의 검증을 거치게만 하면 된다
      migrate: (persisted) => persisted as SurveyStore,
    },
  ),
);

/**
 * 기채취 연도 — 조사 연도의 직전 2개 연도.
 *
 * 최근 연도가 앞에 온다(N-1, N-2). 화면·통계·범례가 이 순서를 그대로 쓴다.
 */
export function sampledYearsOf(surveyYear: number): [number, number] {
  return [surveyYear - 1, surveyYear - 2];
}

/**
 * 선택 가능한 조사 연도 (현재 연도 기준 앞뒤).
 *
 * 지금 선택된 연도가 창 밖이면(예: 작년에 고른 값이 남아 있음) 목록에 넣는다.
 * 빠뜨리면 `<select>`가 첫 항목을 보여 주면서 실제 값은 다른 채로 어긋난다.
 */
export function selectableYears(current?: number): number[] {
  const now = defaultSurveyYear();
  const years = Array.from({ length: 7 }, (_, i) => now - 3 + i);
  if (current !== undefined && !years.includes(current)) years.push(current);
  return years.sort((a, b) => a - b);
}
