/**
 * Routes. Four screens are public (sign in, sign up, and the two halves of password recovery);
 * everything else sits behind `ProtectedRoute`.
 */
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AuthProvider } from "./auth/AuthProvider.js";
import { ProtectedRoute } from "./auth/ProtectedRoute.js";
import { Dashboard } from "./pages/Dashboard.js";
import { ForgotPassword } from "./pages/ForgotPassword.js";
import { Login } from "./pages/Login.js";
import { ResetPassword } from "./pages/ResetPassword.js";
import { Signup } from "./pages/Signup.js";

function NotFound() {
  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: "1.25rem" }}>Page not found</h1>
      <p>
        <a href="/dashboard">Go to your account</a>
      </p>
    </main>
  );
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
