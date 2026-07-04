import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { DataStatePanel } from './components/DataStatePanel';
import { AdminShell, VendorShell } from './components/AppShell';
import { SectionSkeleton } from './components/OperationalPrimitives';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { RequirePermission } from './components/RequirePermission';
import { RedirectIfAuthed } from './lib/RedirectIfAuthed';
import { RequireAuth } from './lib/RequireAuth';
import { ErrorBoundary } from './components/ErrorBoundary';
import { runtimeConfig } from './config/runtime';

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
const AdminSupportAnalyticsPage = lazy(() =>
  import('./pages/AdminSupportAnalyticsPage').then((module) => ({ default: module.AdminSupportAnalyticsPage })),
);
const AdminProviderManagementPage = lazy(() =>
  import('./pages/AdminProviderManagementPage').then((module) => ({ default: module.AdminProviderManagementPage })),
);
const AdminVendorsPage = lazy(() =>
  import('./pages/AdminVendorsPage').then((module) => ({ default: module.AdminVendorsPage })),
);
const AdminSettlementApprovalsPage = lazy(() =>
  import('./pages/AdminSettlementApprovalsPage').then((module) => ({ default: module.AdminSettlementApprovalsPage })),
);
const AdminScheduledSettlementsPage = lazy(() =>
  import('./pages/AdminScheduledSettlementsPage').then((module) => ({ default: module.AdminScheduledSettlementsPage })),
);
const AdminRefundAdjustmentsPage = lazy(() =>
  import('./pages/AdminRefundAdjustmentsPage').then((module) => ({ default: module.AdminRefundAdjustmentsPage })),
);
const AdminPaymentPreparationPage = lazy(() =>
  import('./pages/AdminPaymentPreparationPage').then((module) => ({ default: module.AdminPaymentPreparationPage })),
);
const VendorSupportTicketsPage = lazy(() =>
  import('./pages/VendorSupportTicketsPage').then((module) => ({ default: module.VendorSupportTicketsPage })),
);
const VendorInboxPage = lazy(() =>
  import('./pages/VendorInboxPage').then((module) => ({ default: module.VendorInboxPage })),
);
const SupportTicketDetailPage = lazy(() =>
  import('./pages/SupportTicketDetailPage').then((module) => ({ default: module.SupportTicketDetailPage })),
);
const ReturnsPage = lazy(() => import('./pages/ReturnsPage').then((module) => ({ default: module.ReturnsPage })));
const ReturnDetailPage = lazy(() =>
  import('./pages/ReturnDetailPage').then((module) => ({ default: module.ReturnDetailPage })),
);
const FinancePage = lazy(() => import('./pages/FinancePage').then((module) => ({ default: module.FinancePage })));
const AutomationPage = lazy(() =>
  import('./pages/AutomationPage').then((module) => ({ default: module.AutomationPage })),
);
const VendorProfilePage = lazy(() =>
  import('./pages/VendorProfilePage').then((module) => ({ default: module.VendorProfilePage })),
);

const loadingFallback = (
  <section className="op-page route-loading-frame">
    <div className="op-page-heading">
      <div>
        <p className="eyebrow">Dashboard</p>
        <h2>Loading workspace</h2>
      </div>
    </div>
    <SectionSkeleton title="Preparing section" description="The page frame is ready while this route loads." />
  </section>
);

function resilientRoute(routeName: string, node: ReactNode) {
  return (
    <ErrorBoundary routeName={routeName} eyebrow={routeName} title="This section could not load">
      <Suspense fallback={loadingFallback}>{node}</Suspense>
    </ErrorBoundary>
  );
}

