import { create } from 'zustand';
import type { FileConfig, ColumnMapping } from '../types';

interface FileStore {
  files: FileConfig[];
  activeFileId: string | null;

  addFile: (file: FileConfig) => void;
  removeFile: (id: string) => void;
  updateFile: (id: string, updates: Partial<FileConfig>) => void;
  setColumnMapping: (id: string, mapping: ColumnMapping) => void;
  setFileStatus: (id: string, status: FileConfig['status']) => void;
  setActiveFile: (id: string | null) => void;
  getFilesByRole: (role: FileConfig['role']) => FileConfig[];
  getFileByYear: (year: FileConfig['year'], role: FileConfig['role']) => FileConfig | undefined;
  getMasterFile: () => FileConfig | undefined;
  reset: () => void;
}

export const useFileStore = create<FileStore>((set, get) => ({
  files: [],
  activeFileId: null,

  addFile: (file) =>
    set((state) => ({ files: [...state.files, file] })),

  removeFile: (id) =>
    set((state) => ({
      files: state.files.filter((f) => f.id !== id),
      activeFileId: state.activeFileId === id ? null : state.activeFileId,
    })),

  updateFile: (id, updates) =>
    set((state) => ({
      files: state.files.map((f) =>
        f.id === id ? { ...f, ...updates } : f
      ),
    })),

  setColumnMapping: (id, mapping) =>
    set((state) => ({
      files: state.files.map((f) =>
        f.id === id ? { ...f, columnMapping: mapping, status: 'mapped' as const } : f
      ),
    })),

  setFileStatus: (id, status) =>
    set((state) => ({
      files: state.files.map((f) =>
        f.id === id ? { ...f, status } : f
      ),
    })),

  setActiveFile: (id) => set({ activeFileId: id }),

  getFilesByRole: (role) => get().files.filter((f) => f.role === role),

  getFileByYear: (year, role) => get().files.find((f) => f.year === year && f.role === role),

  getMasterFile: () => get().files.find((f) => f.role === 'master'),

  reset: () => set({ files: [], activeFileId: null }),
}));
