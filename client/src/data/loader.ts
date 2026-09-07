/* The data loader — replaces the template's injection block.
   Two modes:
     api      — GET `${VITE_API_BASE}/api/v1/registry`; TODAY from the device clock in Europe/Sofia.
     fixture  — GET /fixture.json (same envelope shape); TODAY frozen from the file, so relative dates
                and the queue order are reproducible.
   Chosen by `?src=api` / `?src=fixture`; otherwise api when the hostname isn't localhost or
   VITE_API_BASE is set, else fixture. */
import type { ApiTask, DoneRow, Injection, RegistryEnvelope, Row } from "./types";

export type Mode = "api" | "fixture";

export function apiBase(): string {
  const b = (import.meta.env.VITE_API_BASE as string | undefined) || "";
  return b.replace(/\/+$/, "");
}

export function pickMode(loc: { search: string; hostname: string } = window.location): Mode {
  const src = new URLSearchParams(loc.search).get("src");
  if (src === "api" || src === "fixture") return src;
  if (loc.hostname !== "localhost" || apiBase()) return "api";
  return "fixture";
}

/** Today's ISO date in Europe/Sofia, from the device clock. */
export function todaySofia(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Sofia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Short label for what a Blocked row waits on: the text after "waiting on" / "blocked on" in the notes. */
export function extractBlocker(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const m = /\b(?:waiting on|blocked on)\s+(.+)/i.exec(notes);
  if (!m) return null;
  const label = m[1].split(/[.;\n]|\s[-–—]\s|\s\(/)[0].trim().replace(/[,:]$/, "");
  return label ? label.slice(0, 60) : null;
}

export function depthOf(id: string): number {
  return (id.match(/\./g) || []).length;
}

export function toRow(t: ApiTask): Row {
  const blk = t.status === "Blocked" ? t.blocker || extractBlocker(t.notes) : null;
  return {
    id: t.id,
    task: t.task,
    cat: t.category,
    u: t.u,
    i: t.i,
    st: t.status as Row["st"],
    rec: t.recorded,
    tri: t.triaged || "",
    dl: t.deadline || "",
    ty: t.deadline ? t.deadline_type || "" : "",
    kind: t.deadline ? t.deadline_kind || "" : "",
    d: depthOf(t.id),
    note: t.notes || "",
    blk: blk,
  };
}

export function toDone(t: ApiTask): DoneRow {
  return { id: t.id, task: t.task, cat: t.category, done: t.done || t.updated_at.slice(0, 10) };
}

/** NEXTNUM — the first ID number after the reserved block. */
export function nextNumAfter(reserved: string[], nextFree?: string): number {
  const last = reserved[reserved.length - 1] || nextFree;
  if (!last) return 0;
  const n = parseInt(last.replace(/^T-/, ""), 10);
  return isNaN(n) ? 0 : n + 1;
}

export function fromEnvelope(env: RegistryEnvelope, today: string): Injection {
  const ROWS = env.rows.filter((t) => t.status !== "Done" && t.status !== "Dropped").map(toRow);
  const DONE = env.rows.filter((t) => t.status === "Done").map(toDone);
  return {
    STAMP: env.stamp,
    TODAY: today,
    RESERVED: (env.reserved || []).slice(),
    NEXTNUM: nextNumAfter(env.reserved || [], env.next_free_id),
    ROWS,
    DONE,
  };
}

export async function loadRegistry(mode: Mode = pickMode()): Promise<Injection> {
  if (mode === "api") {
    const res = await fetch(apiBase() + "/api/v1/registry", { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("GET /api/v1/registry → HTTP " + res.status);
    const env = (await res.json()) as RegistryEnvelope;
    return fromEnvelope(env, todaySofia());
  }
  const res = await fetch(import.meta.env.BASE_URL + "fixture.json", { cache: "no-store" });
  if (!res.ok) throw new Error("GET fixture.json → HTTP " + res.status);
  const env = (await res.json()) as RegistryEnvelope;
  return fromEnvelope(env, env.today);
}
