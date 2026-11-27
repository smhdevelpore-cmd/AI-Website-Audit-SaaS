/**
 * Routes (Design.md §3).
 *
 * Public: the marketing page and the four auth screens. Authenticated: everything inside
 * `AppShell`, behind `ProtectedRoute`. The component gallery is a development-only route and is
 * not part of a production build.
 */
import { Suspense, lazy } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { AuthProvider } from "./auth/AuthProvider.js";
import { ProtectedRoute } from "./auth/ProtectedRoute.js";
import { AppShell } from "./components/AppShell.js";
import { ToastProvider } from "./components/ui/Toast.js";
import { Landing } from "./pages/Landing.js";
import { AuditDetail } from "./pages/app/AuditDetail.js";
import { Audits } from "./pages/app/Audits.js";
import { Dashboard } from "./pages/app/Dashboard.js";
import { NotFound } from "./pages/app/NotFound.js";
import { Settings } from "./pages/app/Settings.js";
import { ForgotPassword } from "./pages/auth/ForgotPassword.js";
import { Login } from "./pages/auth/Login.js";
import { Register } from "./pages/auth/Register.js";
import { ResetPassword } from "./pages/auth/ResetPassword.js";

// Split out and only referenced in a dev build, so it never reaches a production bundle.
const UiGallery = import.meta.env.DEV
  ? lazy(() => import("./pages/dev/UiGallery.js").then((m) => ({ default: m.UiGallery })))
  : null;

export function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />

            <Route
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/audits" element={<Audits />} />
              <Route path="/audits/:auditId" element={<AuditDetail />} />
              <Route path="/settings" element={<Settings />} />
            </Route>

            {UiGallery === null ? null : (
              <Route
                path="/dev/ui"
                element={
                  <Suspense fallback={<p className="p-6 text-sm text-muted">Loading gallery…</p>}>
                    <UiGallery />
                  </Suspense>
                }
              />
            )}

            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
