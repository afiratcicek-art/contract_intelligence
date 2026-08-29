import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../services/api";
import { useLanguage } from "../context/LanguageContext";
import AppChrome, { ChromeCrumb, ChromeSep } from "../components/AppChrome";

export default function DocumentView() {
  const { projectId, docId } = useParams<{ projectId: string; docId: string }>();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [error, setError] = useState<"403" | "404" | "other" | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId || !docId) {
      setError("other");
      setLoading(false);
      return;
    }
    let cancelled = false;
    api
      .get<{ signed_url: string }>(
        `/projects/${projectId}/documents/${docId}/signed-url?expires_in=300`,
      )
      .then((res) => {
        if (cancelled) return;
        setSignedUrl(res.signed_url);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 403) setError("403");
        else if (err instanceof ApiError && err.status === 404) setError("404");
        else setError("other");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, docId]);

  const trail = (
    <>
      <ChromeCrumb onClick={() => navigate("/dashboard")}>{t("nav.projects")}</ChromeCrumb>
      <ChromeSep />
      <ChromeCrumb onClick={() => projectId && navigate(`/projects/${projectId}`)}>
        {t("nav.overview")}
      </ChromeCrumb>
      <ChromeSep />
      <ChromeCrumb
        onClick={() => projectId && navigate(`/projects/${projectId}/workspace?module=documents`)}
      >
        {t("module.documents")}
      </ChromeCrumb>
    </>
  );

  const message =
    loading
      ? t("state.loading")
      : error === "403"
        ? t("document.forbidden")
        : error === "404"
          ? t("document.missing")
          : error || !signedUrl
            ? t("document.openfailed")
            : null;

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "var(--color-bg-primary)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <AppChrome density="compact" signOut trail={trail} />
      {message ? (
        <p
          style={{
            fontSize: 13,
            fontFamily: "var(--font-ui)",
            padding: 24,
            color: "var(--color-text-secondary)",
          }}
        >
          {message}
        </p>
      ) : (
        <iframe
          src={signedUrl!}
          title="document"
          style={{
            flex: 1,
            width: "100%",
            minHeight: 0,
            border: "none",
            backgroundColor: "var(--color-bg-primary)",
          }}
        />
      )}
    </div>
  );
}
