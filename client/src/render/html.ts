/* Escaping helpers, verbatim from the template. */
export function esc(v: unknown): string {
  return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;");
}
export function escA(v: unknown): string {
  return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
