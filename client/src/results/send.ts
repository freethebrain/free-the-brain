/* Send results. The clipboard/export panel is the template's contract and stays unchanged; in api
   mode the same text is first POSTed to the Registry Service as text/plain with the human-judgment
   attestation. A failed send falls back to the clipboard panel with the error shown — the pending
   store is only cleared after the service has confirmed the batch. */
import { apiFetch } from "../data/loader";
import { countJudgments } from "./build";

const $ = (id: string) => document.getElementById(id) as HTMLElement;

export function setCopyState(s: string): void {
  $("copystate").textContent = s;
}

/* The helper line under the panel. The template's "paste this into the chat" instruction is the
   clipboard flow's; once the service has recorded the batch there is nothing left to paste. */
export const NOTE_PASTE = "Paste this into the chat and I'll record it, stamp Triaged on every row named, and write the delta.";
export const NOTE_RECORDED = "Recorded — your judgments are in the registry.";

export function setExportNote(s: string): void {
  $("expnote").textContent = s;
}

export function showExportPanel(txt: string, note: string = NOTE_PASTE): HTMLElement {
  ($("exptext") as HTMLTextAreaElement).value = txt;
  setExportNote(note);
  const exp = $("exp");
  exp.style.display = "block";
  return exp;
}

/** Copy the results text; `prefix` is prepended to the state line (used to carry a failed-send error). */
export function copyText(txt: string, prefix: string = ""): void {
  const ta = $("exptext") as HTMLTextAreaElement;
  ta.removeAttribute("readonly");
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, txt.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch (e) {
    /* execCommand unavailable */
  }
  ta.setAttribute("readonly", "");
  const set = (s: string) => setCopyState(prefix + s);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard
      .writeText(txt)
      .then(() => set("Copied ✓"))
      .catch(() => set(ok ? "Copied ✓" : "Clipboard blocked here — the text is selected: long-press it and choose Copy"));
  } else set(ok ? "Copied ✓" : "Clipboard blocked here — the text is selected: long-press it and choose Copy");
}

export interface JudgmentsResponse {
  applied: number;
  rejected?: { id: string; reason: string }[];
  delta_stamp?: string;
}

export interface SendOutcome {
  ok: boolean;
  applied: number;
  stamp: string;
  rejected: { id: string; reason: string }[];
  error?: string;
}

/** POST the Send-results text verbatim to the service. Resolves with the outcome; never throws. */
export async function submitResults(txt: string): Promise<SendOutcome> {
  try {
    const res = await apiFetch("/api/v1/judgments/text", {
      method: "POST",
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Actor": "ftb", "X-Human-Judgment": "true" },
      body: txt,
    });
    if (!res.ok) {
      let detail = "";
      try {
        const j = (await res.json()) as { error?: string; detail?: string };
        detail = [j.error, j.detail].filter(Boolean).join(": ");
      } catch (e) {
        /* non-JSON error body */
      }
      return { ok: false, applied: 0, stamp: "", rejected: [], error: "HTTP " + res.status + (detail ? " — " + detail : "") };
    }
    const j = (await res.json()) as JudgmentsResponse;
    return {
      ok: true,
      applied: typeof j.applied === "number" ? j.applied : countJudgments(),
      stamp: j.delta_stamp || "",
      rejected: j.rejected || [],
    };
  } catch (e) {
    return { ok: false, applied: 0, stamp: "", rejected: [], error: (e as Error).message || String(e) };
  }
}
