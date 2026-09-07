/**
 * The MCP App view for triage_stage — a minimal, READ-ONLY rendering of one chunk
 * in the Master widget's style (warm paper theme, category hues, tier labels,
 * date and staleness chips). Judging inside the view is scope for a later pass;
 * for now the view shows the chunk and the model records his judgments through
 * triage_record.
 *
 * The page is a single self-contained HTML document: the official
 * @modelcontextprotocol/ext-apps browser bundle is inlined (hosts sandbox the
 * view with a CSP that blocks external scripts), followed by the view script.
 */

export const TRIAGE_VIEW_URI = 'ui://free-the-brain/triage-stage.html';

const CSS = `
:root{--bg:#fbfaf8;--ink:#1c1b18;--ink2:#5f5c55;--ink3:#8f8b82;--hair:rgba(30,25,10,.12);--card:#fff;
--red:#b42318;--amber:#a15c07;--green:#067647;--blue:#175cd3;--teal:#0e9384}
@media(prefers-color-scheme:dark){:root{--bg:#14130f;--ink:#ece9e2;--ink2:#a8a49a;--ink3:#787468;--hair:rgba(255,250,235,.12);
--card:#1c1a15;--red:#f97066;--amber:#f0b45e;--green:#5fd6a0;--blue:#8ab4ff;--teal:#4cc4b4}}
*{box-sizing:border-box}
body{margin:0;padding:14px 14px 18px;background:var(--bg);color:var(--ink);
font:400 14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;-webkit-font-smoothing:antialiased}
h1{font-size:16px;font-weight:650;margin:0 0 2px}
.prov{font-size:12px;color:var(--ink3);margin:0 0 10px}
.legend{font-size:11.5px;color:var(--ink3);line-height:1.6;margin:0 0 10px}
.legend b{color:var(--ink2);font-weight:650}
.seclabel{font-size:11.5px;font-weight:650;letter-spacing:.03em;text-transform:uppercase;color:var(--ink3);margin:14px 0 6px}
.flat{background:var(--card);border:.5px solid var(--hair);border-radius:10px;overflow:hidden}
.item{border-bottom:.5px solid var(--hair)}
.item:last-child{border-bottom:none}
.i1{display:flex;gap:8px;align-items:baseline;padding:9px 12px 8px}
.item.sub .i1{padding-left:28px}
.catdot{width:7px;height:7px;border-radius:50%;background:hsl(var(--h),var(--s),52%);flex:none;align-self:center}
.tid{font:600 10.5px ui-monospace,Menlo,monospace;color:var(--ink3);flex:none}
.iname{min-width:0;font-size:13.5px}
.item.aged .iname{opacity:.68}
.ir{margin-left:auto;flex:none;display:flex;gap:7px;align-items:baseline;flex-wrap:wrap;justify-content:flex-end}
.mini{font-size:11px;font-weight:600;white-space:nowrap;color:var(--ink3)}
.mini.od{color:var(--red)}.mini.due{color:var(--amber)}.mini.so{color:var(--teal)}
.mini.stB{color:var(--amber)}.mini.stA{color:var(--green)}.mini.stI{color:var(--blue)}
.stalechip{font-size:10.5px;font-weight:600;border-radius:999px;padding:1px 7px;border:.5px solid var(--hair);color:var(--ink3)}
.stalechip.old{color:var(--amber);border-color:var(--amber)}
.det{padding:0 12px 10px;font-size:12.5px;color:var(--ink2);line-height:1.5}
.item.sub .det{padding-left:28px}
.det .meta{color:var(--ink3);font-size:11.5px;margin-top:3px}
.empty{color:var(--ink3);font-size:13px;padding:14px 2px}
.foot{font-size:12px;color:var(--ink3);margin:14px 0 0}
`;

