import type { FileConfig } from '../../types';

interface FileCardProps {
  fileConfig: FileConfig;
  onRemove: () => void;
}

const ROLE_LABEL: Record<FileConfig['role'], { label: string; bg: string; text: string }> = {
  master: { label: '마스터', bg: 'bg-purple-100', text: 'text-purple-700' },
  sampled: { label: '채취', bg: 'bg-amber-100', text: 'text-amber-700' },
  representative: { label: '대표필지', bg: 'bg-emerald-100', text: 'text-emerald-700' },
};

const STATUS_LABEL: Record<FileConfig['status'], { label: string; bg: string; text: string }> = {
  pending: { label: '매핑 대기', bg: 'bg-yellow-50', text: 'text-yellow-700' },
  mapped: { label: '매핑 완료', bg: 'bg-green-50', text: 'text-green-700' },
  loaded: { label: '로드 완료', bg: 'bg-green-50', text: 'text-green-700' },
};

export function FileCard({ fileConfig, onRemove }: FileCardProps) {
  const roleInfo = ROLE_LABEL[fileConfig.role];
  const statusInfo = STATUS_LABEL[fileConfig.status];

  return (
    <div className="w-full flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5">
      {/* File icon */}
      <svg className="w-5 h-5 flex-shrink-0 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>

      {/* File info */}
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-medium text-gray-900" title={fileConfig.filename}>
          {fileConfig.filename}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className={`inline-flex items-center rounded px-1.5 py-px text-[10px] font-semibold ${roleInfo.bg} ${roleInfo.text}`}>
            {roleInfo.label}
          </span>
          <span className="text-xs text-gray-400">
            {fileConfig.rowCount.toLocaleString()}행
          </span>
          {fileConfig.sheetName && (
            <span className="text-xs text-gray-300">
              · {fileConfig.sheetName}
            </span>
          )}
        </div>
      </div>

      {/* Status badge */}
      <span className={`flex-shrink-0 inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold ${statusInfo.bg} ${statusInfo.text}`}>
        {statusInfo.label}
      </span>

      {/* Remove button */}
      <button
        type="button"
        onClick={onRemove}
        className="flex-shrink-0 rounded p-0.5 text-gray-300 hover:bg-gray-100 hover:text-gray-500 transition-colors"
        aria-label="파일 제거"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>
    </div>
  );
}
