import type { FileConfig } from '../types';
import { sampledYearsOf } from '../store/surveyStore';

export interface UploadSlot {
  slotId: string;
  label: string;
  required: boolean;
  defaultYear: number;
  defaultRole: FileConfig['role'];
}

/**
 * 업로드 슬롯 — 조사 연도에서 파생된다.
 *
 * 예전에는 2026/2024/2025가 UploadPage 모듈 상수에 박혀 있어서 다음 해 조사에 쓰려면
 * 코드를 고쳐야 했다. 기채취 두 해는 `sampledYearsOf`가 정한 순서(N-1, N-2)를 그대로 쓴다.
 *
 * 화면 밖으로 꺼내 둔 이유: 슬롯 id가 연도를 품고 있어서, 연도를 바꾸면 이전 파일이
 * 고아가 되는지를 node 검증(scripts/verify-survey-year.mjs)이 직접 돌려 볼 수 있어야 한다.
 */
export function buildUploadSlots(surveyYear: number) {
  const [recent, older] = sampledYearsOf(surveyYear);
  const required: UploadSlot[] = [
    {
      slotId: `master-${surveyYear}`,
      label: `마스터 파일 (${surveyYear})`,
      required: true,
      defaultYear: surveyYear,
      defaultRole: 'master',
    },
    {
      slotId: `sampled-${recent}`,
      label: `${recent} 기채취`,
      required: true,
      defaultYear: recent,
      defaultRole: 'sampled',
    },
    {
      slotId: `sampled-${older}`,
      label: `${older} 기채취`,
      required: true,
      defaultYear: older,
      defaultRole: 'sampled',
    },
  ];
  const optional: UploadSlot[] = [
    {
      slotId: 'representative',
      label: '대표필지 파일 (선택사항)',
      required: false,
      defaultYear: surveyYear,
      defaultRole: 'representative',
    },
    {
      slotId: 'extra-ref',
      label: '추가 참고 파일',
      required: false,
      defaultYear: surveyYear,
      defaultRole: 'master',
    },
  ];
  const all = [...required, ...optional];
  return { required, optional, all, requiredIds: required.map((x) => x.slotId) };
}