/** The view script. Runs after the inlined ext-apps bundle in the same module scope, so `App` is in scope. */
const VIEW_SCRIPT = `
const CATS={"Art College":{h:45,s:"85%"},"Real Estate":{h:145,s:"52%"},"Freelance Videoediting":{h:28,s:"78%"},
"Website Projects":{h:214,s:"70%"},"Best Moments":{h:358,s:"68%"},"Research & Side Projects":{h:270,s:"55%"},"Personal / Admin":{h:220,s:"12%"}};
const TIERS={1:"① Overdue",2:"② Dated within 14 days",3:"③ Never judged",4:"④ Unverified scores — U/I present, never confirmed by him",5:"⑤ Stalest triage"};
const esc=v=>String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;");
function days(a,b){const x=a.split("-").map(Number),y=b.split("-").map(Number);return Math.round((Date.UTC(y[0],y[1]-1,y[2])-Date.UTC(x[0],x[1]-1,x[2]))/86400000)}
function dstate(r,today){if(!r.deadline)return null;const n=days(today,r.deadline),ty=r.deadline_type||"DL";
 if(ty==="SO")return n<0?{k:"eligible",n}:n===0?{k:"starts",n}:{k:"dormant",n};
 if(ty==="SB"){if(n<0)return(r.status==="Inbox"||r.status==="Planned")?{k:"overdue",n}:{k:"started",n};return{k:"startby",n}}
 return n<0?{k:"overdue",n}:{k:"due",n}}
function dateChip(r,today){const d=dstate(r,today);if(!d)return"";const ty=r.deadline_type||"DL";const hard=ty==="DL"&&r.deadline_kind==="hard"?" · hard":"";
 const inN=n=>n===0?"today":n===1?"tomorrow":"in "+n+"d";
 switch(d.k){case"overdue":return'<span class="mini od">'+(ty==="SB"?"start-by ":"")+(-d.n)+"d overdue"+hard+"</span>";
 case"due":return'<span class="mini due">due '+inN(d.n)+hard+"</span>";case"startby":return'<span class="mini due">start by '+inN(d.n)+"</span>";
 case"started":return'<span class="mini so">started · SB '+r.deadline.slice(5)+"</span>";case"starts":return'<span class="mini so">starts today</span>';
 case"dormant":return'<span class="mini so">starts '+inN(d.n)+"</span>";case"eligible":return'<span class="mini so">eligible '+(-d.n)+"d</span>"}return""}
function stale(r,today){if(!r.triaged)return{txt:"never judged",old:true};const d=-days(today,r.triaged);
 return d<7?{txt:"judged "+(d<=0?"today":d+"d ago"),old:false}:{txt:"judged "+d+"d ago",old:d>=21}}
function firstSentence(n){if(!n)return"";const l=(n.split(/\\r?\\n/).find(x=>x.trim())||"");const m=l.match(/^(.*?[.!?])(\\s|$)/);return(m?m[1]:l).trim()}
function item(r,today,depth){const cc=CATS[r.category]||{h:220,s:"10%"};const st=stale(r,today);
 const sc=r.status==="Blocked"?"stB":r.status==="Active"?"stA":r.status==="Inbox"?"stI":"";
 return'<div class="item'+(depth?" sub":"")+(st.old?" aged":"")+'" style="--h:'+cc.h+';--s:'+cc.s+'"><div class="i1">'
 +'<span class="catdot"></span><span class="tid">'+esc(r.id)+'</span><span class="iname">'+esc(r.task)+'</span>'
 +'<span class="ir">'+dateChip(r,today)+'<span class="mini '+sc+'">'+esc(r.status)+'</span><span class="stalechip'+(st.old?" old":"")+'">'+st.txt+'</span></span></div>'
 +'<div class="det">'+(firstSentence(r.notes)?esc(firstSentence(r.notes)):"No note on this row.")
 +'<div class="meta">'+esc(r.category)+' · now '+(r.u||"–")+'/'+(r.i||"–")+' · recorded '+esc(r.recorded)+(r.deadline?' · '+(r.deadline_type||"DL")+' '+esc(r.deadline):'')+(r.blocker?' · waiting on '+esc(r.blocker):'')+'</div></div></div>'}
function render(data){const host=document.getElementById("host");const today=data.today;const q=data.queue;
 document.getElementById("prov").textContent="Chunk "+(q.page+1)+" of "+Math.max(1,Math.ceil(q.total/Math.max(1,q.chunk)))+" · "+q.total+" entries in the queue · today "+today+" · read-only view — judgments are recorded in the conversation";
 document.getElementById("legend").innerHTML="<b>Sort order:</b> "+[1,2,3,4,5].map(t=>TIERS[t]).join(" &nbsp;·&nbsp; ")+". Rows judged since Monday "+q.monday.slice(5)+" are out of the queue. A branch is one entry.";
 if(!q.entries.length){host.innerHTML='<div class="empty">'+(q.total?"This page is past the end of the queue.":"The queue is empty for this cycle.")+'</div>';return}
 let html="",last=null;
 q.entries.forEach(en=>{if(en.tier!==last){if(last!==null)html+="</div>";last=en.tier;html+='<div class="seclabel">'+(TIERS[en.tier]||"Tier "+en.tier)+'</div><div class="flat">'}
  const base=en.top.id.split(".").length;en.rows.forEach(r=>{html+=item(r,today,Math.max(0,r.id.split(".").length-base))})});
 if(last!==null)html+="</div>";host.innerHTML=html}
function fromResult(res){if(res&&res.structuredContent&&res.structuredContent.queue)return res.structuredContent;
 const t=(res&&res.content||[]).find(c=>c.type==="text");if(t){try{const j=JSON.parse(t.text);if(j&&j.queue)return j}catch(e){}}return null}
const app=new App({name:"Free the Brain — triage stage",version:"0.1.0"},{});
app.ontoolinput=()=>{document.getElementById("host").innerHTML='<div class="empty">Staging the chunk…</div>'};
app.ontoolresult=res=>{const d=fromResult(res);if(d)render(d);else document.getElementById("host").innerHTML='<div class="empty">'+(res&&res.isError?"The service refused or failed — see the conversation.":"No chunk in this result.")+'</div>'};
app.connect().catch(e=>{document.getElementById("host").innerHTML='<div class="empty">Could not connect to the host: '+esc(e&&e.message||e)+'</div>'});
`;

export function buildTriageViewHtml(extAppsBundleJs: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Triage stage — Free the Brain</title>
<style>${CSS}</style>
</head>
<body>
<h1>Triage stage</h1>
<p class="prov" id="prov">Waiting for the chunk…</p>
<p class="legend" id="legend"></p>
<div id="host"><div class="empty">Waiting for the chunk…</div></div>
<p class="foot">Triage is a human act. This view stages it; nothing here writes to the registry.</p>
<script type="module">
${extAppsBundleJs}
${VIEW_SCRIPT}
</script>
</body>
</html>`;
}
