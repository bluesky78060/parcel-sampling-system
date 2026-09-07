import { useSurveyStore } from './surveyStore';
import { useFileStore } from './fileStore';
import { useParcelStore } from './parcelStore';
import { useExtractionStore } from './extractionStore';

/**
 * 진행 중인 작업(등록 파일·분석·추출 결과)이 있는가.
 *
 * 연도를 바꿀 때 이걸 보고 사용자에게 확인을 받는다.
 */
export function hasWorkInProgress(): boolean {
  return (
    useFileStore.getState().files.length > 0 ||
    useParcelStore.getState().allParcels.length > 0 ||
    useExtractionStore.getState().result != null
  );
}

/**
 * 조사 연도를 바꾼다 — 진행 중인 작업은 함께 버린다.
 *
 * 업로드 슬롯 id(`master-2026`, `sampled-2025`…)와 분석의 기채취 파일 조회가 전부
 * 연도에서 파생되므로, 값만 바꾸면 이전 연도로 올린 파일이 **어느 슬롯에도 안 보이는
 * 채로 fileStore에 남는다.** 그 상태에서 분석 화면은 `role === 'master'`인 첫 파일을
 * 집어 옛 마스터로 분석한다. 반쯤 남기는 것보다 전부 비우는 편이 예측 가능하다.
 *
 * 화면은 `useSurveyStore.setSurveyYear`를 직접 부르지 말고 이 함수를 써야 한다
 * (scripts/verify-survey-year.mjs가 검사한다).
 *
 * @returns 실제로 바뀌었으면 true (같은 연도면 아무것도 하지 않는다)
 */
export function changeSurveyYear(year: number): boolean {
  if (year === useSurveyStore.getState().surveyYear) return false;
  // 순서: 추출 → 분석 → 파일. 각 reset은 동기이므로 어느 순서든 결과는 같지만,
  // 파생 결과부터 지워야 중간에 렌더가 끼어들어도 낡은 결과가 새 연도 문구로 보이지 않는다.
  useExtractionStore.getState().reset();
  useParcelStore.getState().reset();
  useFileStore.getState().reset();
  useSurveyStore.getState().setSurveyYear(year);
  return true;
}
