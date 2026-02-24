interface GeocodingProgressProps {
  done: number;
  total: number;
  failed: number;
  isRunning: boolean;
}

export function GeocodingProgress({ done, total, failed, isRunning }: GeocodingProgressProps) {
  // isRunning=false이고 done=0이면 렌더링하지 않음
  if (!isRunning && done === 0) {
    return null;
  }

  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const isComplete = !isRunning && done > 0;
  const succeeded = done - failed;

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
            </p>
          ) : (
            <p className="text-sm font-medium text-green-700">
              좌표 변환 완료! {succeeded.toLocaleString()}/{total.toLocaleString()} 성공
            </p>
          )}
          {failed > 0 && (
            <p className="text-xs text-red-500 mt-0.5">변환 실패: {failed.toLocaleString()}건</p>
          )}
        </div>
        <span className="text-sm font-semibold text-gray-500 flex-shrink-0">{percent}%</span>
      </div>

      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            isComplete ? 'bg-green-500' : 'bg-blue-500'
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
