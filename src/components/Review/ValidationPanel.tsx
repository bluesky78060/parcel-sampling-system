import type { ValidationResult } from '../../types';

interface ValidationPanelProps {
  validation: ValidationResult;
  selectedCount: number;
  targetCount: number;
}

export function ValidationPanel({ validation, selectedCount, targetCount }: ValidationPanelProps) {
  const diff = selectedCount - targetCount;
  const diffLabel =
    diff === 0
      ? '목표 충족'
      : diff > 0
      ? `+${diff} 초과`
      : `${diff} 부족`;
  const diffColor =
    diff === 0 ? 'text-green-600' : diff > 0 ? 'text-orange-500' : 'text-red-600';

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
        <div className="flex items-center gap-2">
          {validation.isValid ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              검증 통과
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              검증 실패
            </span>
          )}
          {validation.warnings.length > 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              경고 {validation.warnings.length}건
            </span>
          )}
        </div>

        {/* 통계 요약 */}
        <div className="flex items-center gap-4 text-sm">
          <span className="text-gray-600">
            선택{' '}
            <span className="font-semibold text-gray-900">{selectedCount.toLocaleString()}</span>
            {' / '}
            목표{' '}
            <span className="font-semibold text-gray-900">{targetCount.toLocaleString()}</span>
          </span>
          <span className={`font-medium text-sm ${diffColor}`}>{diffLabel}</span>
        </div>
      </div>

      {/* 에러 / 경고 목록 */}
      {(validation.errors.length > 0 || validation.warnings.length > 0) ? (
        <div className="divide-y divide-gray-100">
          {validation.errors.map((err, idx) => (
            <div key={`err-${idx}`} className="flex gap-3 px-4 py-3 bg-red-50">
              <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              <div className="min-w-0">
                <p className="text-sm font-medium text-red-800">{err.message}</p>
                {err.details && (
                  <p className="text-xs text-red-600 mt-0.5">{err.details}</p>
                )}
              </div>
            </div>
          ))}
          {validation.warnings.map((warn, idx) => (
            <div key={`warn-${idx}`} className="flex gap-3 px-4 py-3 bg-yellow-50">
              <svg className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20A10 10 0 0012 2z" />
              </svg>
              <div className="min-w-0">
                <p className="text-sm font-medium text-yellow-800">{warn.message}</p>
                {warn.details && (
                  <p className="text-xs text-yellow-600 mt-0.5">{warn.details}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 px-4 py-3 text-sm text-green-700">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          모든 검증을 통과했습니다.
        </div>
      )}
    </div>
  );
}
