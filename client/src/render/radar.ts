/* Radar — dates first. A 15-cell strip (today + 14 days), then sections:
   Overdue → Today and tomorrow → This fortnight → Passed, not overdue → Dated, further out →
   Dormant start-ons → No date. */
import { REG } from "../data/registry";
import { dleft, dstate, isOverdue } from "../derive/dates";
import { eff, type Eff } from "../derive/effective";
import { match } from "../derive/tree";
import { view } from "../state";
import { itemHTML } from "./item";

interface Section {
  name: string;
  cls?: string;
  f: (e: Eff) => boolean | null | undefined;
}

export function renderRadar(host: HTMLElement, q: string): void {
  const TODAY = REG.TODAY;
  const strip = document.createElement("div");
  strip.className = "strip14";
  for (let n = 0; n <= 14; n++) {
    const d = new Date(Date.UTC(+TODAY.slice(0, 4), +TODAY.slice(5, 7) - 1, +TODAY.slice(8, 10) + n));
    const iso = d.toISOString().slice(0, 10);
    const hits = REG.ROWS.filter((r) => eff(r).dl === iso);
    const el = document.createElement("div");
    el.className = "day" + (n === 0 ? " today" : "") + (hits.length ? " hot" : "");
    el.innerHTML =
      (n === 0 ? "today" : d.getUTCDate() + "." + String(d.getUTCMonth() + 1).padStart(2, "0")) +
      (hits.length ? '<span class="n">' + hits.length + "</span>" : "");
    el.title = hits.map((r) => r.id + " " + r.task).join("\n");
    strip.appendChild(el);
  }
  host.appendChild(strip);
  const lab = document.createElement("p");
  lab.className = "striplab";
  lab.textContent = "The next 14 days — a bold number is how many dated rows land that day, of any type.";
  host.appendChild(lab);
  const SECS: Section[] = [
    { name: "Overdue", cls: "red", f: (e) => isOverdue(e) },
    {
      name: "Today and tomorrow",
      f: (e) => {
        const d = dstate(e);
        return d && d.n >= 0 && d.n <= 1 && d.k !== "dormant";
      },
    },
    {
      name: "This fortnight",
      f: (e) => {
        const d = dstate(e);
        return d && d.n > 1 && d.n <= 14 && d.k !== "dormant";
      },
    },
    {
      name: "Passed, not overdue",
      cls: "teal",
      f: (e) => {
        const d = dstate(e);
        return d && (d.k === "eligible" || d.k === "started");
      },
    },
    {
      name: "Dated, further out",
      f: (e) => {
        const d = dstate(e);
        return d && d.n > 14;
      },
    },
    {
      name: "Dormant start-ons",
      cls: "teal",
      f: (e) => {
        const d = dstate(e);
        return d && d.k === "dormant" && d.n <= 14;
      },
    },
    { name: "No date", f: (e) => !e.dl },
  ];
  SECS.forEach((s) => {
    const rs = REG.ROWS.filter((r) => s.f(eff(r)))
      .filter((r) => match(r, q))
      .filter((r) => !(view.hideSubs && r.d > 0));
    if (rs.length && eff(rs[0]).dl) rs.sort((a, b) => dleft(eff(a).dl) - dleft(eff(b).dl));
    if (!rs.length) return;
    const sec = document.createElement("div");
    sec.className = "sec";
    sec.innerHTML =
      '<div class="shead' + (s.cls ? " " + s.cls : "") + '">' + s.name + ' <span class="c">· ' + rs.length + "</span></div>" +
      '<div class="flat">' + rs.map((r) => itemHTML(r, { dot: true })).join("") + "</div>";
    host.appendChild(sec);
  });
}
