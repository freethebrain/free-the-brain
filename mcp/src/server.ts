/**
 * The MCP server: tools + the MCP App view, fronting the Registry Service.
 *
 * Every description is written for the AI host that reads the tool list: the
 * automation covenant — triage is a human act; tools stage it — has to be legible
 * from the tool list alone, because that is all a connected model ever sees.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';

import { RegistryClient, RegistryError } from './client.js';
import { checkJudgmentBatch, refuseStatusChange } from './covenant.js';
import { isoWeekMonday, parentOf, sofiaToday } from './dates.js';
import { PROPOSAL_DISCLAIMER, proposeScores } from './proposals.js';
import { legendText, stagingText, TIER_LABELS } from './staging.js';
import type { Judgment, Task } from './types.js';
import { buildTriageViewHtml, TRIAGE_VIEW_URI } from './ui.js';

export const SERVER_INFO = { name: 'free-the-brain', version: '0.1.0' };

export const COVENANT_SUMMARY =
  'Automation covenant: triage is a human act; these tools stage it. Reading, ordering, chunking, flagging, ' +
  'capturing and note-taking are yours to do freely. Changing U, I, status, deadline or category — including ' +
  'closing or reopening — is his judgment: record it only after he has made it in this conversation, with ' +
  'human_judgment: true. Never set human_judgment true on your own initiative; the server refuses, and so does the service behind it.';

export interface ServerOptions {
  client: RegistryClient;
  /** Override "today" (ISO). Defaults to the service's today where available, else Europe/Sofia device date. */
  today?: string;
  /** The ext-apps browser bundle to inline in the view; when absent the UI resource is still registered with a text stub. */
  extAppsBundleJs?: string;
}

const LEVEL = z.enum(['H', 'M', 'L']);
const REOPEN_STATUS = z.enum(['Planned', 'Active', 'Blocked', 'Dropped']);
const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date YYYY-MM-DD');
const TASK_ID = z.string().regex(/^T-\d{3,}(\.\d+)*$/, 'T-nnn, dotted for subtasks');

const judgmentSchema = z.object({
  id: TASK_ID.describe('The row, e.g. T-041 or T-018.1.1.'),
  u: LEVEL.optional().describe('Urgency he judged. Triage field.'),
  i: LEVEL.optional().describe('Importance he judged. Triage field.'),
  status: z.enum(['Inbox', 'Planned', 'Active', 'Blocked', 'Done', 'Dropped']).optional().describe('New status. Done sets done=today. Dropped only on his word. Triage field.'),
  category: z.string().optional().describe('Re-categorisation. Triage field.'),
  deadline: z
    .union([z.object({ type: z.enum(['DL', 'SO', 'SB']), date: ISO_DATE }), z.literal('none')])
    .optional()
    .describe('A dated field with its type — DL finish-by, SO start-on (dormant until then), SB start-by — or "none" to clear the date only. Triage field.'),
  reopen: REOPEN_STATUS.optional().describe('Reopen a closed row as this status. Triage field.'),
  note: z.string().optional().describe('Free text appended to Notes, never overwriting. Allowed without attestation.'),
});

