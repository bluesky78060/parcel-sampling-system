import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './components/Layout/AppLayout';
import { ErrorBoundary } from './components/Layout/ErrorBoundary';
import { UploadPage } from './pages/UploadPage';
import { MappingPage } from './pages/MappingPage';
import { AnalyzePage } from './pages/AnalyzePage';
import { ExtractPage } from './pages/ExtractPage';
import { ReviewPage } from './pages/ReviewPage';
import { ExportPage } from './pages/ExportPage';

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AppLayout>
          <Routes>
            <Route path="/" element={<Navigate to="/upload" replace />} />
            <Route path="/upload" element={<UploadPage />} />
            <Route path="/mapping" element={<MappingPage />} />
            <Route path="/analyze" element={<AnalyzePage />} />
            <Route path="/extract" element={<ExtractPage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/export" element={<ExportPage />} />
          </Routes>
        </AppLayout>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
