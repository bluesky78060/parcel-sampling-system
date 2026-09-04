import { useState, useRef, useCallback } from 'react';
import type { DragEvent, ChangeEvent } from 'react';
import type { FileConfig } from '../../types';
import { getSheetNames, parseExcelSheets, getSheetRowCounts } from '../../lib/excelParser';
import { useFileStore } from '../../store/fileStore';
import { FileCard } from './FileCard';
import { SheetSelector } from './SheetSelector';

interface FileUploaderProps {
  slotId: string;
  label: string;
  required: boolean;
  defaultYear: 2024 | 2025 | 2026;
  defaultRole: 'sampled' | 'master' | 'representative';
}

export function FileUploader({ slotId, label, required, defaultYear, defaultRole }: FileUploaderProps) {
  const { files, addFile, removeFile, updateFile } = useFileStore();
  const [isDragOver, setIsDragOver] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // 진행 중인 파싱 요청 식별자. 시트를 연달아 바꾸거나 파싱 중 파일을 제거하면
  // 늦게 도착한 이전 결과가 최신 상태를 덮어쓸 수 있어, 최신 요청만 반영한다.
  const requestIdRef = useRef(0);

  const uploadedFile = files.find((f) => f.id === slotId) ?? null;

  // 시트 정보는 스토어에서 파생한다. 컴포넌트 로컬 상태로 두면 다른 단계로 이동했다
  // 돌아왔을 때 선택 UI가 사라져 시트를 다시 고를 수 없게 된다.
  const sheets = uploadedFile?.allSheetNames ?? [];
  const selectedSheets = uploadedFile?.sheetNames ?? [];
  const sheetRowCounts = uploadedFile?.allSheetRowCounts ?? {};
  const sourceFile = uploadedFile?.sourceFile ?? null;

  const processFile = useCallback(async (file: File, targetSheets?: string[]) => {
    const requestId = ++requestIdRef.current;
    const isStale = () => requestId !== requestIdRef.current;

    setIsLoading(true);
    setError(null);
    try {
      const sheetNames = await getSheetNames(file);
      if (isStale()) return;

      // 선택이 없으면 첫 시트를 기본으로 곧바로 로드한다.
      // (선택을 기다렸다 등록하면 사용자가 기본값을 그대로 쓰려 할 때 등록할 방법이 없어진다)
      const targets = targetSheets?.length ? targetSheets : [sheetNames[0]];

      const counts = await getSheetRowCounts(file);
      if (isStale()) return;

      const { headers, rows, perSheet } = await parseExcelSheets(file, targets);
      if (isStale()) return;

      const isMultiSheet = sheetNames.length > 1;

      if (targets.length > 1) {
        console.info(
          `[업로드] ${file.name}: ${targets.length}개 시트 합침 → ${rows.length.toLocaleString()}행 ` +
          `(${targets.map(s => `${s} ${perSheet[s]?.toLocaleString() ?? 0}`).join(' + ')})`
        );
      }

      const fileConfig: FileConfig = {
        id: slotId,
        filename: file.name,
        year: defaultYear,
        role: defaultRole,
        columnMapping: { farmerId: '', parcelId: '', address: '' },
        sheetName: targets[0],
        sheetNames: targets,
        sheetRowCounts: perSheet,
        // 시트가 여러 개일 때만 선택 UI를 띄운다
        allSheetNames: isMultiSheet ? sheetNames : undefined,
        // 실제로 읽은 시트는 정확한 행 수로 덮어쓴다 (counts는 !ref 기반 추정치)
        allSheetRowCounts: isMultiSheet ? { ...counts, ...perSheet } : undefined,
        sourceFile: isMultiSheet ? file : undefined,
        rowCount: rows.length,
        status: 'pending',
        rawData: rows,
        headers,
      };

      if (files.some((f) => f.id === slotId)) {
        updateFile(slotId, fileConfig);
      } else {
        addFile(fileConfig);
      }
    } catch (err) {
      if (isStale()) return;
      // 실패 시 스토어를 갱신하지 않으므로 기존 선택이 그대로 유지된다
      setError(err instanceof Error ? err.message : '파일 파싱 중 오류가 발생했습니다.');
    } finally {
      if (!isStale()) setIsLoading(false);
    }
  }, [slotId, defaultYear, defaultRole, files, addFile, updateFile]);

  const handleSheetChange = useCallback(async (next: string[]) => {
    if (sourceFile) {
      await processFile(sourceFile, next);
    }
  }, [sourceFile, processFile]);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const ext = file.name.toLowerCase().split('.').pop();
    if (!['xlsx', 'xls', 'csv'].includes(ext ?? '')) {
      setError('지원하지 않는 파일 형식입니다. .xlsx, .xls, .csv 파일만 업로드 가능합니다.');
      return;
    }
    await processFile(file);
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await processFile(file);
    e.target.value = '';
  };

  const handleRemove = () => {
    // 진행 중인 파싱 결과가 제거 후에 되살아나지 않도록 무효화한다
    requestIdRef.current++;
    removeFile(slotId);
    setError(null);
    setIsLoading(false);
  };

  if (uploadedFile) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-gray-700">
          {label}
          {required && <span className="ml-1 text-red-500">*</span>}
        </p>
        <FileCard fileConfig={uploadedFile} onRemove={handleRemove} />
        {/* 다중 시트 파일은 등록 후에도 시트를 바꿀 수 있어야 한다 */}
        <SheetSelector
          sheets={sheets}
          selected={selectedSheets}
          rowCounts={sheetRowCounts}
          onChange={handleSheetChange}
          disabled={isLoading}
        />
        {isLoading && <p className="text-xs text-gray-500">시트를 다시 읽는 중...</p>}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-gray-700">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </p>
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`
          relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed
          px-4 py-4 cursor-pointer transition-colors
          ${isDragOver
            ? 'border-indigo-400 bg-indigo-50'
            : 'border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-gray-100'
          }
          ${isLoading ? 'pointer-events-none opacity-60' : ''}
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleFileChange}
          className="hidden"
        />
        {isLoading ? (
          <div className="flex flex-col items-center gap-2">
            <svg className="h-6 w-6 animate-spin text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-sm text-gray-500">파일 파싱 중...</p>
          </div>
        ) : (
          <>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-sm text-gray-600 text-center">
              파일을 드래그하거나 <span className="text-indigo-600 font-medium">클릭하여 선택</span>
            </p>
            <p className="mt-1 text-xs text-gray-400">.xlsx, .xls, .csv</p>
          </>
        )}
      </div>

      {sheets.length > 1 && (
        <SheetSelector
          sheets={sheets}
          selected={selectedSheets}
          rowCounts={sheetRowCounts}
          onChange={handleSheetChange}
          disabled={isLoading}
        />
      )}

      {error && (
        <p className="text-xs text-red-600 flex items-center gap-1">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          {error}
        </p>
      )}
    </div>
  );
}
