export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function formatSize(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function statusColorClass(status: number | null, ok: boolean): string {
  if (status === null) return "text-red-600 dark:text-red-400";
  if (status >= 200 && status < 300) return "text-method-get";
  if (status >= 300 && status < 400) return "text-method-put";
  if (status >= 400 && status < 500) return "text-method-post";
  if (status >= 500) return "text-method-delete";
  return ok ? "text-method-get" : "text-method-post";
}
