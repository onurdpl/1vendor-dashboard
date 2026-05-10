import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { AutomationPage } from './pages/AutomationPage';
import { DashboardPage } from './pages/DashboardPage';
import { FinancePage } from './pages/FinancePage';
import { LoginPage } from './pages/LoginPage';
import { OrderDetailPage } from './pages/OrderDetailPage';
import { OrdersPage } from './pages/OrdersPage';
import { ReturnDetailPage } from './pages/ReturnDetailPage';
import { ReturnsPage } from './pages/ReturnsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { RedirectIfAuthed } from './lib/RedirectIfAuthed';
import { RequireAuth } from './lib/RequireAuth';

export default function App() {
  return (
    <Routes>
      <Route element={<RedirectIfAuthed />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/orders/:orderId" element={<OrderDetailPage />} />
          <Route path="/returns" element={<ReturnsPage />} />
          <Route path="/returns/:returnId" element={<ReturnDetailPage />} />
          <Route path="/finance" element={<FinancePage />} />
          <Route path="/automation" element={<AutomationPage />} />
        </Route>
      </Route>
      <Route path="/home" element={<Navigate to="/" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
