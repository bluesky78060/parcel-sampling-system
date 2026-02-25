import { useNavigate } from 'react-router-dom';
import { useFileStore } from '../store/fileStore';
import { FileUploader } from '../components/FileUploader/FileUploader';

const REQUIRED_SLOTS = [
  {
    slotId: 'master-2026',
    label: '마스터 파일',
    required: true,
    defaultYear: 2026 as const,
    defaultRole: 'master' as const,
  },
  {
    slotId: 'sampled-2024',
    label: '데이터 1',
    required: true,
    defaultYear: 2024 as const,
    defaultRole: 'sampled' as const,
  },
  {
    slotId: 'sampled-2025',
    label: '데이터 2',
    required: true,
    defaultYear: 2025 as const,
    defaultRole: 'sampled' as const,
  },
] as const;

const OPTIONAL_SLOTS = [
  {
    slotId: 'representative',
    label: '대표필지 파일 (선택사항)',
    required: false,
    defaultYear: 2026 as const,
    defaultRole: 'representative' as const,
  },
  {
    slotId: 'extra-ref',
    label: '추가 참고 파일',
    required: false,
    defaultYear: 2026 as const,
    defaultRole: 'master' as const,
  },
] as const;

const SLOTS = [...REQUIRED_SLOTS, ...OPTIONAL_SLOTS] as const;

const REQUIRED_SLOT_IDS = SLOTS.filter((s) => s.required).map((s) => s.slotId);

export function UploadPage() {
  const navigate = useNavigate();
  const { files } = useFileStore();

  const uploadedIds = new Set(files.map((f) => f.id));
  const allRequiredUploaded = REQUIRED_SLOT_IDS.every((id) => uploadedIds.has(id));

  const handleNext = () => {
    if (allRequiredUploaded) {
      navigate('/mapping');
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">파일 등록</h2>
        <p className="mt-1 text-gray-600">분석에 사용할 엑셀 파일을 업로드하세요. 필수 파일 3개를 모두 등록해야 다음 단계로 이동할 수 있습니다.</p>
      </div>

      {/* 필수 파일 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {REQUIRED_SLOTS.map((slot) => (
          <div key={slot.slotId} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
            <FileUploader
              slotId={slot.slotId}
              label={slot.label}
              required={slot.required}
              defaultYear={slot.defaultYear}
              defaultRole={slot.defaultRole}
            />
          </div>
        ))}
      </div>

      {/* 선택 파일 구분선 */}
      <div className="mt-6 mb-4 flex items-center gap-3">
        <div className="h-px flex-1 bg-gray-200" />
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">선택 파일</span>
        <div className="h-px flex-1 bg-gray-200" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {OPTIONAL_SLOTS.map((slot) => (
          <div
            key={slot.slotId}
            className={`rounded-xl border p-3 shadow-sm ${
              slot.slotId === 'representative'
                ? 'border-emerald-200 bg-emerald-50/30'
                : 'border-gray-200 bg-white'
            }`}
          >
            <FileUploader
              slotId={slot.slotId}
              label={slot.label}
              required={slot.required}
              defaultYear={slot.defaultYear}
              defaultRole={slot.defaultRole}
            />
            {slot.slotId === 'representative' && (
              <p className="mt-2 text-xs text-gray-500">
                3개년 전 데이터에서 지정된 대표필지. 마스터 파일 매칭 없이 그대로 포함됩니다.
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <p className="text-sm text-gray-500">
          필수 파일 {REQUIRED_SLOT_IDS.filter((id) => uploadedIds.has(id)).length} / {REQUIRED_SLOT_IDS.length} 등록됨
        </p>
        <button
          type="button"
          onClick={handleNext}
          disabled={!allRequiredUploaded}
          className={`
            inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold shadow-sm transition-colors
            ${allRequiredUploaded
              ? 'bg-indigo-600 text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2'
              : 'cursor-not-allowed bg-gray-200 text-gray-400'
            }
          `}
        >
          다음 단계: 컬럼 매핑
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
    </div>
  );
}
