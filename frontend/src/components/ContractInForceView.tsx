/**
 * ContractInForceView — Contract & Amendments "in-force" fetch sahibi modül.
 *
 * DocumentsModule'ün fetch desenini yansıtır: veri/loading/error state'lerini
 * kendisi tutar, useEffect içinde fetchContractResolution(projectId) çağırır,
 * sunumu salt-sunum <ContractInForcePanel>'e devreder. Cookie-auth `api` ile
 * otomatik.
 *
 * Tek yazma yolu: contract === null iken kök slotuna <ContractSetupForm>
 * mount edilir (HITL sözleşme kaydı, CM-only backend gate). Kayıt başarılı
 * olunca resolution yeniden çekilir — hiyerarşi kökü yerine oturur.
 */
import { useCallback, useEffect, useState } from "react";
import { fetchContractResolution, type ResolutionResponse } from "../services/api";
import { useLanguage } from "../context/LanguageContext";
import ContractInForcePanel from "./ContractInForcePanel";
import ContractSetupForm from "./ContractSetupForm";

interface Props {
  projectId: string;
}

export default function ContractInForceView({ projectId }: Props) {
  const { t } = useLanguage();
  const [data, setData] = useState<ResolutionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback((opts?: { soft?: boolean }) => {
    // soft = belge/ek ekleme sonrası: paneli "Yükleniyor..." ile unmount etme.
    if (!opts?.soft) setLoading(true);
    setError(false);
    fetchContractResolution(projectId)
      .then(setData)
      .catch(() => setError(true))
      .finally(() => {
        if (!opts?.soft) setLoading(false);
      });
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const textSecondary = "var(--color-text-secondary)";

  if (loading) {
    return (
      <p style={{ fontSize: 12, color: textSecondary, fontFamily: "var(--font-ui)" }}>
        {t("inforce.loading")}
      </p>
    );
  }

  if (error || !data) {
    return (
      <p style={{ fontSize: 12, color: "var(--color-alert-red)", fontFamily: "var(--font-ui)" }}>
        {t("inforce.error")}
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {data.contract === null && (
        <ContractSetupForm projectId={projectId} onCreated={() => load()} />
      )}
      <ContractInForcePanel
        resolution={data}
        projectId={projectId}
        onDocumentsChanged={() => load({ soft: true })}
      />
    </div>
  );
}
