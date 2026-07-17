import type { CSSProperties, ReactNode } from "react";
import type { RefItem } from "../constants/documentTypes";
import DocumentLink from "./DocumentLink";
import { entityPath } from "../utils/entityPath";
import { useLanguage } from "../context/LanguageContext";

interface ReferenceLinkProps {
  projectId: string;
  item: RefItem;
  children: ReactNode;
  style?: CSSProperties;
}

export default function ReferenceLink({
  projectId,
  item,
  children,
  style,
}: ReferenceLinkProps) {
  const { lang } = useLanguage();

  if (item.document_id) {
    return (
      <DocumentLink
        projectId={projectId}
        docId={item.document_id}
        style={style}
        title={lang === "tr" ? "Belgeyi aç" : "Open document"}
      >
        {children}
      </DocumentLink>
    );
  }

  let href: string | null = null;
  let title: string | undefined;
  if (item.ref_corr_id) {
    href = entityPath(projectId, "correspondence", item.ref_corr_id);
    title = lang === "tr" ? "Yazışmayı aç" : "Open correspondence";
  } else if (item.rfi_id) {
    href = entityPath(projectId, "rfi", item.rfi_id);
    title = lang === "tr" ? "RFI'yı aç" : "Open RFI";
  } else if (item.change_id) {
    href = entityPath(projectId, "change", item.change_id);
    title = lang === "tr" ? "Değişikliği aç" : "Open change";
  }

  if (!href) return <>{children}</>;

  return (
    <a href={href} target="_blank" rel="noopener" style={style} title={title}>
      {children}
    </a>
  );
}
