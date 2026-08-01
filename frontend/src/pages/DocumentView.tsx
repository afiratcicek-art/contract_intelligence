import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, ApiError } from "../services/api";
import { useLanguage } from "../context/LanguageContext";

export default function DocumentView() {
  const { projectId, docId } = useParams<{ projectId: string; docId: string }>();
  const { lang } = useLanguage();
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

  if (loading) {
    return (
      <p style={{ fontSize: 13, fontFamily: "var(--font-ui)", padding: 24 }}>
        {lang === "tr" ? "Yükleniyor..." : "Loading..."}
      </p>
    );
  }

  if (error === "403") {
    return (
      <p style={{ fontSize: 13, fontFamily: "var(--font-ui)", padding: 24 }}>
        {lang === "tr"
          ? "Bu belgeye erişim yetkiniz yok"
          : "You do not have access to this document"}
      </p>
    );
  }

  if (error === "404") {
    return (
      <p style={{ fontSize: 13, fontFamily: "var(--font-ui)", padding: 24 }}>
        {lang === "tr" ? "Belge bulunamadı" : "Document not found"}
      </p>
    );
  }

  if (error || !signedUrl) {
    return (
      <p style={{ fontSize: 13, fontFamily: "var(--font-ui)", padding: 24 }}>
        {lang === "tr" ? "Belge açılamadı" : "Could not open document"}
      </p>
    );
  }

  return (
    <iframe
      src={signedUrl}
      title="document"
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        border: "none",
      }}
    />
  );
}
