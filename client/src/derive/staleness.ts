/* Staleness chip: "judged Nd ago" or "never judged". Under 7 days is quiet; 21 days or older (or never)
   turns the chip amber and dims the row name. Ageing is information, not accusation. */
import { REG } from "../data/registry";
import { dleft } from "./dates";

export interface Staleness {
  txt: string;
  old: boolean;
}

export function staleness(r: { tri: string | null }, today: string = REG.TODAY): Staleness {
  if (!r.tri) return { txt: "never judged", old: true };
  const d = -dleft(r.tri, today);
  if (d < 7) return { txt: "judged " + (d === 0 ? "today" : d + "d ago"), old: false };
  return { txt: "judged " + d + "d ago", old: d >= 21 };
}
