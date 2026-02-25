import { HashRouter, Routes, Route } from 'react-router-dom';
import { AppLayout } from './components/Layout/AppLayout';
import { ErrorBoundary } from './components/Layout/ErrorBoundary';
import { HomePage } from './pages/HomePage';
import { UploadPage } from './pages/UploadPage';
import { MappingPage } from './pages/MappingPage';
import { AnalyzePage } from './pages/AnalyzePage';
import { ExtractPage } from './pages/ExtractPage';
import { ReviewPage } from './pages/ReviewPage';
import { ExportPage } from './pages/ExportPage';
import { PnuGeneratorPage } from './pages/PnuGeneratorPage';
import { AddressMergerPage } from './pages/AddressMergerPage';

function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <Routes>
          {/* 홈 / 독립 도구 — AppLayout 없이 독립 렌더 */}
          <Route path="/" element={<HomePage />} />
          <Route path="/pnu-generator" element={<PnuGeneratorPage />} />
          <Route path="/address-merger" element={<AddressMergerPage />} />

          {/* 워크플로 페이지 — AppLayout (Stepper 포함) */}
          <Route
            path="/*"
            element={
              <AppLayout>
                <Routes>
                  <Route path="/upload" element={<UploadPage />} />
                  <Route path="/mapping" element={<MappingPage />} />
                  <Route path="/analyze" element={<AnalyzePage />} />
                  <Route path="/extract" element={<ExtractPage />} />
                  <Route path="/review" element={<ReviewPage />} />
                  <Route path="/export" element={<ExportPage />} />
                </Routes>
              </AppLayout>
            }
          />
        </Routes>
      </HashRouter>
    </ErrorBoundary>
  );
}

export default App;
