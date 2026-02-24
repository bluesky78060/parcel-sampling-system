import { useLocation, Link } from 'react-router-dom';
import { STEPS } from '../../types';
import { useFileStore } from '../../store/fileStore';
import { useParcelStore } from '../../store/parcelStore';
import { useExtractionStore } from '../../store/extractionStore';

export function Stepper() {
  const location = useLocation();
  const currentIndex = STEPS.findIndex(s => s.path === location.pathname);

  const files = useFileStore(s => s.files);
  const allParcels = useParcelStore(s => s.allParcels);
  const result = useExtractionStore(s => s.result);

  function isAccessible(stepId: string): boolean {
    switch (stepId) {
      case 'upload':
        return true;
      case 'mapping':
        return files.length > 0;
      case 'analyze':
        return files.some(f => f.status === 'mapped');
      case 'extract':
        return allParcels.length > 0;
      case 'review':
        return result !== null;
      case 'export':
        return result !== null;
      default:
        return false;
    }
  }

  return (
    <nav className="bg-white border-b border-gray-200 px-6 py-3">
      <ol className="flex items-center gap-2">
        {STEPS.map((step, index) => {
          const isCompleted = index < currentIndex;
          const isCurrent = index === currentIndex;
          const accessible = isAccessible(step.id);

          return (
            <li key={step.id} className="flex items-center">
              <Link
                to={step.path}
                onClick={e => { if (!accessible) e.preventDefault(); }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-colors ${
                  !accessible
                    ? 'text-gray-300 pointer-events-none cursor-not-allowed'
                    : isCurrent
                    ? 'bg-blue-100 text-blue-700 font-semibold'
                    : isCompleted
                    ? 'text-green-700 hover:bg-green-50'
                    : 'text-gray-400'
                }`}
              >
                <span
                  className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                    !accessible
                      ? 'bg-gray-100 text-gray-300'
                      : isCurrent
                      ? 'bg-blue-600 text-white'
                      : isCompleted
                      ? 'bg-green-500 text-white'
                      : 'bg-gray-200 text-gray-500'
                  }`}
                >
                  {isCompleted && accessible ? '✓' : index + 1}
                </span>
                <span className="hidden sm:inline">{step.label}</span>
              </Link>
              {index < STEPS.length - 1 && (
                <span className="mx-1 text-gray-300">→</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