function json(value: unknown, summary?: string): CallToolResult {
  const body = JSON.stringify(value, null, 2);
  return {
    content: [{ type: 'text', text: summary ? `${summary}\n\n${body}` : body }],
    structuredContent: value as Record<string, unknown>,
  };
}
function refusal(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true, structuredContent: { refused: true, reason: 'covenant', message } };
}
function serviceError(err: unknown): CallToolResult {
  if (err instanceof RegistryError) {
    const msg = err.isCovenant
      ? `Refused by the Registry Service's covenant check (HTTP 403): ${err.message}. Nothing was written.`
      : err.message;
    return { content: [{ type: 'text', text: msg }], isError: true, structuredContent: { error: err.status, body: err.body as Record<string, unknown> | null } };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text', text: `MCP server error: ${msg}` }], isError: true };
}

/** Top-level branch id within a set of ids (walk up while the parent is in the set). */
function branchTop(id: string, ids: Set<string>): string {
  let t = id;
  let p: string | null;
  while ((p = parentOf(t)) && ids.has(p)) t = p;
  return t;
}

export function createRegistryMcpServer(opts: ServerOptions): McpServer {
  const { client } = opts;
  const today = (serviceToday?: string) => opts.today ?? serviceToday ?? sofiaToday();

  const server = new McpServer(SERVER_INFO, {
    instructions:
      'Free the Brain — the Personal Task Organization registry, over MCP. ' +
      COVENANT_SUMMARY +
      ' Always write a task ID with its name: T-041 (chase Ian for the pay figure), never a bare T-041. ' +
      'On overwhelm, shrink the picture: one task, one first action. Prefer the smallest write that expresses the change.',
  });

  // ---------------------------------------------------------------- reads

  server.registerTool(
    'registry_read',
    {
      title: 'Read the registry',
      description:
        'Read the Task Registry from the Registry Service: rows plus counts (open / done / dropped / total), the stamp of the current state, today, the next free ID and three reserved capture IDs. ' +
        'open_only: true returns only open rows (Inbox, Planned, Active, Blocked); the default returns every row including Done and Dropped — the Done rows are his motivation archive, never noise. ' +
        'Read-only and free to call. ' + COVENANT_SUMMARY,
      inputSchema: { open_only: z.boolean().optional().describe('Only open rows. Default false.') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ open_only }) => {
      try {
        const env = await client.registry(open_only === true);
        return json(env, `${env.rows.length} rows (${env.counts.open} open · ${env.counts.done} done · ${env.counts.dropped} dropped) · stamp ${env.stamp} · today ${env.today}`);
      } catch (e) {
        return serviceError(e);
      }
    }
  );

  server.registerTool(
    'registry_queue',
    {
      title: 'The triage queue',
      description:
        'The five-tier triage queue for the current ISO week, derived server-side over all open rows: ① overdue (most overdue first) · ② dated within 14 days (soonest first; dormant start-ons excluded) · ③ never judged (oldest Recorded first) · ④ unverified scores — U/I present but no Triaged date, meaning scores were proposed rather than confirmed · ⑤ stalest triage. ' +
        'One branch (a top-level row plus its open descendants) is one entry; rows he judged since Monday are excluded. Returns the entries for one page with their tiers, the total, the cycle Monday and the legend text. ' +
        'chunk is entries per page (default 5 — the phone/voice size; use 10 at a desk), page is 0-based. Read-only. ' + COVENANT_SUMMARY,
      inputSchema: {
        chunk: z.number().int().min(1).max(100).optional().describe('Entries per page. Default 5.'),
        page: z.number().int().min(0).optional().describe('0-based page. Default 0.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ chunk, page }) => {
      try {
        const q = await client.queue(chunk ?? 5, page ?? 0);
        const t = today(q.today);
        return json(
          { ...q, today: t, legend: legendText(q.monday), tiers: TIER_LABELS },
          `${q.entries.length} entries on page ${q.page} of ${Math.ceil(q.total / Math.max(1, q.chunk))} (${q.total} in the queue) · cycle Monday ${q.monday}\n${legendText(q.monday)}`
        );
      } catch (e) {
        return serviceError(e);
      }
    }
  );

  server.registerTool(
    'registry_radar',
    {
      title: 'Deadline radar',
      description:
        'The deadline radar, dates first — the system trusts dates over stale scores. Sections: overdue · today_tomorrow · fortnight (within `days`, default 14) · passed_not_overdue (start-ons now eligible, start-bys already started) · further · dormant (start-ons not yet reached) · undated. ' +
        'Uses the DL / SO / SB semantics: DL is overdue past its date; SB is overdue past its date only while Inbox or Planned; SO is never overdue. Read-only. Hard external deadlines lacking a calendar entry are worth flagging to him with an exact proposed entry — but Calendar is written only on his word. ' + COVENANT_SUMMARY,
      inputSchema: { days: z.number().int().min(1).max(365).optional().describe('Horizon in days for the fortnight section. Default 14.') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ days }) => {
      try {
        const r = await client.radar(days ?? 14);
        const count = (k: keyof typeof r) => (Array.isArray(r[k]) ? (r[k] as Task[]).length : 0);
        return json(
          r,
          `overdue ${count('overdue')} · today/tomorrow ${count('today_tomorrow')} · within ${days ?? 14}d ${count('fortnight')} · passed-not-overdue ${count('passed_not_overdue')} · further ${count('further')} · dormant ${count('dormant')} · undated ${count('undated')}`
        );
      } catch (e) {
        return serviceError(e);
      }
    }
  );

  // ---------------------------------------------------------------- staging

  registerAppTool(
    server,
    'triage_stage',
    {
      title: 'Stage a triage chunk',
      description:
        'Stage the next triage chunk: the queue page (see registry_queue) plus a compact human-readable staging text — the tier legend, then one line per row: "T-nnn (name) · category · U/I · status · date-state · judged Nd ago / never judged · first sentence of the note", subtask rows indented under their parent. ' +
        'Show him the staging text (or the rendered view, where the host supports MCP Apps) and let him judge; the view is read-only. chunk defaults to 5 (phone or voice), use 10 at a desk; page is 0-based. ' +
        'Staging is yours; the judgments are his. When he gives them, record them with triage_record. Do not propose scores unless he asks ("your read") — then use propose_scores, which writes nothing. ' + COVENANT_SUMMARY,
      inputSchema: {
        chunk: z.number().int().min(1).max(50).optional().describe('Entries per chunk. Default 5.'),
        page: z.number().int().min(0).optional().describe('0-based chunk index. Default 0.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: TRIAGE_VIEW_URI } },
    },
    async ({ chunk, page }) => {
      try {
        const q = await client.queue(chunk ?? 5, page ?? 0);
        const t = today(q.today);
        const staging = stagingText(q, t);
        const value = { today: t, queue: q, staging_text: staging, legend: legendText(q.monday) };
        return { content: [{ type: 'text', text: staging }], structuredContent: value };
      } catch (e) {
        return serviceError(e);
      }
    }
  );

  registerAppResource(
    server,
    'Triage stage view',
    TRIAGE_VIEW_URI,
    {
      description: 'Read-only rendering of one triage chunk in the Master widget style. Shows; never writes.',
      mimeType: RESOURCE_MIME_TYPE,
      _meta: { ui: { prefersBorder: true } },
    },
    async () => ({
      contents: [
        {
          uri: TRIAGE_VIEW_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: opts.extAppsBundleJs
            ? buildTriageViewHtml(opts.extAppsBundleJs)
            : '<!DOCTYPE html><html><body><p>The ext-apps bundle was not provided to this server instance; use the staging text instead.</p></body></html>',
        },
      ],
    })
  );

  // ---------------------------------------------------------------- writes

  server.registerTool(
    'triage_record',
    {
      title: 'Record his triage judgments',
      description:
        'Record a batch of triage judgments he has made — forwards to POST /judgments. Per judgment: id, and any of u, i, status, category, deadline ({type: DL|SO|SB, date} or "none" to clear the date only), reopen (for a closed row), note (appended, never overwriting). An absent field is unchanged, never cleared; every judged row gets Triaged = today; status Done sets done = today. Deadline offsets he gives in words ("two weeks", "end of next month") are counted from today — months first, clamped to the last valid day of the month, then weeks, then days — and sent as an absolute date. ' +
        'human_judgment may ONLY be set true when the human actually made the judgment in this conversation — he named the score, the status, the date or the category himself, or confirmed one you offered when he asked for your read. If he has not, leave it false: a batch that touches u, i, status, category, deadline or reopen without human_judgment: true is refused here before any request is sent, and refused again by the service. note-only batches (observations, value figures, blockers) pass without attestation. actor is who is speaking through you: "ftb" when recording his words, otherwise the client name ("claude", "chatgpt"). Never drop a task unless he said so — Dropped is information, not failure. ' +
        COVENANT_SUMMARY,
      inputSchema: {
        actor: z.string().min(1).describe('"ftb" when recording his judgments; otherwise your client name.'),
        human_judgment: z.boolean().describe('True ONLY if the human made these judgments in this conversation. Required true for any u/i/status/category/deadline/reopen change.'),
        today: ISO_DATE.optional().describe('Override the judgment date (ISO). Defaults to the service clock.'),
        judgments: z.array(judgmentSchema).min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ actor, human_judgment, today: todayArg, judgments }) => {
      const verdict = checkJudgmentBatch(human_judgment, judgments as Judgment[]);
      if (!verdict.ok) return refusal(verdict.message);
      try {
        const res = await client.judgments({
          actor,
          source: 'mcp',
          human_judgment: human_judgment === true,
          today: todayArg,
          judgments: judgments as Judgment[],
        });
        const rej = res.rejected?.length ? ` · rejected ${res.rejected.map((r) => `${r.id}: ${r.reason}`).join('; ')}` : '';
        return json(res, `Recorded ${res.applied} judgment(s)${rej} · delta ${res.delta_stamp}`);
      } catch (e) {
        return serviceError(e);
      }
    }
  );

  server.registerTool(
    'capture_add',
    {
      title: 'Capture new tasks',
      description:
        'Capture — the highest-priority behaviour in any chat. Turn what he said into clean one-line tasks and record them: each gets the next free ID, Status = Inbox, Recorded = today, Triaged empty. Fill category only when it is obvious from what he said (Website Projects · Best Moments · Freelance Videoediting · Research & Side Projects · Art College · Real Estate · Personal / Admin); never interrogate at capture time; brain-dumps are extracted in one pass and sent as one batch. Confirm in one line — "T-102 (book dentist) captured" — then return to the conversation. Capture is allowed autonomously; it sets no scores. ' +
        COVENANT_SUMMARY,
      inputSchema: {
        actor: z.string().min(1).describe('"ftb" when capturing his words; otherwise your client name.'),
        items: z
          .array(
            z.object({
              task: z.string().min(1).describe('Clean one-line task.'),
              category: z.string().optional().describe('Only if obvious.'),
              notes: z.string().optional().describe('One-line context if he gave it.'),
            })
          )
          .min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ actor, items }) => {
      try {
        const res = await client.capture(items, actor);
        const line = res.rows.map((r) => `${r.id} (${r.task})`).join(', ');
        return json(res, `Captured ${res.rows.length}: ${line}`);
      } catch (e) {
        return serviceError(e);
      }
    }
  );

  server.registerTool(
    'task_close',
    {
      title: 'Close a task as Done',
      description:
        'Mark a task Done — forwards to POST /tasks/:id/close. Closing is a status change and therefore his judgment: call this only when he said in this conversation that the task is done, with human_judgment: true; otherwise it is refused before any request is sent. done_date is for a completion discovered late (the true completion goes in note). After closing, offer a two-minute retrospective distilled to one Notes line — especially for rows that ran long past their deadline or carry a value observation (a rate agreed, a cost avoided: concrete numbers, not adjectives). ' +
        COVENANT_SUMMARY,
      inputSchema: {
        id: TASK_ID,
        actor: z.string().min(1),
        human_judgment: z.boolean().describe('True ONLY if he said the task is done in this conversation.'),
        done_date: ISO_DATE.optional().describe('Completion date if not today.'),
        note: z.string().optional().describe('Appended to Notes.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, actor, human_judgment, done_date, note }) => {
      if (human_judgment !== true) return refusal(refuseStatusChange('close', id));
      try {
        const t = await client.close(id, { actor, human_judgment: true, done: done_date, note });
        return json(t, `${t.id} (${t.task}) → Done ${t.done ?? ''}`.trim());
      } catch (e) {
        return serviceError(e);
      }
    }
  );

  server.registerTool(
    'task_reopen',
    {
      title: 'Reopen a closed task',
      description:
        'Reopen a Done or Dropped row as Planned, Active, Blocked or Dropped — forwards to POST /tasks/:id/reopen. A status change, therefore his judgment: only with human_judgment: true when he asked for it in this conversation; refused locally otherwise. Give the reason in note; a Blocked row should name its blocker there. ' +
        COVENANT_SUMMARY,
      inputSchema: {
        id: TASK_ID,
        actor: z.string().min(1),
        human_judgment: z.boolean().describe('True ONLY if he asked to reopen this task in this conversation.'),
        status: REOPEN_STATUS,
        note: z.string().optional().describe('Why it is reopening. Appended to Notes.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, actor, human_judgment, status, note }) => {
      if (human_judgment !== true) return refusal(refuseStatusChange('reopen', id));
      try {
        const t = await client.reopen(id, { actor, human_judgment: true, status, note });
        return json(t, `${t.id} (${t.task}) reopened as ${t.status}`);
      } catch (e) {
        return serviceError(e);
      }
    }
  );

  server.registerTool(
    'note_append',
    {
      title: 'Append a note',
      description:
        'Append one line to a row\'s Notes — never overwrites. Allowed autonomously: blockers, one-line context, retrospective pointers, and value observations (when a task produces, protects or forecloses value, record the figure and its reasoning: "€1,000 for a week of edit-plus-direction, against a researched band of €1,278–4,090", not "good rate"). Not a triage field, so no attestation is needed. ' +
        COVENANT_SUMMARY,
      inputSchema: {
        id: TASK_ID,
        actor: z.string().min(1),
        text: z.string().min(1).describe('One line. Concrete numbers over adjectives.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ id, actor, text: noteText }) => {
      try {
        const t = await client.note(id, { actor, text: noteText });
        return json(t, `Note appended to ${t.id} (${t.task})`);
      } catch (e) {
        return serviceError(e);
      }
    }
  );

  // ---------------------------------------------------------------- proposals and status

  server.registerTool(
    'propose_scores',
    {
      title: 'Your read — proposed scores',
      description:
        '"Your read": propose U and I for the given rows and WRITE NOTHING. Returns { proposals: [{ id, task, u, i, reasoning, current }], disclaimer }. Use it only when he asks for your read of a chunk; present the proposals as overridable in one word, never as decisions. ' +
        'Placeholder heuristic, deterministic and clearly labelled: overdue → U=H; a hard deadline within 14 days or any date within 7 → U=H; dated within 30 → U=M; else L. Category in the top two Earning Hierarchy tiers (Art College, Real Estate) → I=H; Freelance Videoediting / Website Projects → I=M; else L (lifted to M by a hard deadline). ' +
        'Nothing reaches the registry from this tool. Whatever he decides is recorded separately with triage_record and human_judgment: true. ' + COVENANT_SUMMARY,
      inputSchema: { ids: z.array(TASK_ID).min(1).describe('Rows to read.') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ ids }) => {
      try {
        const env = await client.registry(false);
        const t = today(env.today);
        const byId = new Map(env.rows.map((r) => [r.id, r]));
        const proposals = [];
        const unknown: string[] = [];
        for (const id of ids) {
          const row = byId.get(id);
          if (!row) unknown.push(id);
          else proposals.push(proposeScores(row, t));
        }
        const value = { proposals, unknown_ids: unknown, disclaimer: PROPOSAL_DISCLAIMER, written: false };
        const lines = proposals.map((p) => `${p.id} (${p.task}): U=${p.u} I=${p.i} (now ${p.current.u ?? '–'}/${p.current.i ?? '–'}) — ${p.reasoning}`);
        return json(value, `${PROPOSAL_DISCLAIMER}\n${lines.join('\n')}${unknown.length ? `\nUnknown ids: ${unknown.join(', ')}` : ''}`);
      } catch (e) {
        return serviceError(e);
      }
    }
  );

  server.registerTool(
    'full_pass_status',
    {
      title: 'Full pass status',
      description:
        'How far this cycle\'s triage pass has got: branches judged since Monday versus total open branches, entries remaining in the queue by tier, and the cycle Monday. A full pass is every open row triaged within the ISO week — the goal, not the requirement; a partial cycle gets no commentary. Read-only. ' +
        COVENANT_SUMMARY,
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const [env, q] = await Promise.all([client.registry(true), client.queue(500, 0)]);
        const t = today(env.today);
        const monday = q.monday ?? isoWeekMonday(t);
        const ids = new Set(env.rows.map((r) => r.id));
        const judged = new Set<string>();
        const all = new Set<string>();
        for (const r of env.rows) {
          const top = branchTop(r.id, ids);
          all.add(top);
          if (r.triaged && r.triaged >= monday) judged.add(top);
        }
        const byTier: Record<string, number> = {};
        for (const e of q.entries) byTier[e.tier] = (byTier[e.tier] ?? 0) + 1;
        const value = {
          today: t,
          monday,
          branches_total: all.size,
          branches_judged_this_cycle: judged.size,
          entries_remaining: q.total,
          remaining_by_tier: Object.fromEntries(Object.entries(byTier).map(([k, v]) => [TIER_LABELS[Number(k)] ?? k, v])),
          open_rows: env.rows.length,
        };
        return json(value, `${judged.size} of ${all.size} branches judged this cycle (since Monday ${monday}) · ${q.total} entries remaining in the queue`);
      } catch (e) {
        return serviceError(e);
      }
    }
  );

  return server;
}
