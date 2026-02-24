import type { ReactNode } from 'react';
import { Stepper } from './Stepper';

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <h1 className="text-xl font-bold text-gray-900">
          농업환경변동조사 필지 추출 시스템
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          2026년 토양 시료 채취 대상 필지 추출
        </p>
      </header>
      <Stepper />
      <main className="max-w-7xl mx-auto px-6 py-8">
        {children}
      </main>
    </div>
  );
}
