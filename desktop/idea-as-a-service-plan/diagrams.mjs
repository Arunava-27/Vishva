// Tiny SVG helpers + the architecture diagrams
const C = { blue:'#dbeafe', bs:'#2563eb', green:'#dcfce7', gs:'#16a34a', amber:'#fef3c7', as:'#d97706',
  purple:'#ede9fe', ps:'#7c3aed', red:'#fee2e2', rs:'#dc2626', gray:'#f1f5f9', ss:'#64748b', teal:'#ccfbf1', ts:'#0d9488' };
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
const stroke = col => C[col[0]+'s'] || C.ss;
export const box = (x,y,w,h,title,sub=[],col='blue',opt={}) => {
  const lines=[].concat(sub);
  const ty = lines.length? y+15 : y+h/2+4;
  return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${C[col]}" stroke="${stroke(col)}" stroke-width="1.2"/>
<text x="${x+w/2}" y="${ty}" text-anchor="middle" font-size="${opt.fs||11}" font-weight="700" fill="#0f172a">${esc(title)}</text>
${lines.map((l,i)=>`<text x="${x+w/2}" y="${y+29+i*11.5}" text-anchor="middle" font-size="9" fill="#334155">${esc(l)}</text>`).join('')}</g>`;
};
export const band = (x,y,w,h,label,col='gray') => `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${C[col]}" stroke="${stroke(col)}" stroke-dasharray="4 3" opacity=".55"/>
<text x="${x+10}" y="${y+14}" font-size="10" font-weight="700" fill="#475569" letter-spacing=".5">${esc(label)}</text></g>`;
export const arrow = (x1,y1,x2,y2,label='',col='#475569',dash=false) => {
  const mx=(x1+x2)/2,my=(y1+y2)/2;
  return `<g><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="1.4"${dash?' stroke-dasharray="4 3"':''} marker-end="url(#ah)"/>${label?`<text x="${mx+4}" y="${my-3}" font-size="8.5" fill="${col}" font-style="italic">${esc(label)}</text>`:''}</g>`;
};
export const text = (x,y,t,o={}) => `<text x="${x}" y="${y}" font-size="${o.fs||10}" ${o.b?'font-weight="700"':''} fill="${o.c||'#334155'}" text-anchor="${o.a||'start'}">${esc(t)}</text>`;
export const svg = (w,h,inner) => `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" font-family="Segoe UI, Helvetica, Arial, sans-serif"><defs><marker id="ah" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#475569"/></marker></defs>${inner}</svg>`;

// 1. Layered architecture
export const d1 = () => svg(1000,600,[
 band(10,8,980,78,'L1  EXPERIENCE  (how the client interacts)','blue'),
 box(25,28,180,50,'Idea Portal',['chat + voice + upload docs'],'blue'),
 box(215,28,180,50,'Live Preview',['clickable prototype / staging'],'blue'),
 box(405,28,180,50,'Approval Inbox',['sign-offs, diffs, cost, risk'],'blue'),
 box(595,28,180,50,'Ops Dashboard',['uptime, tickets, releases'],'blue'),
 box(785,28,190,50,'Admin / Expert Console',['human engineers, auditors'],'blue'),
 band(10,96,980,78,'L2  CONTROL PLANE  (deterministic code, NOT an LLM)','amber'),
 box(25,116,180,50,'Workflow Engine',['Temporal: durable SDLC state'],'amber'),
 box(215,116,180,50,'Policy + Gates',['OPA rules, autonomy dial'],'amber'),
 box(405,116,180,50,'Artifact Registry',['typed specs, ADRs, SBOMs'],'amber'),
 box(595,116,180,50,'Tenancy + Billing',['projects, quotas, metering'],'amber'),
 box(785,116,190,50,'Identity + Audit',['SSO, RBAC, tamper-proof log'],'amber'),
 band(10,184,980,92,'L3  AGENT LAYER  (role-specialised, typed inputs/outputs)','purple'),
 box(25,206,118,60,'Orchestrator',['plans, routes, budgets'],'purple'),
 box(153,206,118,60,'Product / PM',['PRD, stories, AC'],'purple'),
 box(281,206,118,60,'Architect',['C4, ADR, schemas'],'purple'),
 box(409,206,118,60,'Domain Devs',['web, mobile, IoT,','network, cyber'],'purple'),
 box(537,206,118,60,'QA / Test',['tests-first, fuzz'],'purple'),
 box(665,206,118,60,'Security',['threat model, SAST'],'purple'),
 box(793,206,90,60,'DevOps/SRE',['IaC, deploy'],'purple'),
 box(893,206,82,60,'Docs/Support',['manuals, triage'],'purple'),
 band(10,286,980,92,'L4  AI HARNESS  (makes a probabilistic model behave like a component)','green'),
 box(25,308,135,60,'Context Builder',['repo map, RAG, memory'],'green'),
 box(170,308,135,60,'Typed I/O Gateway',['schema-constrained decode'],'green'),
 box(315,308,135,60,'Tool Broker',['least-privilege tools, MCP'],'green'),
 box(460,308,135,60,'Verifier',['compile, lint, types, tests'],'green'),
 box(605,308,135,60,'Eval + Regression',['golden tasks, model gates'],'green'),
 box(750,308,110,60,'Sandbox Runner',['microVM / gVisor'],'green'),
 box(870,308,105,60,'Tracing',['OTel, Langfuse'],'green'),
 band(10,388,980,86,'L5  LOCAL MODEL PLANE  (GPU cluster; hosted models are an optional fallback)','red'),
 box(25,410,165,54,'Reasoning LLM',['plan / architecture (large MoE)'],'red'),
 box(200,410,165,54,'Coder LLM',['code synthesis, refactor'],'red'),
 box(375,410,140,54,'Small / fast LLM',['lint fixes, summaries'],'red'),
 box(525,410,140,54,'Embed + Rerank',['code + doc retrieval'],'red'),
 box(675,410,140,54,'Vision + Guard',['UI review, safety filter'],'red'),
 box(825,410,150,54,'vLLM / SGLang',['router, batching, cache'],'red'),
 band(10,484,980,108,'L6  DELIVERED PRODUCTS  +  TARGET ENVIRONMENTS','teal'),
 box(25,508,150,74,'Web / ERP / SaaS',['Postgres, K8s, CDN'],'teal'),
 box(185,508,150,74,'Mobile apps',['iOS / Android stores'],'teal'),
 box(345,508,150,74,'IoT / Embedded',['firmware, OTA, cloud'],'teal'),
 box(505,508,150,74,'Network',['IaC, SDN, config, monitors'],'teal'),
 box(665,508,150,74,'Cyber products',['scanners, SIEM rules,','hardening'],'teal'),
 box(825,508,150,74,'Managed Ops',['24x7 monitor + patch'],'teal'),
 arrow(500,84,500,96),arrow(500,172,500,184),arrow(500,280,500,288),arrow(500,376,500,388),arrow(500,478,500,486)
].join(''));

// 2. Lifecycle pipeline
export const d2 = () => {
  const st=[['1 Intake','Interview, scope,','feasibility, quote','PRD v1','Client approves scope'],
   ['2 Design','C4, data model,','OpenAPI/proto, ADRs','Typed contracts','Expert reviews arch'],
   ['3 Build','Tests first, then code','in sandbox, small PRs','Green PRs','Auto: CI + review agent'],
   ['4 Verify','E2E, load, fuzz,','SAST/DAST, a11y','Test + sec report','Auto + expert if high risk'],
   ['5 Release','Terraform, canary,','migrations, SBOM','Signed release','Client + policy gate'],
   ['6 Operate','Monitor, SLOs,','incident triage','Runbooks, dashboards','On-call escalation'],
   ['7 Evolve','Tickets > specs >','patches, upgrades','Change PRs','Same gates, smaller']];
  let o=''; const w=128,g=14;
  st.forEach((s,i)=>{const x=10+i*(w+g);
    o+=box(x,40,w,54,s[0],[s[1],s[2]],'purple',{fs:12});
    o+=box(x,120,w,40,'Typed artifact',[s[3]],'green');
    o+=box(x,186,w,46,'Gate',[s[4]],'amber');
    o+=arrow(x+w/2,94,x+w/2,120)+arrow(x+w/2,160,x+w/2,186);
    if(i<6) o+=arrow(x+w,67,x+w+g,67);});
  o+=text(10,24,'Stages (agents do the work)',{b:1,c:'#7c3aed'})+text(150,114,'Output is a machine-checkable artifact, never free text',{fs:9});
  o+=text(10,256,'Failed gate: auto-retry (max N) then escalate to a human. Anything above a small patch in maintenance returns to stage 1/2.',{fs:9.5,c:'#b45309'});
  o+=`<path d="M 940 266 C 940 310, 60 310, 60 266" fill="none" stroke="#d97706" stroke-width="1.4" stroke-dasharray="5 3" marker-end="url(#ah)"/>`+text(500,306,'Feedback: production telemetry + tickets feed the next iteration',{a:'middle',fs:9.5,c:'#b45309'});
  return svg(1000,330,o);
};

// 3. Agent organisation
export const d3 = () => svg(1000,560,[
 box(380,10,240,46,'Human Programme Owner',['sets autonomy dial, budget, sign-offs'],'red'),
 box(380,80,240,46,'Orchestrator Agent',['goal > task DAG, assigns, tracks cost'],'purple'),
 arrow(500,56,500,80),
 box(40,160,200,44,'Product Agent',['requirements, acceptance criteria'],'purple'),
 box(260,160,200,44,'Architecture Agent',['C4, contracts, ADRs'],'purple'),
 box(540,160,200,44,'Security Agent',['threat model, policy, review'],'purple'),
 box(760,160,200,44,'Release/Ops Agent',['IaC, deploy, SRE'],'purple'),
 arrow(440,126,140,160),arrow(470,126,360,160),arrow(530,126,640,160),arrow(560,126,860,160),
 band(10,235,980,190,'DOMAIN SQUADS  (each = lead agent + coders + tester + domain-tool sandboxes)','green'),
 box(25,262,180,150,'Web / ERP squad',['Backend, frontend, DB agents','Node/Python/Go, Postgres,','Playwright','Base: ERPNext / Odoo core'],'green'),
 box(215,262,180,150,'Mobile squad',['Flutter / RN / native','Android emulators,','Mac mini iOS builders,','Appium, store pipelines'],'green'),
 box(405,262,180,150,'IoT / Embedded squad',['Firmware (C/Rust/Zephyr)','QEMU, Renode,','HIL rack, MQTT broker,','OTA + fleet console'],'green'),
 box(595,262,180,150,'Network squad',['Config, IaC, SDN, protocols','Containerlab, Batfish,','Scapy, Ansible,','change-window gates'],'green'),
 box(785,262,190,150,'Cyber squad',['Hardening, detection rules,','scanners, secure code','Cyber range, Semgrep,','Trivy, ZAP: scoped targets'],'green'),
 band(10,440,980,64,'SHARED HORIZONTAL AGENTS','blue'),
 box(25,462,180,36,'QA / Test Agent',[],'blue'),box(215,462,180,36,'Docs / Training Agent',[],'blue'),
 box(405,462,180,36,'Support / Triage Agent',[],'blue'),box(595,462,180,36,'Data / Analytics Agent',[],'blue'),box(785,462,190,36,'Eval / Red-team Agent',[],'blue'),
 box(10,516,980,36,'Human experts on call: solution architect, domain SME (accountant, network eng, firmware eng), security lead, SRE (paid per review)',[],'red')
].join(''));

// 4. Harness loop
export const d4 = () => svg(1000,410,[
 box(20,30,150,60,'Task from DAG',['typed spec + acceptance','tests + budget'],'amber'),
 box(210,30,150,60,'Context Builder',['repo map, contracts,','similar past fixes'],'green'),
 box(400,30,160,60,'Model Router',['pick model by task,','cost, eval score'],'green'),
 box(600,30,170,60,'Constrained Decode',['JSON-schema / grammar','masks invalid tokens'],'green'),
 box(810,30,170,60,'Typed Proposal',['patch + tool calls +','rationale (validated)'],'purple'),
 arrow(170,60,210,60),arrow(360,60,400,60),arrow(560,60,600,60),arrow(770,60,810,60),
 box(810,150,170,60,'Policy Check',['allowed paths/tools?','secrets? egress?'],'amber'),
 arrow(895,90,895,150),
 box(600,150,170,60,'Sandbox Run',['microVM: apply patch,','build, run tests'],'green'),
 arrow(810,180,770,180),
 box(400,150,170,60,'Verifier Stack',['compile, types, lint,','unit, property, SAST'],'green'),
 arrow(600,180,570,180),
 box(190,150,170,60,'Judge',['pass / fail + structured','diagnostics'],'purple'),
 arrow(400,180,360,180),
 box(20,150,140,60,'Attempts < N ?',[],'amber'),
 arrow(190,180,160,180),
 box(20,270,200,60,'Retry with diagnostics',['error trace fed back to','Context Builder'],'blue'),
 arrow(90,210,90,270,'yes'),
 `<path d="M60 270 C 30 200, 60 110, 210 75" fill="none" stroke="#2563eb" stroke-width="1.3" stroke-dasharray="4 3" marker-end="url(#ah)"/>`,
 box(300,270,200,60,'Escalate to human',['after N failures or high risk','(with full trace)'],'red'),
 arrow(160,200,320,270,'no'),
 box(600,270,380,60,'Merge > Artifact Registry > next task in DAG',['only when ALL verifiers are green and policy passes'],'teal'),
 arrow(275,210,600,290,'pass','#16a34a'),
 text(20,365,'Every step is traced (prompt, model, tokens, tool calls, verdict), so failures become new eval cases.',{fs:10,c:'#475569'}),
 text(20,384,'Key idea: the model proposes; deterministic code disposes. The model never judges its own output alone.',{fs:10,c:'#475569',b:1})
].join(''));

// 5. Deployment topology
export const d5 = () => svg(1000,580,[
 band(10,8,270,560,'ZONE 0: CLIENT / INTERNET','blue'),
 box(30,40,230,50,'Client browsers + mobile',['portal, previews'],'blue'),
 box(30,110,230,50,'WAF + CDN + API gateway',['TLS, rate limit, SSO'],'blue'),
 box(30,180,230,50,'Client production',['their cloud or ours (K8s)'],'teal'),
 box(30,250,230,50,'Artifact + image registry',['signed images, SBOM'],'teal'),
 box(30,320,230,50,'Client Git remote',['code always owned by client'],'teal'),
 box(30,390,230,50,'Delivery pipeline',['GitOps, canary, rollback'],'teal'),
 box(30,460,230,90,'Monitoring',['Prometheus, Grafana, Loki,','alerts to agents / on-call'],'teal'),
 band(295,8,420,560,'ZONE 1: PLATFORM CORE (private DC / colo)','amber'),
 box(315,40,180,60,'Control-plane cluster',['3-node K8s, Temporal,','Postgres, Redis, NATS'],'amber'),
 box(515,40,180,60,'Agent workers',['stateless CPU pods'],'purple'),
 box(315,120,380,90,'GPU INFERENCE CLUSTER',['Node A: 8x80GB: large reasoning + coder (vLLM/SGLang)','Node B: 4x48GB: small models, embeddings, vision, guard','NVLink in node, 100-200 GbE between nodes','model store on NVMe, router with warm/cold pools'],'red'),
 box(315,230,180,70,'Data plane',['vector DB (pgvector/Qdrant)','object store (MinIO)','Git server (Forgejo/GitLab)'],'amber'),
 box(515,230,180,70,'Observability',['OTel, Langfuse, Loki,','audit log (WORM)'],'amber'),
 box(315,320,380,120,'BUILD & SANDBOX FARM (untrusted code runs here only)',['Firecracker / gVisor microVMs, no default egress','per-tenant network, ephemeral disks, CPU + RAM quotas','package mirror + allowlisted proxy (Nexus / Verdaccio)','64-128 cores, 512 GB-1 TB RAM, NVMe scratch'],'green'),
 box(315,460,380,90,'Secrets + Keys',['Vault / HSM, release-signing keys, no path from sandboxes','Backups 3-2-1, encrypted, restore-tested monthly'],'red'),
 band(730,8,260,560,'TEST LABS (isolated VLANs)','green'),
 box(750,40,220,80,'Mobile lab',['Android device shelf + emulators','2-4 Mac minis (iOS builds)','device farm (STF / Appium)'],'green'),
 box(750,140,220,90,'IoT lab (HIL rack)',['dev boards ESP32/STM32/nRF/RPi','power + serial + logic analyser','Renode/QEMU for scale-out','MQTT + OTA test bed'],'green'),
 box(750,250,220,80,'Network lab',['Containerlab + physical','switch/router/firewall pair','Batfish, traffic generators'],'green'),
 box(750,350,220,90,'Cyber range',['air-gapped, deliberately','vulnerable targets, C2 sim','no route to Zone 0/1'],'red'),
 box(750,460,220,90,'Human workstations',['expert reviewers, SRE','via bastion + MFA only'],'blue'),
 arrow(260,135,315,90,'requests'),arrow(495,70,515,70),arrow(505,210,505,320,'jobs'),arrow(715,380,750,380,'','#64748b',true),arrow(315,400,260,345,'PRs'),arrow(260,275,315,275,'','#64748b')
].join(''));

// 6. ERP waves
export const d6 = () => {
  const w=[['Wave 0','Discovery','Interview, process map, chart of accounts, roles, data migration plan','Wk 1-2'],
  ['Wave 1','Foundation','Auth/RBAC, multi-tenant, audit log, master data, CI/CD','Wk 2-4'],
  ['Wave 2','Core','Inventory, purchasing, sales, invoicing (ERPNext/Odoo modules + customisation)','Wk 4-8'],
  ['Wave 3','Finance & HR','GL, AP/AR, tax rules, payroll: accountant sign-off mandatory','Wk 8-11'],
  ['Wave 4','Integrate','Bank / tax / e-invoice APIs, reports, data import, mobile approvals','Wk 10-13'],
  ['Wave 5','Harden + Launch','Load test, pen-test, UAT, training docs, canary go-live','Wk 13-15'],
  ['Wave 6','Operate','Hypercare, SLOs, monthly releases, ticket-to-patch loop','Wk 16+']];
  let o=''; w.forEach((r,i)=>{const y=14+i*62;
   o+=box(10,y,120,50,r[0],[r[1]],'purple');
   o+=`<rect x="140" y="${y}" width="620" height="50" rx="6" fill="#f8fafc" stroke="#cbd5e1"/>`+text(150,y+30,r[2],{fs:10.5});
   o+=`<rect x="770" y="${y}" width="220" height="50" rx="6" fill="${i==3?'#fee2e2':'#dcfce7'}" stroke="${i==3?'#dc2626':'#16a34a'}"/>`+text(880,y+30,r[3]+(i==3?'  |  human gate':''),{a:'middle',b:1,fs:11});});
  return svg(1000,450,o);
};

// 7. Roadmap
export const d7 = () => {
  const ph=[['Phase 0  Validate','Rent GPUs, benchmark models, build eval set',0,2,'blue'],
   ['Phase 1  Harness MVP','Workflow engine, sandbox, typed I/O, web CRUD generator',2,6,'green'],
   ['Phase 2  ERP vertical','ERP waves, ERPNext/Odoo base, accountant review flow',5,10,'purple'],
   ['Phase 3  Ops + maintenance','Monitoring agents, ticket-to-patch loop, SLA, billing',8,12,'amber'],
   ['Phase 4  Mobile + cyber','Mobile squad (Mac lab), security agent, compliance',10,15,'teal'],
   ['Phase 5  IoT + network','HIL rack, network lab, supervised squads only',13,20,'red'],
   ['Phase 6  Scale','Tier B to C GPUs, multi-tenant SaaS, template marketplace',18,24,'gray']];
  let o=''; for(let m=0;m<=24;m+=3){const x=300+m*(680/24);o+=`<line x1="${x}" y1="30" x2="${x}" y2="380" stroke="#e2e8f0"/>`+text(x,22,'M'+m,{a:'middle',fs:9});}
  ph.forEach((p,i)=>{const y=40+i*48,x=300+p[2]*(680/24),w=(p[3]-p[2])*(680/24);
   o+=text(10,y+18,p[0],{b:1,fs:11,c:'#0f172a'})+text(10,y+31,p[1],{fs:8.5});
   o+=`<rect x="${x}" y="${y+4}" width="${w}" height="30" rx="5" fill="${C[p[4]]}" stroke="${stroke(p[4])}"/>`;});
  o+=text(10,400,'Months from start; phases overlap. Exit criteria: Phase 1 = 70%+ of golden tasks pass unattended; Phase 2 = one pilot ERP live with zero P1 defects for 30 days.',{fs:9.5,c:'#475569'});
  return svg(1000,420,o);
};
