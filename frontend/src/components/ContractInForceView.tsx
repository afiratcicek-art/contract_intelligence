/**
 * ContractInForceView — Contract & Amendments "in-force" fetch sahibi modül.
 *
 * DocumentsModule'ün fetch desenini yansıtır: veri/loading/error state'lerini
 * kendisi tutar, useEffect içinde fetchContractResolution(projectId) çağırır,
 * sunumu salt-sunum <ContractInForcePanel>'e devreder. Cookie-auth `api` ile
 * otomatik. Salt-okunur: yazma yok, polling yok.
 *
 * NOT: Henüz hiçbir yere mount EDİLMEDİ — yalnızca export edilir.
 */
import { useEffect, useState } from "react";
import { fetchContractResolution, type ResolutionResponse } from "../services/api";
import ContractInForcePanel from "./ContractInForcePanel";

interface Props {
  projectId: string;
}

export default function ContractInForceView({ projectId }: Props) {
  const [data, setData] = useState<ResolutionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);
    fetchContractResolution(projectId)
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [projectId]);

  const textSecondary = "var(--color-text-secondary)";

  if (loading) {
    return (
      <p style={{ fontSize: 12, color: textSecondary, fontFamily: "Inter, sans-serif" }}>
        Yükleniyor...
      </p>
    );
  }

  if (error || !data) {
    return (
      <p style={{ fontSize: 12, color: "var(--color-alert-red)", fontFamily: "Inter, sans-serif" }}>
        Yürürlük bilgisi yüklenemedi.
      </p>
    );
  }

  return <ContractInForcePanel resolution={data} />;
}
