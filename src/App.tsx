import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { DataStatePanel } from './components/DataStatePanel';
import { AppShell } from './components/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { RequirePermission } from './components/RequirePermission';
import { RedirectIfAuthed } from './lib/RedirectIfAuthed';
import { RequireAuth } from './lib/RequireAuth';
import { ErrorBoundary } from './components/ErrorBoundary';

const OrdersPage = lazy(() => import('./pages/OrdersPage').then((module) => ({ default: module.OrdersPage })));
const OrderDetailPage = lazy(() =>
  import('./pages/OrderDetailPage').then((module) => ({ default: module.OrderDetailPage })),
);
const AdminShopifyOrderPage = lazy(() =>
  import('./pages/AdminShopifyOrderPage').then((module) => ({ default: module.AdminShopifyOrderPage })),
);
const AdminOperationsQueuePage = lazy(() =>
  import('./pages/AdminOperationsQueuePage').then((module) => ({ default: module.AdminOperationsQueuePage })),
);
const AdminDiagnosticsPage = lazy(() =>
  import('./pages/AdminDiagnosticsPage').then((module) => ({ default: module.AdminDiagnosticsPage })),
);
const AdminSupportTicketsPage = lazy(() =>
  import('./pages/AdminSupportTicketsPage').then((module) => ({ default: module.AdminSupportTicketsPage })),
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
              <RequirePermission permission="orders:read">
                <Suspense fallback={loadingFallback}>
                  <OrdersPage />
                </Suspense>
              </RequirePermission>
            }
          />
          <Route
            path="/orders/:orderId"
            element={
              <RequirePermission permission="orders:read">
                <Suspense fallback={loadingFallback}>
                  <OrderDetailPage />
                </Suspense>
              </RequirePermission>
            }
          />
          <Route
            path="/admin/operations"
            element={
              <RequirePermission permission="orders:write">
                <Suspense fallback={loadingFallback}>
                  <AdminOperationsQueuePage />
                </Suspense>
              </RequirePermission>
            }
          />
          <Route
            path="/admin/diagnostics"
            element={
              <RequirePermission permission="orders:write">
                <Suspense fallback={loadingFallback}>
                  <AdminDiagnosticsPage />
                </Suspense>
              </RequirePermission>
            }
          />
          <Route
            path="/admin/support"
            element={
              <RequirePermission permission="orders:write">
                <Suspense fallback={loadingFallback}>
                  <AdminSupportTicketsPage />
                </Suspense>
              </RequirePermission>
            }
          />
          <Route
            path="/admin/orders/:shopifyOrderId"
            element={
              <RequirePermission permission="orders:write">
                <Suspense fallback={loadingFallback}>
                  <AdminShopifyOrderPage />
                </Suspense>
              </RequirePermission>
            }
          />
          <Route
            path="/returns"
            element={
              <RequirePermission permission="returns:read">
                <Suspense fallback={loadingFallback}>
                  <ReturnsPage />
                </Suspense>
              </RequirePermission>
            }
          />
          <Route
            path="/returns/:returnId"
            element={
              <RequirePermission permission="returns:read">
                <Suspense fallback={loadingFallback}>
                  <ReturnDetailPage />
                </Suspense>
              </RequirePermission>
            }
          />
          <Route
            path="/finance"
            element={
              <RequirePermission permission="finance:read">
                <Suspense fallback={loadingFallback}>
                  <FinancePage />
                </Suspense>
              </RequirePermission>
            }
          />
          <Route
            path="/automation"
            element={
              <RequirePermission permission="automation:read">
                <Suspense fallback={loadingFallback}>
                  <AutomationPage />
                </Suspense>
              </RequirePermission>
            }
          />
        </Route>
      </Route>
      <Route path="/home" element={<Navigate to="/" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
