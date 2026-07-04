export function entityPath(
  projectId: string,
  entityType: "correspondence" | "rfi" | string,
  id: string
): string {
  if (entityType === "correspondence")
    return `/projects/${projectId}/workspace/correspondence/${id}`;
  if (entityType === "rfi")
    return `/projects/${projectId}/workspace/rfis/${id}`;
  return `/projects/${projectId}/workspace`;
}
