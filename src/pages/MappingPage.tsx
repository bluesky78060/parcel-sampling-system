import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFileStore } from '../store/fileStore';
import type { FileConfig } from '../types';
import { ColumnMapper } from '../components/ColumnMapper/ColumnMapper';

export function MappingPage() {
  const navigate = useNavigate();
  const { files, activeFileId, setActiveFile } = useFileStore();
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());

  // 파일이 없으면 업로드 페이지로 리다이렉트
  useEffect(() => {
    if (files.length === 0) {
      navigate('/upload');
    }
  }, [files, navigate]);

  // 초기 활성 파일 설정
  useEffect(() => {
    if (files.length > 0 && !activeFileId) {
      setActiveFile(files[0].id);
    }
  }, [files, activeFileId, setActiveFile]);

  // 이미 mapped/loaded 상태인 파일을 초기 완료 목록에 반영
  useEffect(() => {
    const alreadyMapped = new Set(
      files.filter((f) => f.status === 'mapped' || f.status === 'loaded').map((f) => f.id)
    );
    setCompletedIds(alreadyMapped);
  }, []);

  const activeFile = files.find((f) => f.id === activeFileId) ?? files[0] ?? null;

  const allMapped = files.length > 0 && files.every((f) => completedIds.has(f.id));

  function handleMappingComplete(fileId: string) {
    setCompletedIds((prev) => new Set([...prev, fileId]));
  }

  function getRoleLabel(file: FileConfig) {
    if (file.role === 'master') return '마스터';
    return `표본(${file.year})`;
  }

  function getStatusBadge(file: FileConfig) {
    if (completedIds.has(file.id)) {
      return (
        <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">
          완료
        </span>
      );
    }
    return (
      <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">
        미완료
      </span>
    );
  }

  if (files.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 헤더 */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">컬럼 매핑</h2>
        <p className="mt-1 text-sm text-gray-500">
          업로드된 각 파일의 컬럼을 시스템 필드에 매핑하세요. 모든 파일의 매핑이 완료되어야 다음
          단계로 진행할 수 있습니다.
        </p>
      </div>

      <div className="flex flex-1 gap-6 min-h-0">
        {/* 좌측 사이드바 - 파일 목록 */}
        <aside className="w-56 flex-shrink-0">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                파일 목록
              </span>
            </div>
            <ul className="divide-y divide-gray-100">
              {files.map((file) => {
                const isActive = file.id === activeFile?.id;
                return (
                  <li key={file.id}>
                    <button
                      onClick={() => setActiveFile(file.id)}
                      className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors ${
                        isActive
                          ? 'bg-blue-50 border-l-2 border-blue-500'
                          : 'hover:bg-gray-50 border-l-2 border-transparent'
                      }`}
                    >
                      {/* 파일 아이콘 */}
                      <div className="mt-0.5 flex-shrink-0">
                        <svg
                          className={`w-4 h-4 ${isActive ? 'text-blue-500' : 'text-gray-400'}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                          />
                        </svg>
                      </div>

                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-sm font-medium truncate ${
                            isActive ? 'text-blue-700' : 'text-gray-700'
                          }`}
                        >
                          {file.filename}
                        </p>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-xs text-gray-400">{getRoleLabel(file)}</span>
                          {getStatusBadge(file)}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* 전체 진행 상황 */}
            <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>전체 진행</span>
                <span>
                  {completedIds.size} / {files.length}
                </span>
              </div>
              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-300"
                  style={{
                    width: `${files.length > 0 ? (completedIds.size / files.length) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          </div>
        </aside>

        {/* 우측 메인 - ColumnMapper */}
        <main className="flex-1 min-w-0">
          {activeFile ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm h-full overflow-auto">
              <ColumnMapper
                key={activeFile.id}
                fileConfig={activeFile}
                onMappingComplete={() => handleMappingComplete(activeFile.id)}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full bg-white rounded-xl border-2 border-dashed border-gray-200">
              <p className="text-gray-400">파일을 선택하세요</p>
            </div>
          )}
        </main>
      </div>

      {/* 하단 네비게이션 버튼 */}
      <div className="mt-6 flex justify-between items-center pt-4 border-t border-gray-200">
        <button
          onClick={() => navigate('/upload')}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium text-gray-600 bg-white border border-gray-300 hover:bg-gray-50 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          이전 단계
        </button>

        <div className="flex items-center gap-3">
          {!allMapped && (
            <p className="text-sm text-amber-600">
              {files.length - completedIds.size}개 파일의 매핑이 남아 있습니다.
            </p>
          )}
          {allMapped && (
            <p className="text-sm text-green-600 font-medium">모든 파일 매핑 완료</p>
          )}
          <button
            onClick={() => navigate('/analyze')}
            disabled={!allMapped}
            className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              allMapped
                ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            다음 단계
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
