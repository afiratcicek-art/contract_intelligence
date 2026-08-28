export function entityPath(
  projectId: string,
  entityType: "correspondence" | "rfi" | string,
  id: string
): string {
  if (entityType === "correspondence")
    return `/projects/${projectId}/workspace/correspondence/${id}`;
  if (entityType === "rfi")
    return `/projects/${projectId}/workspace/rfis/${id}`;
  if (entityType === "change")
    return `/projects/${projectId}/workspace/changes/${id}`;
  if (entityType === "dispute")
    return `/projects/${projectId}/workspace/disputes/${id}`;
  return `/projects/${projectId}/workspace`;
}
