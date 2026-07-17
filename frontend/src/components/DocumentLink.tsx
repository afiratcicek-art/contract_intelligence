import type { CSSProperties, ReactNode } from "react";

interface DocumentLinkProps {
  projectId: string;
  docId: string;
  children: ReactNode;
  style?: CSSProperties;
  title?: string;
}

export default function DocumentLink({
  projectId,
  docId,
  children,
  style,
  title,
}: DocumentLinkProps) {
  return (
    <a
      href={`/projects/${projectId}/view/${docId}`}
      target="_blank"
      rel="noopener"
      style={style}
      title={title}
    >
      {children}
    </a>
  );
}
