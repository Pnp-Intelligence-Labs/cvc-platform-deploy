import { createBrowserRouter, Navigate, useRouteError } from "react-router";
import AuthGuard from "./components/AuthGuard";
import LoginPage from "./pages/LoginPage";
import Homepage from "./pages/Homepage";
import Ventures from "./pages/Ventures";
import CompanyProfile from "./pages/CompanyProfile";
import SourcingView from "./pages/SourcingView";
import PartnerTerminal from "./pages/PartnerTerminal";
import PartnerManagement from "./pages/PartnerManagement";
import Admin from "./pages/Admin";
import RequestsPage from "./pages/Requests";
import SalesPage from "./pages/Sales";
import DataExplorerPage from "./pages/DataExplorerPage";
import ReportsPage from "./pages/ReportsPage";
import DriveIngestPage from "./pages/DriveIngestPage";
import TerminalPage from "./pages/TerminalPage";
import OIDCCallback from "./pages/OIDCCallback";

function Guard({ component: Component }: { component: React.ComponentType }) {
  return <AuthGuard><Component /></AuthGuard>;
}

function AppError() {
  const error = useRouteError() as { status?: number; statusText?: string; message?: string };
  const is404 = error?.status === 404;
  return (
    <div className="min-h-screen bg-[#FAF9F6] flex items-center justify-center">
      <div className="text-center max-w-sm">
        <p className="text-5xl font-extrabold text-slate-200 mb-4">{error?.status ?? '!'}</p>
        <p className="text-lg font-bold text-slate-700 mb-2">
          {is404 ? 'Page not found' : 'Something went wrong'}
        </p>
        <p className="text-sm text-slate-500 mb-6">
          {is404
            ? "This route doesn't exist. If you clicked an external link, open it directly in your browser."
            : error?.message ?? error?.statusText ?? 'An unexpected error occurred.'}
        </p>
        <a href="/app/" className="text-sm font-semibold text-[#1E293B] underline">
          Back to dashboard
        </a>
      </div>
    </div>
  );
}

export const router = createBrowserRouter([
  // Public
  { path: "/login", Component: LoginPage },
  { path: "/auth/callback", Component: OIDCCallback },

  // Core pages
  { path: "/",                        Component: () => <Guard component={Homepage} />,         errorElement: <AppError /> },
  { path: "/ventures",                Component: () => <Guard component={Ventures} />,         errorElement: <AppError /> },
  { path: "/companies/:id",           Component: () => <Guard component={CompanyProfile} />,   errorElement: <AppError /> },
  { path: "/company/:id",             Component: () => <Guard component={CompanyProfile} />,   errorElement: <AppError /> },
  { path: "/sourcing",                Component: () => <Guard component={SourcingView} />,     errorElement: <AppError /> },
  { path: "/partners",                Component: () => <Guard component={PartnerManagement} />, errorElement: <AppError /> },
  { path: "/partners/:id/terminal",   Component: () => <Guard component={PartnerTerminal} />,  errorElement: <AppError /> },
  { path: "/sales",                   Component: () => <Guard component={SalesPage} />,        errorElement: <AppError /> },
  { path: "/requests",                Component: () => <Guard component={RequestsPage} />,     errorElement: <AppError /> },
  { path: "/admin",                   Component: () => <Guard component={Admin} />,            errorElement: <AppError /> },
  { path: "/ingest",                  Component: () => <Guard component={DriveIngestPage} />,   errorElement: <AppError /> },
  { path: "/terminal",                Component: () => <Guard component={TerminalPage} />,      errorElement: <AppError /> },

  // Plugin pages — only reachable when the corresponding plugin is installed
  { path: "/explore",                 Component: () => <Guard component={DataExplorerPage} />, errorElement: <AppError /> },
  { path: "/reports",                 Component: () => <Guard component={ReportsPage} />,       errorElement: <AppError /> },

  // Redirects for removed/plugin routes
  { path: "/portfolio",               Component: () => <Navigate to="/ventures" replace /> },
  { path: "/companies",               Component: () => <Navigate to="/ventures" replace /> },
  { path: "/lp-portal",               Component: () => <Navigate to="/" replace /> },
  { path: "/sectors",                 Component: () => <Navigate to="/ventures" replace /> },
  { path: "/sectors/:sector",         Component: () => <Navigate to="/ventures" replace /> },
  { path: "/trends",                  Component: () => <Navigate to="/" replace /> },
  { path: "/tasks",                   Component: () => <Navigate to="/" replace /> },
  { path: "/brambles",                Component: () => <Navigate to="/" replace /> },
  { path: "/brambles/review/:id",     Component: () => <Navigate to="/" replace /> },
  { path: "/ventures/evaluation",     Component: () => <Navigate to="/ventures" replace /> },
  { path: "/partners/list",           Component: () => <Navigate to="/partners" replace /> },
  { path: "/partners/admin",          Component: () => <Navigate to="/admin" replace /> },
], { basename: '/app' });
