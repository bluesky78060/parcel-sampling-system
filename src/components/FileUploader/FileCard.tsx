import type { FileConfig } from '../../types';

interface FileCardProps {
  fileConfig: FileConfig;
  onRemove: () => void;
}

const ROLE_LABEL: Record<FileConfig['role'], string> = {
  master: '마스터',
  sampled: '채취',
};

const STATUS_LABEL: Record<FileConfig['status'], { label: string; className: string }> = {
  pending: { label: '매핑 대기', className: 'bg-yellow-100 text-yellow-800' },
  mapped: { label: '매핑 완료', className: 'bg-blue-100 text-blue-800' },
  loaded: { label: '로드 완료', className: 'bg-green-100 text-green-800' },
};

export function FileCard({ fileConfig, onRemove }: FileCardProps) {
  const statusInfo = STATUS_LABEL[fileConfig.status];

  return (
    <div className="w-full rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="truncate font-medium text-gray-900 text-sm" title={fileConfig.filename}>
            {fileConfig.filename}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800">
              {fileConfig.year}년
            </span>
            <span className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">
              {ROLE_LABEL[fileConfig.role]}
            </span>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusInfo.className}`}>
              {statusInfo.label}
            </span>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            {fileConfig.rowCount.toLocaleString()}행
            {fileConfig.sheetName && (
              <span className="ml-2 text-gray-400">시트: {fileConfig.sheetName}</span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="flex-shrink-0 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          aria-label="파일 제거"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
