import { useState, useRef, useCallback } from 'react';
import type { DragEvent, ChangeEvent } from 'react';
import type { FileConfig } from '../../types';
import { getSheetNames, parseExcelFile } from '../../lib/excelParser';
import { useFileStore } from '../../store/fileStore';
import { FileCard } from './FileCard';
import { SheetSelector } from './SheetSelector';

interface FileUploaderProps {
  slotId: string;
  label: string;
  required: boolean;
  defaultYear: 2024 | 2025 | 2026;
  defaultRole: 'sampled' | 'master';
}

export function FileUploader({ slotId, label, required, defaultYear, defaultRole }: FileUploaderProps) {
  const { files, addFile, removeFile, updateFile } = useFileStore();
  const [isDragOver, setIsDragOver] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadedFile = files.find((f) => f.id === slotId) ?? null;

  const processFile = useCallback(async (file: File, sheetName?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const sheetNames = await getSheetNames(file);
      const targetSheet = sheetName ?? sheetNames[0];

      if (sheetNames.length > 1 && !sheetName) {
        setSheets(sheetNames);
        setSelectedSheet(sheetNames[0]);
        setPendingFile(file);
        setIsLoading(false);
        return;
      }

      const { headers, rows } = await parseExcelFile(file, targetSheet);

      const fileConfig: FileConfig = {
        id: slotId,
        filename: file.name,
        year: defaultYear,
        role: defaultRole,
        columnMapping: { farmerId: '', parcelId: '', address: '' },
        sheetName: targetSheet,
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

      setSheets([]);
      setPendingFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '파일 파싱 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, [slotId, defaultYear, defaultRole, files, addFile, updateFile]);

  const handleSheetChange = useCallback(async (sheet: string) => {
    setSelectedSheet(sheet);
    if (pendingFile) {
      await processFile(pendingFile, sheet);
    }
  }, [pendingFile, processFile]);

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
    if (file) await processFile(file);
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await processFile(file);
    e.target.value = '';
  };

  const handleRemove = () => {
    removeFile(slotId);
    setSheets([]);
    setPendingFile(null);
    setError(null);
  };

  if (uploadedFile) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-gray-700">
          {label}
          {required && <span className="ml-1 text-red-500">*</span>}
        </p>
        <FileCard fileConfig={uploadedFile} onRemove={handleRemove} />
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
          px-4 py-8 cursor-pointer transition-colors
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
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
          selected={selectedSheet}
          onChange={handleSheetChange}
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