export default function App() {
  const startupIssues = runtimeConfig.startupIssues ?? [];

  if (startupIssues.length > 0) {
    return (
      <DataStatePanel
        tone="error"
        eyebrow="Startup configuration"
        title="Runtime configuration needs attention"
        description={startupIssues.join(' ')}
      />
    );
  }

  return (
    <Routes>
      <Route element={<RedirectIfAuthed />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>
      <Route element={<RequireAuth />}>
        <Route
          element={
            <ErrorBoundary>
              <VendorShell />
            </ErrorBoundary>
          }
        >
          <Route path="/" element={resilientRoute('Dashboard', <DashboardPage />)} />
          <Route
            path="/orders"
            element={
              <RequirePermission permission="orders:read">
                {resilientRoute('Orders', <OrdersPage />)}
              </RequirePermission>
            }
          />
          <Route
            path="/orders/:orderId"
            element={
              <RequirePermission permission="orders:read">
                {resilientRoute('Order detail', <OrderDetailPage />)}
              </RequirePermission>
            }
          />
          <Route
            path="/returns"
            element={
              <RequirePermission permission="returns:read">
                {resilientRoute('Returns', <ReturnsPage />)}
              </RequirePermission>
            }
          />
          <Route
            path="/returns/:returnId"
            element={
              <RequirePermission permission="returns:read">
                {resilientRoute('Return detail', <ReturnDetailPage />)}
              </RequirePermission>
            }
          />
          <Route
            path="/finance"
            element={
              <RequirePermission permission="finance:read">
                {resilientRoute('Finance', <FinancePage />)}
              </RequirePermission>
            }
          />
          <Route
            path="/automation"
            element={
              <RequirePermission permission="automation:read">
                {resilientRoute('Automation', <AutomationPage />)}
              </RequirePermission>
            }
          />
          <Route
            path="/vendor/profile"
            element={
              <RequirePermission permission="orders:read">
                {resilientRoute('Vendor profile', <VendorProfilePage />)}
              </RequirePermission>
            }
          />
          <Route
            path="/support/inbox"
            element={
              <RequirePermission permission="orders:read">
                {resilientRoute('Inbox', <VendorInboxPage />)}
              </RequirePermission>
            }
          />
          <Route
            path="/support"
            element={
              <RequirePermission permission="orders:read">
                {resilientRoute('Support', <VendorSupportTicketsPage />)}
              </RequirePermission>
            }
          />
          <Route
            path="/support/:ticketId"
            element={
              <RequirePermission permission="orders:read">
                {resilientRoute('Support ticket', <SupportTicketDetailPage />)}
              </RequirePermission>
            }
          />
        </Route>
        <Route
          element={
            <ErrorBoundary>
              <AdminShell />
            </ErrorBoundary>
          }
        >
          <Route
            path="/admin/operations"
            element={
              <RequirePermission permission="orders:write">
                {resilientRoute('Operations', <AdminOperationsQueuePage />)}
              </RequirePermission>
            }
          />
          <Route
            path="/admin/diagnostics"
            element={
              <RequirePermission permission="orders:write">
                {resilientRoute('Diagnostics', <AdminDiagnosticsPage />)}
              </RequirePermission>
            }
          />
          <Route
            path="/admin/support"
            element={
              <RequirePermission permission="orders:write">
                {resilientRoute('Admin support', <AdminSupportTicketsPage />)}
              </RequirePermission>
            }
          />
          <Route
            path="/admin/support/analytics"
            element={
              <RequirePermission permission="orders:write">
                {resilientRoute('Support analytics', <AdminSupportAnalyticsPage />)}
              </RequirePermission>
            }
          />
          <Route
            path="/admin/support/:ticketId"
            element={
              <RequirePermission permission="orders:write">
                {resilientRoute('Support ticket', <SupportTicketDetailPage />)}
              </RequirePermission>
            }
          />
          <Route
            path="/admin/orders/:shopifyOrderId"
            element={
              <RequirePermission permission="orders:write">
                {resilientRoute('Shopify order', <AdminShopifyOrderPage />)}
              </RequirePermission>
            }
          />
          <Route
            path="/admin/providers"
            element={
              <RequirePermission permission="orders:write">
                {resilientRoute('Provider management', <AdminProviderManagementPage />)}
              </RequirePermission>
            }
          />
          <Route
            path="/admin/vendors/new"
            element={
              <RequirePermission permission="orders:write">
                {resilientRoute('Create vendor', <AdminVendorsPage />)}
              </RequirePermission>
            }
          />
          <Route
            path="/admin/vendors/:vendorId"
            element={
              <RequirePermission permission="orders:write">
                {resilientRoute('Vendor profile', <VendorProfilePage />)}
              </RequirePermission>
            }
          />
          <Route
            path="/admin/finance/settlement-approvals"
            element={
              <RequirePermission permission="orders:write">
                {resilientRoute('Settlement approvals', <AdminSettlementApprovalsPage />)}
              </RequirePermission>
            }
          />
          <Route
            path="/admin/finance/settlement-schedules"
            element={
              <RequirePermission permission="orders:write">
                {resilientRoute('Scheduled settlements', <AdminScheduledSettlementsPage />)}
              </RequirePermission>
            }
          />
          <Route
            path="/admin/finance/refund-adjustments"
            element={
              <RequirePermission permission="orders:write">
                {resilientRoute('Refund adjustments', <AdminRefundAdjustmentsPage />)}
              </RequirePermission>
            }
          />
          <Route
            path="/admin/finance/payment-preparation"
            element={
              <RequirePermission permission="orders:write">
                {resilientRoute('Payment preparation', <AdminPaymentPreparationPage />)}
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
