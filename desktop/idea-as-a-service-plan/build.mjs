import { writeFileSync } from 'node:fs';
import { d1, d2, d3, d4, d5, d6, d7 } from './diagrams.mjs';

const table = (head, rows, cls = '') =>
  `<table class="${cls}"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows
    .map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const ul = a => `<ul>${a.map(x => `<li>${x}</li>`).join('')}</ul>`;
const fig = (n, cap, svg) => `<section class="land"><h2>${n}</h2><p class="cap">${cap}</p>${svg}</section>`;

const css = `
@page{size:A4;margin:16mm 15mm}
@page land{size:A4 landscape;margin:10mm 10mm}
*{box-sizing:border-box}
body{font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:10.3pt;line-height:1.45;color:#1e293b;margin:0}
h1{font-size:26pt;margin:0 0 4pt;color:#0f172a;line-height:1.15}
h2{font-size:15pt;color:#1e3a8a;border-bottom:2px solid #bfdbfe;padding-bottom:3pt;margin:18pt 0 8pt;break-after:avoid}
h3{font-size:11.5pt;color:#334155;margin:12pt 0 4pt;break-after:avoid}
p{margin:0 0 7pt}
ul{margin:0 0 8pt;padding-left:16pt}li{margin-bottom:2.5pt}
table{border-collapse:collapse;width:100%;margin:6pt 0 10pt;font-size:8.8pt;break-inside:auto}
tr{break-inside:avoid}
th{background:#1e3a8a;color:#fff;text-align:left;padding:4pt 6pt}
td{border-bottom:1px solid #e2e8f0;padding:3.5pt 6pt;vertical-align:top}
tbody tr:nth-child(even){background:#f8fafc}
.cover{page-break-after:always;padding-top:70mm}
.cover .sub{font-size:13pt;color:#475569;margin-bottom:24pt}
.tag{display:inline-block;background:#dbeafe;color:#1e40af;border-radius:4pt;padding:1pt 6pt;font-size:8.5pt;margin-right:4pt}
.box{border-left:4px solid #2563eb;background:#eff6ff;padding:7pt 10pt;margin:8pt 0;border-radius:0 6pt 6pt 0}
.warn{border-left-color:#d97706;background:#fffbeb}
.land{page:land;break-before:page;break-after:page}
.land h2{margin-top:0}.cap{font-size:9pt;color:#475569;margin-bottom:4pt}
.land svg{width:100%;height:auto;max-height:165mm}
.toc li{margin-bottom:3pt}
code{background:#f1f5f9;padding:0 3pt;border-radius:3pt;font-size:9pt}
.small{font-size:8.5pt;color:#64748b}
`;

const body = [];
body.push(`<div class="cover"><span class="tag">Platform blueprint</span><span class="tag">v1.0</span><h1>Idea-as-a-Service</h1>
<div class="sub">An AI-native software factory that takes a product idea (ERP, web, mobile, IoT, network, cyber) from planning to deployment and maintenance, using local LLMs, type-safe AI, an AI harness and agents, under a proper SDLC.</div>
<p>Contents: vision and scope, architecture (7 diagrams), SDLC with gates, type-safe AI, local models, hardware and software requirements, ERP worked example, maintenance, security and compliance, team and cost, roadmap, risks, 30-day checklist.</p>
<p class="small">All costs, throughputs and timelines are planning estimates (2026 prices) to be validated by benchmarking. Model names date quickly; the architecture does not depend on any single model.</p></div>`);

body.push(`<h2>1. Executive summary</h2>
<p>You asked for an "IaaS" that builds products for people who have no engineering team. I have read this as <b>Idea-as-a-Service</b>: a client brings an idea and receives a running, maintained product. If you meant Infrastructure-as-a-Service, sections 13-14 (hardware, software) and the deployment diagram still apply.</p>
<div class="box"><b>Core design decision.</b> Do not build "one big agent". Build a <b>deterministic control plane</b> (workflow engine, policy gates, typed artifact registry) that <i>employs</i> role-specialised agents, each wrapped in an <b>AI harness</b> that forces typed outputs, runs code only inside sandboxes, and accepts work only when independent verifiers (compilers, type-checkers, tests, scanners) pass. Local open-weight models supply the intelligence; humans sign off at a small number of high-risk gates.</div>
<h3>What the platform delivers</h3>
${ul([
 '<b>Planning:</b> an interviewing agent turns an idea into a PRD, acceptance criteria, a fixed-scope quote and a risk register.',
 '<b>Development:</b> architecture and typed contracts first, then tests, then code, in small reviewed pull requests built inside sandboxes.',
 '<b>Deployment:</b> infrastructure-as-code, signed images, SBOM, canary release, one-click rollback, into the client\'s cloud or yours.',
 '<b>Maintenance:</b> monitoring, ticket triage, ticket-to-patch loop, dependency and security patching, monthly releases, SLOs.',
 '<b>Domains:</b> web/ERP/SaaS first; then mobile, cyber-security products, network automation, IoT/embedded, each with its own tool-and-test squad.'])}
<h3>Honest expectations</h3>
${ul([
 'Agents reliably produce <b>CRUD-heavy business software on mature frameworks</b>. Novel algorithms, deep hardware timing, regulated logic (tax, payroll, medical) still need human experts. The design makes those expert touchpoints explicit and cheap instead of pretending they vanish.',
 'Autonomy is a <b>dial per project and per domain</b>. Start supervised (human approves every merge); raise autonomy only where your own eval results prove it (e.g. 90%+ of golden tasks pass unattended).',
 'For ERP, <b>start from an open-source core</b> (ERPNext or Odoo Community) and customise, instead of generating accounting logic from scratch.',
 'Cyber and network work touching live systems is <b>authorised, scoped and gated</b>; offensive tooling runs only in an isolated range against targets the client owns.'])}
<h3>Recommended path</h3>
<p>Rent an 8-GPU node for 4-8 weeks, benchmark open models on your own task set, build the harness + web/ERP squad, ship one pilot ERP with human gates, then expand domain by domain (roadmap in section 18).</p>`);

body.push(`<h2>2. Scope, personas and principles</h2>
${table(['Persona','Need','What they get'],[
 ['Solo founder / SME owner','Product without hiring','Idea to production, fixed quote, monthly plan'],
 ['Domain expert (clinic, factory, school)','Software that fits their process','Interview-driven ERP/CRM/portal, Indian/local compliance packs'],
 ['Small IT team','Force multiplier','Same platform in "assist" mode on their repo'],
 ['You (platform operator)','Margin and quality','Per-project cost/quality metrics, expert-review marketplace']])}
<h3>Design principles</h3>
${ul([
 '<b>Contracts before code.</b> Every hand-off is a typed artifact (JSON-schema, OpenAPI, protobuf, SQL DDL, IaC), so agents cannot drift.',
 '<b>The model proposes, deterministic code disposes.</b> No LLM approves its own work; compilers, tests and policy engines do.',
 '<b>Tests first.</b> Acceptance criteria become executable tests before implementation starts.',
 '<b>Least privilege + isolation.</b> Generated code and agent tools run in microVM sandboxes with no default network egress.',
 '<b>Local first.</b> Client data and code never leave your infrastructure unless the client opts in to a hosted model.',
 '<b>Everything is traced and replayable.</b> Every prompt, tool call and verdict is logged; every failure becomes a regression eval.',
 '<b>Client owns the output.</b> Code lives in the client\'s repo, standard stack, no lock-in to your platform to keep running.'])}`);

body.push(fig('3. Architecture diagram 1: layered platform', 'Six layers. The control plane (L2) and harness (L4) are ordinary deterministic software; only L3 agents and L5 models are probabilistic.', d1()));
body.push(fig('4. Architecture diagram 2: deployment topology and trust zones', 'Untrusted generated code runs only in the sandbox farm; secrets and signing keys have no route from it. Test labs are isolated VLANs.', d5()));
body.push(fig('5. Architecture diagram 3: lifecycle pipeline (SDLC)', 'Seven stages; each ends in a machine-checkable artifact and a gate. Maintenance feeds back into design.', d2()));

body.push(`<h2>6. SDLC in detail: planning to maintenance</h2>
${table(['Stage','Agents','Key activities','Typed artifacts','Gate (who approves)'],[
 ['1 Intake / plan','Product, Orchestrator','Socratic interview, competitor scan, feasibility, scope + quote, risk register','PRD, user stories, acceptance criteria (Gherkin), estimate','<b>Client</b> approves scope and price'],
 ['2 Design','Architect, Security','C4 diagrams, data model (3NF), API contracts, ADRs, STRIDE threat model, stack choice','OpenAPI/protobuf, SQL DDL, IaC skeleton, threat model','<b>Expert</b> reviews (mandatory for finance, health, IoT safety)'],
 ['3 Build','Domain devs, QA','Tests from acceptance criteria, then implementation in sandbox; small PRs; review agent + static analysis','Green PRs, generated test suite, migration scripts','Automatic: CI + reviewer agent + policy'],
 ['4 Verify','QA, Security','Integration/E2E, load, property + fuzz, SAST/DAST, dependency + licence scan, accessibility, mutation tests','Test report, coverage, security report, SBOM','Auto; <b>expert</b> for high-risk changes; client UAT'],
 ['5 Release','Release/Ops','Terraform, migrations, canary + auto-rollback, signed images, docs and training material','Signed release, runbook, rollback plan','<b>Client + policy</b> approve go-live'],
 ['6 Operate','SRE, Support','SLO monitoring, alert triage, incident response, backup + restore drills, capacity','Dashboards, incident reports, postmortems','On-call human escalation for P1'],
 ['7 Evolve','Product, all','Ticket to spec to patch; dependency updates; feature requests re-enter stage 1/2 by size','Change PRs, release notes','Same gates, scaled by risk']])}
<h3>Human sign-off points (six)</h3>
<p>(1) scope and price, (2) architecture for high-risk domains, (3) regulated logic (tax, payroll, safety-critical firmware), (4) production release, (5) any destructive or security-sensitive action on live systems, (6) model or prompt changes that fail regression evals. Everything else is automated with supervision.</p>
<h3>Autonomy dial</h3>
${table(['Level','Behaviour','Use when'],[
 ['L0 Assist','Agents draft; human does merges and releases','New domain, first pilot'],
 ['L1 Supervised','Agents merge to branch; human approves each release','Default for production'],
 ['L2 Bounded auto','Agents merge and release low-risk changes (patches, deps) automatically','90%+ eval pass rate for that change class'],
 ['L3 Autonomous ops','Auto-remediation runbooks within blast-radius limits','Mature web/ERP squad only']])}`);

body.push(fig('7. Architecture diagram 4: agent organisation', 'Orchestrator + programme agents, one squad per domain with its own toolchain and sandboxes, shared horizontal agents, and paid human experts.', d3()));
body.push(fig('8. Architecture diagram 5: the harness loop for one task', 'How a single unit of work is executed, verified and either merged, retried with diagnostics, or escalated.', d4()));

body.push(`<h2>9. Type-safe AI: six layers of defence</h2>
<p>"Type-safe" here means an LLM output is never trusted as free text. Each layer removes a class of failure; together they push error rates down to what tests and reviewers can catch.</p>
${table(['Layer','Mechanism','Tools (recommended / alternatives)','Failure it prevents'],[
 ['1 Constrained decoding','Compile JSON-schema / grammar to a token mask so invalid output is impossible','XGrammar, Outlines, llguidance built into vLLM/SGLang; llama.cpp GBNF','Malformed JSON, wrong enum, missing fields'],
 ['2 Schema-first agent I/O','Every agent input/output is a versioned schema; validated at the gateway','Pydantic v2 / Zod, JSON Schema, BAML, Instructor','Contract drift between agents'],
 ['3 Contract-first product code','OpenAPI / protobuf / SQL DDL produced by Architect, code generated against it','openapi-generator, buf, Prisma/SQLAlchemy, tRPC','API mismatch between frontend, backend, mobile'],
 ['4 Typed target languages','Prefer TypeScript strict, Rust, Go, Python + mypy/pyright strict; type-check in the loop','tsc, mypy/pyright, cargo check, clippy','Whole class of runtime errors'],
 ['5 Syntactic + structural gates','Tree-sitter parse, lint, formatter, forbidden-API rules','Tree-sitter, ESLint, Ruff, Semgrep custom rules','Broken syntax, banned patterns, secrets in code'],
 ['6 Behavioural verification','Tests written first, plus property tests, mutation tests, golden datasets','pytest, Jest, Hypothesis/fast-check, Stryker/mutmut, Playwright','Logic errors types cannot see']])}
<div class="box warn"><b>Limit:</b> types and schemas guarantee <i>shape</i>, not <i>truth</i>. A perfectly typed tax calculation can still be wrong. That is why acceptance tests, property tests and expert sign-off exist for business-critical logic.</div>`);

body.push(`<h2>10. AI harness and local model plane</h2>
<h3>Harness components</h3>
${table(['Component','Responsibility','Implementation options'],[
 ['Context builder','Repo map, symbol index, contracts, similar past fixes, project memory; keeps prompts small','Tree-sitter + ctags, pgvector/Qdrant, reranker, prefix caching'],
 ['Model router','Chooses model per task by capability, cost, latency and current eval score; falls back on failure','LiteLLM / custom router over vLLM + SGLang endpoints'],
 ['Typed I/O gateway','Constrained decoding + schema validation + retries','XGrammar/Outlines, Pydantic/Zod'],
 ['Tool broker','Exposes only the tools a role needs (git, shell, browser, DB, cloud CLIs) with argument schemas and rate limits; MCP-compatible','MCP servers, OPA policy, custom broker'],
 ['Sandbox runner','Runs build/test/commands in ephemeral isolation, no egress by default','Firecracker, gVisor, Kata, Docker rootless; Tetragon/Falco audit'],
 ['Verifier stack','Independent deterministic checks; the only authority for "done"','CI runners, linters, test frameworks, SAST/DAST'],
 ['Eval + regression','Golden tasks per domain; nightly and per-model-change runs; blocks rollout on regression','Custom harness, promptfoo, SWE-bench-style private set'],
 ['Tracing + cost','Full trace per task, token and GPU cost per project','OpenTelemetry, Langfuse, OpenLLMetry'],
 ['Durable workflow','Long-running, resumable, human-in-the-loop SDLC state machine','Temporal (recommended), Argo Workflows, Prefect']])}
<h3>Local model plane (route by task; re-benchmark quarterly)</h3>
${table(['Role','Model class (examples as of 2026)','Serving footprint','Used by'],[
 ['Large reasoning / planning','Open large MoE: DeepSeek-V3/R1 family, Qwen3 large, GLM, Kimi (FP8/INT4)','8x80GB GPUs (or 4x with INT4); slow, expensive, used sparingly','Product, Architect, Security, hard debugging'],
 ['Coder (workhorse)','Qwen3-Coder / Qwen2.5-Coder 32B, DeepSeek-Coder-V2, Codestral class','1-2x 80GB GPUs per replica; many concurrent requests','Domain devs, QA, DevOps'],
 ['Small / fast','7-14B coder or general (Qwen, Phi, Llama, Gemma)','1 GPU shared','Lint fixes, summaries, commit messages, routing'],
 ['Embeddings + reranker','bge / e5 / Qwen embedding + reranker models','Fraction of a GPU','Code and doc retrieval'],
 ['Vision','Open VLM (Qwen-VL, InternVL, Llama vision)','1 GPU','UI screenshot review, diagram/wireframe ingestion'],
 ['Guard','Llama Guard / ShieldGemma class + rule filters','Fraction of a GPU','Prompt-injection and unsafe-action screening'],
 ['Optional hosted fallback','Frontier API models, opt-in per client, redacted context','None locally','Only when local models fail an eval and client consents']])}
<p>Serving: vLLM or SGLang with continuous batching, paged attention, prefix caching (agents share long system prompts), tensor parallelism inside a node, speculative decoding where useful. Quantise (FP8/AWQ/GPTQ) large models; check quality on <i>your</i> evals before adopting any quantisation. Fine-tuning (LoRA) on accepted PRs and your house frameworks is a Phase 3+ optimisation, not a day-one need.</p>`);

body.push(`<h2>11. Domain squads: what changes per product type</h2>
${table(['Domain','Typical stack generated','Verification environment','Extra gates / cautions'],[
 ['Web / ERP / SaaS','Next.js/React, FastAPI/NestJS/Go, Postgres, Redis, K8s; ERPNext/Odoo as base','Playwright browser farm, ephemeral Postgres, k6 load, OWASP ZAP','Accountant sign-off on tax, payroll, GL; data-migration rehearsal'],
 ['Mobile','Flutter or React Native (native Swift/Kotlin when needed)','Android emulators + real device shelf; <b>Mac minis required for iOS builds</b>; Appium','Store policy review, signing keys held by client, privacy labels'],
 ['IoT / embedded','C/Rust firmware (Zephyr/FreeRTOS/ESP-IDF), MQTT, cloud ingestion, OTA','QEMU/Renode for scale-out + <b>hardware-in-the-loop rack</b> for timing and drivers','Human firmware engineer for safety-critical/real-time; signed OTA + rollback mandatory'],
 ['Network','IaC and config (Ansible, Terraform, NETCONF/gNMI), SDN controllers, monitoring, eBPF tools','Containerlab/GNS3 virtual labs, Batfish config analysis, physical switch/firewall pair','Changes to live networks only via change window + human approval + auto-rollback'],
 ['Cyber-security products','Hardening baselines, detection rules (Sigma/YARA), SIEM pipelines, scanners, secure code fixes','Isolated cyber range with deliberately vulnerable targets; Semgrep, Trivy, ZAP, Nuclei','Authorised targets only, signed scope, kill-switch, offensive tooling never touches Zone 0/1']])}
<p>Cross-domain products (an ERP with a mobile app and IoT gateways) are decomposed by the Orchestrator into per-squad task DAGs that meet at shared typed contracts (API schemas, message schemas).</p>`);

body.push(fig('12. ERP worked example: build in waves', 'From "I need an ERP for my manufacturing plant" to a live system in roughly 15 weeks (pilot estimate; two humans in the loop part-time).', d6()));

body.push(`<h2>13. Hardware requirements</h2>
<p>Three tiers. Do not buy Tier B/C before a rented-GPU pilot proves your task mix and throughput. Prices are 2026 planning ranges; GPU pricing moves fast.</p>
${table(['Component','Tier A: Pilot (1-3 concurrent projects)','Tier B: Production (10-25 projects)','Tier C: Scale (50+ projects)'],[
 ['GPUs','2-4x 48GB workstation/data-centre GPUs (RTX 6000 Ada/Pro, L40S) or rent 8-GPU cloud node','1 node 8x80GB (H100/H200/MI300-class) + 1 node 4x48GB','3-6 nodes 8x H200/B200-class, NVLink, plus small-model pool'],
 ['Reasoning capability','Mid-size models (32-72B) local; large MoE via INT4 on rented node','Large MoE at FP8 locally','Multiple replicas, dedicated pools per model'],
 ['CPU / RAM (per GPU node)','32-64 cores, 256 GB','2x 64-core, 1-2 TB','2x 96-core, 2 TB'],
 ['Sandbox / build farm','1x 64-core, 256-512 GB, 4 TB NVMe','3-4 nodes x 64-128 cores, 512 GB-1 TB','10+ nodes, autoscaled, some in cloud'],
 ['Control plane + data','3 small VMs or 1 server','3-node K8s, HA Postgres, object store 50-100 TB','Multi-AZ, Ceph/MinIO 500 TB+'],
 ['Storage','8-16 TB NVMe','50-100 TB NVMe + 200 TB HDD/object','Distributed NVMe/object, 1 PB+'],
 ['Network','10 GbE','25/100 GbE fabric, redundant ToR switches','100-400 GbE / InfiniBand for GPU nodes'],
 ['Power + cooling','1-2 kW, office/server room OK','~10-14 kW for GPU nodes: <b>needs colocation or dedicated cooling</b>','40-100+ kW, colo or cloud'],
 ['Approx. capex','$20-45k (or $2-5k/month rented)','$300-500k','$1.5-4M (or hybrid with cloud burst)'],
 ['Indicative capacity','~2-4 unattended build streams','~40-80 concurrent agent tasks','200-500+ tasks']])}
<h3>Labs (add per domain, not day one)</h3>
${table(['Lab','Contents','When needed','Approx. cost'],[
 ['Mobile lab','2-4 Mac minis (M-series) for iOS/Xcode, 8-12 Android + 4-6 iOS devices, USB hub / device-farm software','Phase 4','$8-20k'],
 ['IoT HIL rack','Dev boards (ESP32, STM32, nRF52, RPi, Jetson), programmers/debuggers (J-Link), logic analyser, programmable PSU, relay boards, sensors, MQTT/LoRa gateways','Phase 5','$6-20k'],
 ['Network lab','Physical L3 switch + router + firewall pair, Wi-Fi APs, traffic generators; Containerlab for virtual scale','Phase 5','$4-12k'],
 ['Cyber range','Isolated servers (or VLAN) with vulnerable images, C2 simulation, packet capture','Phase 4','$3-10k'],
 ['Ops workstations','Bastion host, hardware keys (YubiKey), monitors for on-call','Phase 0','$3-6k'],
 ['DR / backup','Off-site encrypted backup target, UPS, second-site replica of control plane','Phase 3','$5-25k']])}
<div class="box warn"><b>Rent first:</b> a cloud 8xH100 node is roughly $15-30/hour on demand (less reserved). Four weeks of rented benchmarking costs a small fraction of a purchase and tells you which models and how many GPUs you actually need.</div>`);

body.push(`<h2>14. Software requirements (stack by layer)</h2>
${table(['Layer','Recommended','Alternatives','Notes'],[
 ['OS / virtualisation','Ubuntu 22.04/24.04 LTS, KVM','RHEL/Rocky, Proxmox','NVIDIA driver + CUDA pinned per cluster'],
 ['Container / orchestration','Kubernetes (k3s for pilot, RKE2/upstream for prod), containerd','Nomad, Docker Swarm (pilot only)','GPU operator, Kueue/Volcano for GPU scheduling'],
 ['Model serving','vLLM, SGLang','TGI, llama.cpp (small/edge), TensorRT-LLM','Prefix cache, FP8/AWQ, speculative decoding'],
 ['Constrained decoding','XGrammar / Outlines (via vLLM/SGLang)','llguidance, GBNF, BAML','See section 9'],
 ['Workflow engine','Temporal','Argo Workflows, Prefect, Dagster','Durable, resumable, human-approval signals'],
 ['Agent framework','Own thin orchestration + LangGraph / PydanticAI for role logic','OpenAI-Agents-style SDKs, CrewAI, AutoGen','Keep framework replaceable; state lives in Temporal'],
 ['Tool protocol','MCP servers behind a policy broker','Custom RPC','Every tool has an argument schema + allowlist'],
 ['Sandboxing','Firecracker microVMs, gVisor; Kata for K8s','Docker rootless, Podman','No default egress; per-tenant networks'],
 ['Runtime security','Tetragon / Falco (eBPF), seccomp, AppArmor','Wazuh','Audit exec + network of sandboxes'],
 ['Source control + CI','Forgejo or GitLab CE, Woodpecker/GitLab CI/Tekton','Gitea, GitHub Enterprise','One repo per client project, client is owner'],
 ['Artifact/package mirrors','Harbor, Nexus/Artifactory, Verdaccio, devpi','Cloud registries','Air-gapped builds from mirror'],
 ['Datastores','PostgreSQL + pgvector, Redis, MinIO','Qdrant/Weaviate, Ceph','Backups + PITR'],
 ['Messaging','NATS or Kafka','RabbitMQ','Agent events, telemetry'],
 ['Policy','Open Policy Agent (OPA)','Cedar, Kyverno','Gates, RBAC, egress rules'],
 ['Identity / secrets','Keycloak (SSO), HashiCorp Vault / OpenBao, HSM for signing','Authentik, cloud KMS','Short-lived credentials'],
 ['Observability','OpenTelemetry, Prometheus, Grafana, Loki, Tempo, Langfuse','ELK, SigNoz','Cost + trace per project'],
 ['IaC / GitOps','Terraform/OpenTofu, Ansible, Argo CD/Flux, Helm','Pulumi, Crossplane','Generated for client environments'],
 ['Testing / quality','pytest, Jest/Vitest, Playwright, k6, Hypothesis, Stryker','Cypress, Locust','Test frameworks per target language'],
 ['Security scanning','Semgrep, Trivy, Grype, Gitleaks, OWASP ZAP, Nuclei, Syft (SBOM), Cosign','SonarQube, Snyk (hosted)','SLSA provenance + signed releases'],
 ['Domain tooling','Android SDK + emulators, Xcode (Mac), Flutter/RN; Zephyr/ESP-IDF, QEMU, Renode; Containerlab, Batfish, Scapy','GNS3, PlatformIO','Per squad images'],
 ['Portal / admin UI','Next.js + TypeScript, Postgres, WebSockets/SSE','Any modern stack','Dogfood: build it with the platform later'],
 ['ERP base','ERPNext (Frappe) or Odoo Community','Custom modular monolith','Check licence terms for SaaS resale (Odoo/ERPNext differ)']])}`);

body.push(`<h2>15. Maintenance and operations</h2>
${ul([
 '<b>Monitoring:</b> SLIs/SLOs per product (availability, latency, error rate, data freshness); alerts routed to the SRE agent, then human on-call by severity.',
 '<b>Ticket-to-patch loop:</b> support agent classifies and reproduces a ticket, writes a failing test, dev agent fixes, verifiers run, canary release. Bugs become regression tests permanently.',
 '<b>Routine upkeep:</b> weekly dependency + CVE updates as automated PRs, monthly release train, quarterly disaster-recovery restore drill, annual pen-test by an external human firm.',
 '<b>Incidents:</b> runbooks as code; auto-remediation only inside blast-radius limits (restart, scale, rollback); blameless postmortems generate new tests and runbook edits.',
 '<b>Platform self-maintenance:</b> nightly model/prompt eval, drift alarms, prompt and model versioning, canary of new model versions on shadow traffic before promotion.',
 '<b>Commercial model:</b> build fee (fixed scope) + monthly plan (hosting, monitoring, N change requests, SLA tiers).'])}

<h2>16. Security, compliance and governance</h2>
${table(['Risk','Control'],[
 ['Prompt injection via client docs, web pages, dependency READMEs','Treat all external text as data; guard model + tool allowlist; no tool can exceed role scope; human gate on sensitive actions'],
 ['Malicious or buggy generated code','Sandboxes with no egress, SAST/DAST, dependency allowlist, SBOM, reviewer agent, signed builds'],
 ['Cross-tenant leakage','Per-tenant repos, namespaces, encryption keys, vector-store partitions; no shared long-lived context'],
 ['Secrets exposure','Vault, short-lived tokens, Gitleaks in every PR, secrets never in prompts'],
 ['Supply-chain attacks','Package mirror + pinning + provenance checks (SLSA), Cosign signing, licence scanner'],
 ['Model theft / poisoning','Weights on isolated storage, hash-verified downloads, fine-tune data provenance'],
 ['IP and licensing','Track model licences (some open weights restrict commercial use), OSS licence scan, client owns output contractually'],
 ['Regulatory','Data residency by region, DPDP/GDPR processes, audit log, SOC 2 / ISO 27001 roadmap; sector rules (PCI, HIPAA) handled per-project with expert review'],
 ['Autonomous actions on live systems','Change windows, approvals, blast-radius caps, auto-rollback, global kill-switch']])}

<h2>17. Team, cost and KPIs</h2>
<h3>Minimum team for the pilot (12-16 weeks)</h3>
${table(['Role','FTE','Focus'],[
 ['Platform / ML infra engineer','1','GPUs, vLLM/SGLang, routing, evals'],
 ['Backend + workflow engineer','1','Temporal, control plane, artifact registry, billing'],
 ['Agent / harness engineer','1-2','Prompts, tools, verifiers, sandbox integration'],
 ['DevOps / security engineer','1','K8s, sandboxes, Vault, scanners, IaC'],
 ['Frontend engineer (portal)','0.5-1','Idea portal, approvals, dashboards'],
 ['Domain experts (ERP consultant, accountant)','0.2-0.5','Acceptance tests, sign-off, ERP templates'],
 ['Product owner','0.5','Priorities, pilot client, pricing']])}
<p>Indicative pilot budget: team cost + Tier A hardware or rented GPUs + labs deferred = roughly <b>$250-600k</b> depending on geography. Tier B hardware is added only after the pilot passes exit criteria.</p>
<h3>KPIs</h3>
${table(['Area','KPI','Pilot target'],[
 ['Quality','Golden-task unattended pass rate','&gt;70% (Phase 1), &gt;85% (Phase 3)'],
 ['Quality','Escaped defects per release (P1/P2)','0 P1 in first 30 days'],
 ['Speed','Idea to staging (web CRUD app)','&lt;1 week; ERP core &lt;8 weeks'],
 ['Cost','Compute + human-review cost per delivered feature','Tracked per project, falling monthly'],
 ['Safety','Sandbox escapes / secret leaks','0'],
 ['Ops','MTTR for P2 incidents; SLO attainment','&lt;4 h; 99.5%+'],
 ['Business','Client NPS; gross margin per project','&gt;40 NPS; &gt;50% margin at scale']])}`);

body.push(fig('18. Roadmap (24 months)', 'Validate cheaply, ship one vertical (ERP) end-to-end, then widen domain by domain as evals justify.', d7()));

body.push(`<h2>19. Risks and mitigations</h2>
${table(['Risk','Likelihood / impact','Mitigation'],[
 ['Local models underperform frontier models on hard tasks','High / Medium','Router with per-task evals; opt-in hosted fallback; decompose tasks smaller; fine-tune on accepted PRs'],
 ['Agents loop or burn compute','Medium / Medium','Attempt caps, budgets per task, early escalation, cost dashboards'],
 ['ERP correctness in regulated logic','Medium / High','Open-source ERP core, accountant-authored acceptance tests, mandatory human gate'],
 ['GPU capex wasted or obsolete','Medium / High','Rent first; buy in stages; keep inference behind an abstraction so nodes are swappable'],
 ['Scope creep across too many domains','High / High','One vertical at a time; exit criteria per phase; domain squads only when the lab exists'],
 ['Security incident from generated code','Low-Medium / High','Layered scanning, sandboxing, pen-tests, bug bounty, kill-switch'],
 ['Client expectations of "fully automatic"','High / Medium','Transparent gates, staged deliveries, clear SLAs and change-request rules'],
 ['Talent gap for platform team','Medium / Medium','Start with 4-5 strong generalists; use the platform to build the platform']])}

<h2>20. First 30 days checklist</h2>
${ul([
 '<b>Week 1:</b> Decide product framing (Idea-as-a-Service), pick the ERP vertical and one pilot client/use-case; set up Git, CI, Vault, observability skeleton; rent an 8-GPU node.',
 '<b>Week 1-2:</b> Write 40-60 golden tasks (spec + tests) for web/ERP; benchmark 3-5 open models on them via vLLM with constrained decoding; record pass rate, latency, cost.',
 '<b>Week 2:</b> Build the sandbox runner (Firecracker or gVisor) with no-egress policy and a package mirror; run 100 tasks through it.',
 '<b>Week 2-3:</b> Stand up Temporal; implement the single-task harness loop (diagram 4) end-to-end for one task type (CRUD endpoint + tests).',
 '<b>Week 3:</b> Implement Product + Architect agents with typed schemas (PRD, OpenAPI, DDL); build the approval inbox skeleton.',
 '<b>Week 4:</b> Run the first end-to-end "idea to staging" on a small app at autonomy L0; review every trace; convert failures into new golden tasks.',
 '<b>Week 4:</b> Decide with data: model mix, GPU tier to buy, which gates to keep manual; publish the Phase 1 plan and budget.'])}
<p class="small">Companion files in this folder: <code>Hardware_Software_BOM.csv</code> (sizing table), editable <code>plan.html</code>, and <code>diagrams.mjs</code> / <code>build.mjs</code> to regenerate the PDF after edits.</p>`);

writeFileSync('plan.html', `<!doctype html><html><head><meta charset="utf-8"><title>Idea-as-a-Service Platform Blueprint</title><style>${css}</style></head><body>${body.join('\n')}</body></html>`);

const bom = [
 ['Category','Item','Tier A Pilot','Tier B Production','Tier C Scale','Notes'],
 ['Compute','GPU inference','2-4x 48GB GPUs (or rented 8-GPU node)','1x 8x80GB node + 1x 4x48GB node','3-6x 8-GPU nodes (H200/B200 class)','NVLink inside node'],
 ['Compute','GPU node CPU','32-64 cores','2x 64-core','2x 96-core',''],
 ['Compute','GPU node RAM','256 GB','1-2 TB','2 TB',''],
 ['Compute','Sandbox/build farm','1x 64-core, 256-512 GB','3-4x 64-128 core, 512 GB-1 TB','10+ nodes autoscaled','Firecracker/gVisor'],
 ['Compute','Control plane','3 small VMs','3-node K8s HA','Multi-AZ',''],
 ['Storage','NVMe','8-16 TB','50-100 TB','1 PB+ distributed','Model store + scratch'],
 ['Storage','Object/backup','20 TB','100-200 TB','500 TB+','Encrypted, 3-2-1'],
 ['Network','Fabric','10 GbE','25/100 GbE','100-400 GbE / InfiniBand',''],
 ['Facility','Power','1-2 kW','10-14 kW','40-100+ kW','Colocation for B/C'],
 ['Facility','Approx capex','$20-45k','$300-500k','$1.5-4M','Planning estimate'],
 ['Lab','Mobile lab','-','2-4 Mac minis + device shelf','Larger farm','Phase 4; $8-20k'],
 ['Lab','IoT HIL rack','-','Boards, programmers, PSU, analyser','Multiple racks','Phase 5; $6-20k'],
 ['Lab','Network lab','-','Physical switch/router/firewall + Containerlab','Larger','Phase 5; $4-12k'],
 ['Lab','Cyber range','-','Isolated vulnerable targets','Larger','Phase 4; $3-10k'],
 ['Software','Serving','vLLM / SGLang','vLLM / SGLang','vLLM / SGLang + TensorRT-LLM',''],
 ['Software','Workflow','Temporal','Temporal','Temporal',''],
 ['Software','Sandbox','gVisor / Docker rootless','Firecracker + gVisor','Firecracker + Kata',''],
 ['Software','Source/CI','Forgejo + Woodpecker','GitLab CE + runners','GitLab / multi-region',''],
 ['Software','Observability','Prometheus, Grafana, Langfuse','+ Loki, Tempo, OTel','Full stack HA',''],
 ['Software','Security','Semgrep, Trivy, Gitleaks','+ ZAP, Nuclei, Cosign, Vault','+ HSM, SIEM','']
];
writeFileSync('Hardware_Software_BOM.csv', bom.map(r => r.map(c => `"${c.replace(/"/g,'""')}"`).join(',')).join('\n'));
console.log('built');
