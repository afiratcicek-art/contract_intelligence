import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { isAuthenticated, verifySession, clearAuth, loginRedirectUrl } from "./store/auth";
import { useLanguage } from "./context/LanguageContext";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import NewProject from "./pages/NewProject";
import ProjectDetail from "./pages/ProjectDetail";
import ErrorBoundary from "./components/ErrorBoundary";
import Workspace from "./pages/Workspace";
import NewCorrespondence from "./pages/NewCorrespondence";
import CorrespondenceDetail from "./pages/CorrespondenceDetail";
import RFIDetail from "./pages/RFIDetail";
import ChangeDetail from "./pages/ChangeDetail";
import NewChange from "./pages/NewChange";
import NewRFI from "./pages/NewRFI";
import NewDeliverable from "./pages/NewDeliverable";
import DeliverableDetail from "./pages/DeliverableDetail";
import DocumentView from "./pages/DocumentView";
import AuthoringDraftPage from "./pages/AuthoringDraftPage";
import NewDispute from "./pages/NewDispute";
import DisputeDetail from "./pages/DisputeDetail";

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<"checking" | "ok" | "denied">(
    () => isAuthenticated() ? "checking" : "denied"
  );

  useEffect(() => {
    if (status !== "checking") return;
    verifySession().then((valid) => {
      if (valid) {
        setStatus("ok");
      } else {
        clearAuth();
        setStatus("denied");
      }
    });
  }, []);

  if (status === "checking") {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: "var(--color-bg-primary)" }}
      >
        <p
          style={{
            fontSize: 13,
            fontFamily: "var(--font-ui)",
            color: "var(--color-text-secondary)",
          }}
        >
          {t("state.loading")}
        </p>
      </div>
    );
  }
  if (status === "denied") return <Navigate to={loginRedirectUrl()} replace />;
  return <>{children}</>;
}

export default function Router() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/dashboard"
          element={
            <ErrorBoundary>
              <PrivateRoute>
                <Dashboard />
              </PrivateRoute>
            </ErrorBoundary>
          }
        />
        <Route
          path="/projects/new"
          element={
            <ErrorBoundary>
              <PrivateRoute>
                <NewProject />
              </PrivateRoute>
            </ErrorBoundary>
          }
        />
        <Route
          path="/projects/:projectId"
          element={
            <ErrorBoundary>
              <PrivateRoute>
                <ProjectDetail />
              </PrivateRoute>
            </ErrorBoundary>
          }
        />
        <Route
          path="/projects/:projectId/workspace"
          element={
            <ErrorBoundary>
              <PrivateRoute>
                <Workspace />
              </PrivateRoute>
            </ErrorBoundary>
          }
        />
        <Route
          path="/projects/:projectId/workspace/correspondence/new"
          element={
            <ErrorBoundary>
              <PrivateRoute>
                <NewCorrespondence />
              </PrivateRoute>
            </ErrorBoundary>
          }
        />
        <Route
          path="/projects/:projectId/workspace/correspondence/:corrId"
          element={
            <ErrorBoundary>
              <PrivateRoute>
                <CorrespondenceDetail />
              </PrivateRoute>
            </ErrorBoundary>
          }
        />
        <Route
          path="/projects/:projectId/workspace/rfis/new"
          element={
            <ErrorBoundary>
              <PrivateRoute>
                <NewRFI />
              </PrivateRoute>
            </ErrorBoundary>
          }
        />
        <Route
          path="/projects/:projectId/workspace/rfis/:rfiId"
          element={
            <ErrorBoundary>
              <PrivateRoute>
                <RFIDetail />
              </PrivateRoute>
            </ErrorBoundary>
          }
        />
        <Route
          path="/projects/:projectId/workspace/changes/new"
          element={
            <ErrorBoundary>
              <PrivateRoute>
                <NewChange />
              </PrivateRoute>
            </ErrorBoundary>
          }
        />
        <Route
          path="/projects/:projectId/workspace/changes/:changeId"
          element={
            <ErrorBoundary>
              <PrivateRoute>
                <ChangeDetail />
              </PrivateRoute>
            </ErrorBoundary>
          }
        />
        <Route
          path="/projects/:projectId/workspace/deliverables/new"
          element={
            <ErrorBoundary>
              <PrivateRoute>
                <NewDeliverable />
              </PrivateRoute>
            </ErrorBoundary>
          }
        />
        <Route
          path="/projects/:projectId/workspace/deliverables/:deliverableId"
          element={
            <ErrorBoundary>
              <PrivateRoute>
                <DeliverableDetail />
              </PrivateRoute>
            </ErrorBoundary>
          }
        />
        <Route
          path="/projects/:projectId/workspace/disputes/new"
          element={
            <ErrorBoundary>
              <PrivateRoute>
                <NewDispute />
              </PrivateRoute>
            </ErrorBoundary>
          }
        />
        <Route
          path="/projects/:projectId/workspace/disputes/:disputeId"
          element={
            <ErrorBoundary>
              <PrivateRoute>
                <DisputeDetail />
              </PrivateRoute>
            </ErrorBoundary>
          }
        />
        <Route
          path="/projects/:projectId/workspace/authoring/new"
          element={
            <ErrorBoundary>
              <PrivateRoute>
                <AuthoringDraftPage />
              </PrivateRoute>
            </ErrorBoundary>
          }
        />
        <Route
          path="/projects/:projectId/workspace/authoring/:draftId"
          element={
            <ErrorBoundary>
              <PrivateRoute>
                <AuthoringDraftPage />
              </PrivateRoute>
            </ErrorBoundary>
          }
        />
        <Route
          path="/projects/:projectId/view/:docId"
          element={
            <ErrorBoundary>
              <PrivateRoute>
                <DocumentView />
              </PrivateRoute>
            </ErrorBoundary>
          }
        />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
