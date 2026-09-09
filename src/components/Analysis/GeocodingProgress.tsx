import type { GeocodingState } from '../../hooks/useGeocoding';

interface GeocodingProgressProps {
  /**
   * useGeocoding의 상태를 통째로 받는다.
   *
   * 예전에는 페이지가 상태를 숫자 프로퍼티 열 개로 풀어 넘겼고, 그 이음매에서 두 번
   * 결함이 났다 — 완료 여부를 컴포넌트가 자체 수식으로 다시 계산해 훅과 어긋났고,
   * 진단이 아직 없는 상태의 `0`이 "실패 0건"으로 읽혀 실행 중 실패 건수가 빈 목록으로
   * 증발했다. 매핑을 없애면 그 부류의 결함이 생길 자리가 없다.
   */
  state: GeocodingState;
  onCancel?: () => void;
}

export function GeocodingProgress({ state, onCancel }: GeocodingProgressProps) {
  const { isRunning, isComplete, serviceDown, failureKind, summary } = state;
  const { done, total, failed, note } = state.progress;

  // isRunning=false이고 done=0이면 렌더링하지 않음.
  // 단 서버 장애로 한 건도 처리하지 못한 경우는 그 사실을 보여줘야 한다.
  if (!isRunning && done === 0 && !serviceDown) {
    return null;
  }

  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  // 실패 건수의 출처는 하나다. 진단이 있으면 진단(확정값), 없으면 진행 카운터.
  // 둘을 섞어 쓰면 — 표시는 진행 카운터로, 검산은 진단으로 — 진단이 없는 실행 중에
  // 등식이 공허하게 성립해 내역 목록을 그리면서 항목은 하나도 없는 화면이 나온다.
  const failureTotal = summary ? summary.attemptedFailures : failed;
  // 실패 내역은 넘겨받은 값을 그대로 쓴다. 하나로 뭉치면 사용자가 취할 행동이 반대가
  // 된다 — 미응답은 다시 실행하면 되고, 한도는 오늘 다시 해도 같으며, 인증은 키 문제다.
  // 뺄셈으로 유도하지 않는 이유: 한 필지가 두 카테고리에 세어지면 뺄셈 쪽이 조용히
  // 깎여 실재하는 실패 종류가 목록에서 사라진다(실제로 그렇게 됐다).
  const breakdown = summary !== null
    && summary.notFound + summary.quotaBlocked + summary.unreachable + summary.authBlocked
      === summary.attemptedFailures;
  // 불변식이 현장에서 깨지면 화면은 조용히 총량만 보여준다 — 흔적은 남긴다.
  if (summary && !breakdown) {
    console.warn('[GeocodingProgress] 실패 내역 합이 맞지 않아 총량만 표시합니다:', summary);
  }

  return (
    <div className="rounded-lg shadow-sm border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-3 mb-3">
        {isRunning && (
          <svg
            className="w-5 h-5 text-blue-500 animate-spin flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        {!isRunning && serviceDown && (
          <svg
            className="w-5 h-5 text-red-500 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        )}
        {isComplete && (
          <svg
            className="w-5 h-5 text-green-500 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        )}
        <div className="flex-1 min-w-0">
          {isRunning ? (
            <p className="text-sm font-medium text-gray-700">
              좌표 변환 중... {done.toLocaleString()}/{total.toLocaleString()} ({percent}%)
              {/* Phase 0는 리 단위로 돌아 done이 몇 분씩 멈춘다. 활동을 따로 보여준다 */}
              {note && <span className="ml-2 text-xs font-normal text-gray-500">{note}</span>}
            </p>
          ) : serviceDown && summary && failureKind === 'no-results' ? (
            // 이 사유는 **중단이 아니다.** 전 건을 시도했고 서버가 전부 "좌표 없음"으로
            // 답했다. "멈췄습니다"라고 쓰면 남은 필지가 있는 줄 알고 다시 돌린다.
            <p className="text-sm font-medium text-red-700">
              좌표를 한 건도 얻지 못했습니다 — {total.toLocaleString()}건 전부 시도했습니다
            </p>
          ) : serviceDown && summary ? (
            <p className="text-sm font-medium text-red-700">
              좌표 변환 중단 — {summary.resolved.toLocaleString()}/{total.toLocaleString()}건에서 멈췄습니다
            </p>
          ) : isComplete && summary ? (
            <p className="text-sm font-medium text-green-700">
              좌표 변환 완료! {summary.resolved.toLocaleString()}/{total.toLocaleString()} 성공
            </p>
          ) : (
            // 취소·예외로 끝나 진단이 없는 상태. 확정값이 없으므로 성공 건수를 적지 않는다 —
            // 진행 카운터는 보고 채널이지 결과의 출처가 아니다.
            <p className="text-sm font-medium text-gray-600">
              좌표 변환이 중단되었습니다 ({done.toLocaleString()}/{total.toLocaleString()} 처리)
            </p>
          )}
          {/*
            실패 원인을 뭉뚱그리지 않는다. 서버 장애와 "이 주소에 좌표가 없음"은
            사용자가 취할 행동이 다르다 — 전자는 기다렸다 다시, 후자는 데이터 확인.
            사유는 진단의 failureKind 하나로 가른다. 실패 건수를 따로 비교해 판정하면
            오류 상자의 안내와 이 줄이 서로 반대 지시를 하게 된다.
          */}
          {serviceDown && (
            <p className="text-xs text-red-600 mt-0.5">
              {failureKind === 'quota'
                ? '호출 한도를 넘어 남은 필지는 시도하지 않았습니다. 한도가 초기화된 뒤 다시 실행하십시오.'
                : failureKind === 'auth'
                  ? '인증이 거부되어 남은 필지는 시도하지 않았습니다. 다시 시도해도 같으면 배포 키를 확인해야 합니다.'
                  : failureKind === 'no-results'
                    // 서버는 응답했다. 여기에 "응답하지 않았다"를 쓰면 사용자가 원인을
                    // 엉뚱한 곳에서 찾는다. 그리고 무엇을 했는지(지우지 않았다)를 밝혀야
                    // 사용자가 좌표가 남아 있는 이유를 안다.
                    ? '서버가 응답은 했지만 좌표를 한 건도 주지 않았습니다. 서버 이상일 수 있어 기존 좌표는 지우지 않았습니다. 잠시 후 다시 실행해 보고, 같은 결과라면 주소 데이터를 확인하십시오.'
                    : '서버가 응답하지 않아 남은 필지는 시도하지 않았습니다. 나중에 다시 실행하면 이미 변환된 건은 건너뜁니다.'}
            </p>
          )}
          {failureTotal > 0 && !breakdown && (
            <p className="text-xs text-red-500 mt-0.5">
              변환하지 못한 필지 {failureTotal.toLocaleString()}건
            </p>
          )}
          {/* breakdown이 참이면 네 항목의 합이 failureTotal(>0)이므로 목록이 비는 일은 없다 */}
          {failureTotal > 0 && breakdown && summary && (
            <ul className="text-xs text-red-500 mt-0.5 space-y-0.5">
              {summary.notFound > 0 && (
                <li>좌표를 찾지 못한 필지 {summary.notFound.toLocaleString()}건</li>
              )}
              {summary.unreachable > 0 && (
                <li className="text-red-600">
                  서버 미응답 {summary.unreachable.toLocaleString()}건 — 다시 실행하면 재시도합니다
                </li>
              )}
              {summary.quotaBlocked > 0 && (
                <li className="text-red-600">
                  호출 한도 초과 {summary.quotaBlocked.toLocaleString()}건 — 한도가 초기화된 뒤 실행하십시오
                </li>
              )}
              {summary.authBlocked > 0 && (
                <li className="text-red-600">
                  인증 거부 {summary.authBlocked.toLocaleString()}건 — 다시 시도해도 같으면 배포 키를 확인해야 합니다
                </li>
              )}
            </ul>
          )}
        </div>

        {/* 진행 중일 때 정지 버튼 */}
        {isRunning && onCancel && (
          <button
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 transition-colors flex-shrink-0"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            정지
          </button>
        )}

        {/* 장애로 멈춘 것에 진행률 배지를 붙이면 "0% 완료"처럼 읽힌다 */}
        {!isRunning && !serviceDown && (
          <span className="text-sm font-semibold text-gray-500 flex-shrink-0">{percent}%</span>
        )}
      </div>

      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            serviceDown ? 'bg-red-400' : isComplete ? 'bg-green-500' : 'bg-blue-500'
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
