import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { DataStatePanel } from './components/DataStatePanel';
import { AppShell } from './components/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { RedirectIfAuthed } from './lib/RedirectIfAuthed';
import { RequireAuth } from './lib/RequireAuth';
import { ErrorBoundary } from './components/ErrorBoundary';

const OrdersPage = lazy(() => import('./pages/OrdersPage').then((module) => ({ default: module.OrdersPage })));
const OrderDetailPage = lazy(() =>
  import('./pages/OrderDetailPage').then((module) => ({ default: module.OrderDetailPage })),
);
const ReturnsPage = lazy(() => import('./pages/ReturnsPage').then((module) => ({ default: module.ReturnsPage })));
const ReturnDetailPage = lazy(() =>
  import('./pages/ReturnDetailPage').then((module) => ({ default: module.ReturnDetailPage })),
);
const FinancePage = lazy(() => import('./pages/FinancePage').then((module) => ({ default: module.FinancePage })));
const AutomationPage = lazy(() =>
  import('./pages/AutomationPage').then((module) => ({ default: module.AutomationPage })),
);

const loadingFallback = (
  <DataStatePanel
    tone="loading"
    eyebrow="Dashboard"
    title="Loading workspace"
    description="Preparing the selected dashboard section."
  />
);

export default function App() {
  return (
    <Routes>
      <Route element={<RedirectIfAuthed />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>
      <Route element={<RequireAuth />}>
        <Route
          element={
            <ErrorBoundary>
              <AppShell />
            </ErrorBoundary>
          }
        >
          <Route path="/" element={<DashboardPage />} />
          <Route
            path="/orders"
            element={
              <Suspense fallback={loadingFallback}>
                <OrdersPage />
              </Suspense>
            }
          />
          <Route
            path="/orders/:orderId"
            element={
              <Suspense fallback={loadingFallback}>
                <OrderDetailPage />
              </Suspense>
            }
          />
          <Route
            path="/returns"
            element={
              <Suspense fallback={loadingFallback}>
                <ReturnsPage />
              </Suspense>
            }
          />
          <Route
            path="/returns/:returnId"
            element={
              <Suspense fallback={loadingFallback}>
                <ReturnDetailPage />
              </Suspense>
            }
          />
          <Route
            path="/finance"
            element={
              <Suspense fallback={loadingFallback}>
                <FinancePage />
              </Suspense>
            }
          />
          <Route
            path="/automation"
            element={
              <Suspense fallback={loadingFallback}>
                <AutomationPage />
              </Suspense>
            }
          />
        </Route>
      </Route>
      <Route path="/home" element={<Navigate to="/" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
