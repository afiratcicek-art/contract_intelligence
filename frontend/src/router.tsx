import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { isAuthenticated } from "./store/auth";
import Login from "./pages/Login";

function PrivateRoute({ children }: { children: React.ReactNode }) {
  return isAuthenticated() ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function Router() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/dashboard"
          element={
            <PrivateRoute>
              <div
                className="min-h-screen flex items-center justify-center"
                style={{ backgroundColor: "#F5F2ED", color: "#1C1917", fontFamily: "Playfair Display, Georgia, serif" }}
              >
                <p className="text-2xl">Dashboard — yakında</p>
              </div>
            </PrivateRoute>
          }
        />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
