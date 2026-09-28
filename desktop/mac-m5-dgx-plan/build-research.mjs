// Builds Mac-M5-DGX-POC-Research.pdf: node build-research.mjs  (needs Microsoft Edge or Chrome for headless print)
import { writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const table = (head, rows, cls = '') =>
  `<table class="${cls}"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows
    .map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const ul = a => `<ul>${a.map(x => `<li>${x}</li>`).join('')}</ul>`;

// ---- Decode-speed ceilings: tokens/s <= memory bandwidth / bytes read per generated token ----
const devices = [
  { n: 'M5 (base)', bw: 153, mem: 32, c: '#94a3b8' },
  { n: 'M5 Pro', bw: 307, mem: 64, c: '#60a5fa' },
  { n: 'M5 Max', bw: 614, mem: 128, c: '#2563eb' },
  { n: 'DGX Spark', bw: 273, mem: 128, c: '#16a34a' },
];
const models = [
  { n: '8B dense, 4-bit', gb: 4.5, foot: 5 },
  { n: '32B dense, 4-bit', gb: 18, foot: 20 },
  { n: '70B dense, 4-bit', gb: 40, foot: 44 },
  { n: '120B MoE (about 5B active), 4-bit', gb: 2.7, foot: 66 },
];
const ceil = (d, m) => (m.foot + 8 > d.mem ? null : d.bw / m.gb); // 8 GB headroom for OS, KV cache, services

function chart() {
  const W = 760, H = 330, L = 50, B = 60, T = 20, gw = (W - L - 10) / models.length;
  const max = 260, y = v => H - B - (v / max) * (H - B - T);
  let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="Segoe UI,Arial" font-size="11">`;
  for (const t of [0, 50, 100, 150, 200, 250]) {
    s += `<line x1="${L}" x2="${W - 10}" y1="${y(t)}" y2="${y(t)}" stroke="#e2e8f0"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end" fill="#64748b">${t}</text>`;
  }
  models.forEach((m, i) => {
    const bw = (gw - 22) / devices.length;
    devices.forEach((d, j) => {
      const x = L + i * gw + 11 + j * bw, v = ceil(d, m);
      if (v == null) {
        s += `<text x="${x + bw / 2}" y="${H - B - 6}" text-anchor="middle" fill="#94a3b8" font-size="9">no fit</text>`;
      } else {
        s += `<rect x="${x}" y="${y(v)}" width="${bw - 3}" height="${H - B - y(v)}" fill="${d.c}" rx="2"/><text x="${x + (bw - 3) / 2}" y="${y(v) - 4}" text-anchor="middle" fill="#1e293b" font-size="10">${v.toFixed(v < 10 ? 1 : 0)}</text>`;
      }
    });
    const words = m.n.split(', ');
    s += `<text x="${L + i * gw + gw / 2}" y="${H - B + 16}" text-anchor="middle" fill="#334155">${words[0]}</text><text x="${L + i * gw + gw / 2}" y="${H - B + 30}" text-anchor="middle" fill="#64748b">${words[1] ?? ''}</text>`;
  });
  s += `<text x="12" y="${H / 2}" transform="rotate(-90 12 ${H / 2})" text-anchor="middle" fill="#64748b">decode ceiling, tokens/s (single stream)</text>`;
  devices.forEach((d, j) => {
    s += `<rect x="${L + j * 130}" y="${H - 14}" width="10" height="10" fill="${d.c}" rx="2"/><text x="${L + j * 130 + 15}" y="${H - 5}" fill="#334155">${d.n} (${d.bw} GB/s)</text>`;
  });
  return s + '</svg>';
}

function arch() {
  const box = (x, y, w, h, fill, stroke, lines) => {
    let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
    lines.forEach((t, i) => { s += `<text x="${x + w / 2}" y="${y + 20 + i * 15}" text-anchor="middle" font-size="${i ? 10.5 : 12}" font-weight="${i ? 400 : 700}" fill="#0f172a">${t}</text>`; });
    return s;
  };
  const ar = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#475569" stroke-width="1.5" marker-end="url(#a)"/>`;
  return `<svg viewBox="0 0 760 400" xmlns="http://www.w3.org/2000/svg" font-family="Segoe UI,Arial">
<defs><marker id="a" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#475569"/></marker></defs>
${box(20, 15, 720, 62, '#f1f5f9', '#94a3b8', ['Human gates (approve PRD, contracts, staging build)', 'CLI or minimal web UI on the Mac; three approvals per project'])}
${ar(380, 77, 380, 100)}
${box(20, 100, 720, 92, '#eff6ff', '#2563eb', ['MAC M5: control plane (native, no GPU in Docker)', 'State machine + SQLite, model router (roles: plan, code, repair, review), schema validator', 'Rootless Docker sandbox (CPU only, no network), Semgrep / Gitleaks / Trivy, cost log (CSV or Langfuse)', 'MLX-LM server on :8080: alias "fast" (7-14B coder)'])}
${ar(200, 192, 200, 232)}${ar(560, 192, 560, 232)}
<text x="208" y="217" font-size="10" fill="#475569">HTTP, OpenAI-compatible</text><text x="568" y="217" font-size="10" fill="#475569">optional, capped</text>
${box(20, 232, 440, 110, '#f0fdf4', '#16a34a', ['DGX SPARK: inference server (128 GB unified, 273 GB/s)', 'LiteLLM gateway :4000 (aliases, keys, per-call model log)', 'vLLM or SGLang: alias "smart" (large MoE) and "code"', 'Tailscale link; direct cable to Mac optional'])}
${box(490, 232, 250, 110, '#fffbeb', '#d97706', ['Hosted API (fallback)', 'Frontier model for planning / escalation', 'Off by default; monthly hard cap', 'Only if data policy allows'])}
<text x="380" y="378" text-anchor="middle" font-size="10.5" fill="#64748b">Fallback rule: a call to "smart" never silently falls back to "fast" during measured runs.</text>
</svg>`;
}

const rows = (d, f) => models.map(m => f(d, m));
const ceilRows = models.map(m => [m.n, ...devices.map(d => { const v = ceil(d, m); return v == null ? 'no fit' : v.toFixed(v < 10 ? 1 : 0); })]);

const css = `
@page{size:A4;margin:16mm 15mm}
*{box-sizing:border-box}
body{font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:10.3pt;line-height:1.45;color:#1e293b;margin:0}
h1{font-size:26pt;margin:0 0 4pt;color:#0f172a;line-height:1.15}
h2{font-size:15pt;color:#1e3a8a;border-bottom:2px solid #bfdbfe;padding-bottom:3pt;margin:18pt 0 8pt;break-after:avoid}
h3{font-size:11.5pt;color:#334155;margin:12pt 0 4pt;break-after:avoid}
p{margin:0 0 7pt}ul{margin:0 0 8pt;padding-left:16pt}li{margin-bottom:2.5pt}
table{border-collapse:collapse;width:100%;margin:6pt 0 10pt;font-size:8.8pt}
tr{break-inside:avoid}
th{background:#1e3a8a;color:#fff;text-align:left;padding:4pt 6pt}
td{border-bottom:1px solid #e2e8f0;padding:3.5pt 6pt;vertical-align:top}
tbody tr:nth-child(even){background:#f8fafc}
.cover{page-break-after:always;padding-top:60mm}
.cover .sub{font-size:13pt;color:#475569;margin-bottom:20pt}
.tag{display:inline-block;background:#dbeafe;color:#1e40af;border-radius:4pt;padding:1pt 6pt;font-size:8.5pt;margin-right:4pt}
.box{border-left:4px solid #2563eb;background:#eff6ff;padding:7pt 10pt;margin:8pt 0;border-radius:0 6pt 6pt 0;break-inside:avoid}
.warn{border-left-color:#d97706;background:#fffbeb}
svg{width:100%;height:auto;margin:4pt 0;break-inside:avoid}
.cap{font-size:8.5pt;color:#64748b}
code{background:#f1f5f9;padding:0 3pt;border-radius:3pt;font-size:9pt}
a{color:#1d4ed8;text-decoration:none}
`;

const b = [];
b.push(`<div class="cover"><span class="tag">Research report</span><span class="tag">POC + hardware</span>
<h1>Idea-as-a-Service POC on a Mac M5 and an NVIDIA DGX Spark</h1>
<div class="sub">How the low-budget POC plan changes when the inference, sandbox and control plane run on hardware you already own: architecture, performance ceilings, budget, an adapted 8-week plan, benchmark protocol and risks.</div>
<p class="cap">Prepared September 2026. Companion to <b>IaaS-Low-Budget-POC-Plan</b> and <b>mac-m5-dgx-plan/PLAN.md</b>. No benchmarks were run for this report: speed figures are computed ceilings, and third-party numbers are quoted with their source. Prices and specs should be re-checked before purchase.</p></div>`);

b.push(`<h2>1. Executive summary</h2>
<p>The POC must answer one question: can an AI pipeline, with three human approvals, turn a one-page idea into a tested web app on a staging URL at an affordable cost? The original plan spends $220 to $875 mostly on hosted model APIs and GPU rental. A Mac M5 plus a DGX Spark can replace nearly all of that spend.</p>
<div class="box"><b>Recommendation.</b> Run the POC local-first. The <b>Spark</b> serves the large "smart" and "code" models through vLLM or SGLang behind LiteLLM. The <b>Mac</b> hosts the control plane, the sandbox, and a small "fast" model natively with MLX. Keep one capped hosted frontier model as an optional escalation path for planning, and decide at the week-6 gate whether it is needed. Expected incremental cost is about $0 to $40 over eight weeks, plus your time.</div>
${ul([
  '<b>Feasible:</b> a 120B-class MoE model fits in the Spark\'s 128 GB and is reported at roughly 50 to 70 tokens/s single-stream, enough for a pipeline that makes hundreds of calls per project.',
  '<b>Main technical risk:</b> memory bandwidth, not capacity. Large <i>dense</i> models are slow on both machines (section 4). Prefer MoE models and 4-bit weights.',
  '<b>Main measurement risk:</b> a gateway fallback from Spark to the small Mac model would silently lower quality and corrupt the week-6 gate. Log the served model on every call (section 5).',
  '<b>Not a scale test:</b> passing here proves the loop, not the 8-GPU blueprint. Hardware gaps are listed in section 9.'])}
<h3>Scope and assumptions</h3>
${ul([
  'The POC is the Idea-as-a-Service low-budget plan (idea to PRD to typed contracts to tests to code to verify to repair to staging).',
  '"DGX" means a <b>DGX Spark</b> (GB10 Grace Blackwell, 128 GB unified memory, arm64). A DGX Station or rack DGX changes model sizes, not the layout.',
  'The Mac M5 variant is unknown, so all tiers are shown. Hardware is treated as already owned: purchase cost is excluded, and section 7 discusses whether to buy.'])}`);

b.push(`<h2>2. What the POC needs, and how this hardware maps to it</h2>
${table(['POC substitute (from the plan)', 'With Mac M5 + DGX Spark', 'Effect'], [
  ['Hosted open-weight coder API ($80-200)', 'Spark serves a 30B-120B MoE coder/general model; Mac serves a 7-14B model', 'API spend to near $0; no per-token cost'],
  ['Local Ollama 7B-14B on existing machine (Tier 0)', 'Same, but with a much stronger "smart" tier on the Spark', 'Tier 0 quality rises toward Tier 1'],
  ['Frontier model for planning and escalation ($300-400)', 'Optional capped hosted call, or a large local MoE for plan/review', 'Decide from week-6 data'],
  ['Rented GPU benchmarking ($150)', 'Measure self-hosting economics directly on the Spark', 'Removed'],
  ['Rootless Docker sandbox, no egress', 'Unchanged. Runs on the Mac or the Spark (both arm64); needs no GPU', 'No change'],
  ['State machine + SQLite/Postgres', 'Unchanged, on the Mac', 'No change'],
  ['Schema validation + re-ask', 'Add JSON-schema guided decoding in vLLM/SGLang where supported, keep the validator as the gate', 'Fewer retries; validator stays authoritative'],
  ['Staging on a small VPS ($10-20/mo)', 'Local preview on the LAN or Tailscale; VPS only for a public demo', '$0 to $20/mo'],
])}
<p>The 8-GPU inference node, Temporal, Kubernetes, Firecracker and multi-tenant components stay out of scope, exactly as in the POC plan.</p>`);

b.push(`<h2>3. Hardware comparison</h2>
${table(['', 'M5 (base)', 'M5 Pro', 'M5 Max', 'DGX Spark'], [
  ['Role in this POC', 'Control plane, fast model', 'Control plane, fast/mid model', 'Could also host the big model', 'Inference server'],
  ['Max unified memory', 'up to 32 GB*', 'up to 64 GB', 'up to 128 GB', '128 GB LPDDR5x'],
  ['Memory bandwidth', '153 GB/s*', 'up to 307 GB/s', 'up to 614 GB/s', '273 GB/s'],
  ['AI acceleration', 'Neural Accelerator in each GPU core', 'same, more cores', 'same, more cores', '5th-gen Tensor Cores, FP4 (about 1 PFLOP sparse FP4, vendor figure)'],
  ['Software path', 'MLX, Ollama, LM Studio (native macOS)', 'same', 'same', 'CUDA: vLLM, SGLang, TensorRT-LLM, llama.cpp; NGC containers'],
  ['Docker GPU access', 'None (Metal is not exposed)', 'None', 'None', 'Yes, NVIDIA Container Toolkit'],
  ['Reference price (US)', 'MacBook Pro from $1,699', 'from $2,199', 'from $3,599', 'about $4,000-4,700 (varies by report)'],
])}
<p class="cap">Apple figures for M5 Pro and M5 Max are from Apple's March 2026 newsroom release. *M5 base bandwidth and memory ceiling are from Apple's October 2025 launch specification and were not re-fetched. Spark price has changed since launch and is a reported figure. Verify before buying.</p>
<div class="box"><b>Reading the table.</b> The Spark has the same capacity as an M5 Max but under half its bandwidth, so an M5 Max with 128 GB can out-decode a Spark on the same model. The Spark's advantages are CUDA software, FP4 acceleration, batch throughput, containers and being an always-on server. If your Mac is an M5 Max, it is a serious inference node in its own right.</div>`);

b.push(`<h2>4. Performance analysis</h2>
<p>Single-stream decoding reads the active weights once per generated token, so <code>tokens/s &le; memory bandwidth / active bytes per token</code>. The chart applies this to four model classes. It ignores compute, KV cache reads and overhead, so real numbers are lower. "No fit" means weights plus 8 GB headroom exceed device memory.</p>
${chart()}
<p class="cap">Figure 1. Computed decode ceilings (not measurements). Active bytes: 8B = 4.5 GB, 32B = 18 GB, 70B = 40 GB, 120B MoE = 2.7 GB read per token (about 5B active parameters at 4-bit) with a 66 GB resident footprint.</p>
${table(['Model class (tokens/s ceiling)', ...devices.map(d => d.n)], ceilRows)}
<h3>Checking the ceiling against reported results</h3>
${ul([
  'For gpt-oss-120b on a Spark the ceiling is about 100 tokens/s. Reported results: about 50 tokens/s (LMSYS, SGLang), about 52 tokens/s (SGLang, MXFP4), and 68.9 tokens/s with a patched vLLM build (community repository). That is roughly 50-70% of the ceiling, a plausible range for well-tuned engines.',
  'Engine choice matters severalfold: forum and blog reports show the same model much slower on some engines and builds than on others. Treat the serving engine as a benchmarked decision, not a default.',
  'Aggregate throughput scales with concurrency: the same community report gives about 300 tokens/s aggregate at 30 users. A pipeline that runs several stages or ideas in parallel benefits.',
  'Dense 70B on the Spark has a ceiling near 7 tokens/s, which is too slow for interactive work. Use a MoE or a 30B-class model for "code" and "smart".'])}
<h3>What this means for the POC</h3>
<p>A typical run has perhaps 100 to 300 calls, many under 2,000 output tokens. At 30 to 60 tokens/s that is minutes of generation per stage, not hours, so the "under 4 hours from idea to staging" gate is reachable. Prefill on long prompts (PRD plus contracts plus template) is compute-bound and favours the Spark over the base Mac. Measure both (section 8).</p>`);

b.push(`<h2>5. Architecture and model placement</h2>
${arch()}
<p class="cap">Figure 2. POC topology. The Mac owns control and verification; the Spark owns heavy inference.</p>
${table(['Router role', 'Alias', 'Where', 'Model class (examples, verify availability)', 'Why'], [
  ['plan', 'smart', 'Spark', '~100B+ MoE (for example gpt-oss-120b class) or capped hosted frontier model', 'Highest reasoning value per token; few calls'],
  ['code', 'code', 'Spark', '30B-class MoE coder (Qwen3-Coder class)', 'Best quality-to-speed ratio under 273 GB/s'],
  ['repair', 'code', 'Spark', 'Same as code; escalate to smart on 3rd attempt', 'Bounded loop, max 3'],
  ['review', 'smart', 'Spark', 'Different model family from code if possible', 'Reduces correlated errors'],
  ['scratch', 'fast', 'Mac (MLX)', '7-14B coder', 'Cheap lint, summaries, commit messages; keeps working when the Spark is busy'],
])}
<h3>Setup constraints that decide the design</h3>
${ul([
  '<b>Docker on macOS cannot use the Metal GPU.</b> Run the Mac model natively (MLX-LM or Ollama); use Docker on the Mac only for the CPU-only sandbox.',
  '<b>Both machines are arm64,</b> so one <code>linux/arm64</code> sandbox image runs on either. Prefer NGC containers on the Spark because some CUDA wheels lag on arm64.',
  '<b>The Mac cannot join a GPU cluster.</b> It is a client and edge node. Pooling Mac and Spark for one model (for example exo) is experimental and usually slower than the Spark alone; skip it.',
  '<b>Unified memory is shared</b> with the OS and services on both machines. Budget weights, KV cache, Postgres and sandboxes together; do not set vLLM GPU memory use above about 0.6 to 0.7 while other services run.',
  '<b>Network:</b> Tailscale is enough for token traffic. A direct cable is only useful for copying model weights.'])}
<div class="box warn"><b>Gate-corruption hazard.</b> The starter <code>litellm-config.yaml</code> falls back from <code>smart</code> to <code>fast</code>. If the Spark is down or slow, runs would succeed or fail on a much weaker model and the week-6 metrics would be meaningless. During measured runs, disable that fallback (fail the stage instead) and record <code>alias</code>, actual model, engine, tokens and latency on every call in the cost log.</div>
<h3>Structured output</h3>
<p>Both vLLM and SGLang can constrain output to a JSON schema during decoding. Use this for the typed contracts to cut re-ask retries, but keep the post-hoc schema validator as the gate: the POC's rule is that schema-invalid output must never reach a later stage.</p>`);

b.push(`<h2>6. Security and isolation</h2>
${ul([
  'Generated code runs only in rootless Docker with no network, CPU, memory and time limits, a read-only root and no host mounts. Never mount secrets or the model cache.',
  'Do not run the sandbox on the same account that holds API keys. Keep the hosted-API key out of the sandbox environment.',
  'Expose nothing to the public internet. LiteLLM on :4000 is reachable over Tailscale only; use a master key and per-project virtual keys with budgets.',
  'Treat LLM output and any fetched web content as untrusted. Prompt-injected specs must not be able to change gate settings or router configuration.',
  'gVisor is a later hardening step, needed only when running third-party code (out of POC scope).'])}`);

b.push(`<h2>7. Budget</h2>
${table(['Item (8 weeks)', 'Original Tier 1 Lean', 'Original Tier 2 Standard', 'Mac + Spark, local-only', 'Mac + Spark, plus capped frontier'], [
  ['Inference', '$80-120 hosted', '$450-600 hosted + frontier', '$0', '$50-150 capped'],
  ['GPU benchmarking', '-', '$150', '$0 (own Spark)', '$0'],
  ['Staging / Forgejo', '$10-20/mo', '$10-20/mo', '$0 (LAN) or optional VPS', 'same'],
  ['Electricity', '-', '-', 'about $10-25 (Spark about 100-240 W under load; Mac far less)', 'same'],
  ['Domain (optional)', 'about $12/yr', 'about $12/yr', 'optional', 'optional'],
  ['<b>Total incremental</b>', '<b>about $220</b>', '<b>about $875</b>', '<b>about $0-40</b>', '<b>about $60-200</b>'],
])}
<p class="cap">Original tiers are from POC_Budget.csv. Electricity is an estimate at typical US rates; recompute for your tariff. Hardware purchase is excluded.</p>
<h3>Should you buy hardware for this POC?</h3>
<p>No. If you do not already own the machines, the POC is cheaper on hosted open-weight APIs ($80-120) than on a $4,000+ Spark. Buy only if you also need private local inference, fine-tuning, or steady spend above roughly $500 a month, which is the plan's own revisit trigger. If you own only the Mac, an M5 Max with 128 GB can serve the "smart" tier by itself; a base M5 should use Tier 1 hosted models for anything above 14B.</p>`);

b.push(`<h2>8. Adapted 8-week plan and benchmark protocol</h2>
${table(['Week', 'Goal (POC plan)', 'Mac + Spark additions'], [
  ['1', 'Stack, demo domain, three test ideas, repo, Compose, router with 2 providers', 'Bring up Tailscale, vLLM/SGLang on Spark, MLX on Mac, LiteLLM. Run the benchmark protocol below. Choose engine and models from data.'],
  ['2', 'Idea to PRD to typed contracts with validation', 'Compare guided decoding vs validate-and-re-ask on retry rate and latency.'],
  ['3', 'Tests-first code generation, sandbox, real token cost', 'Compare "code" candidates on the template task. Record tokens and wall-clock per stage.'],
  ['4', 'Repair loop (max 3), Semgrep/Gitleaks, failure taxonomy', 'Test escalation of the 3rd repair attempt to "smart". Log per-alias fix rate.'],
  ['5', 'Human gates, staging deploy, minimal UI or CLI', 'Deploy preview on Tailscale/LAN; VPS only if a public demo is needed.'],
  ['6', '3 ideas x 3 runs, metrics, go/no-go', 'Fallback disabled. Report metrics per model configuration.'],
  ['7-8', 'If go: second stack, frontier planning, GPU cost benchmark, demo', 'Compare local-only vs capped-frontier planning quality and cost. Write up the scale gaps (section 9).'],
])}
<h3>Week-1 benchmark protocol</h3>
${ul([
  '<b>Prompts:</b> three fixed sets (short chat, PRD-sized 3-4k token context, template-plus-contracts 8-12k token context), each run 5 times after a warm-up.',
  '<b>Metrics:</b> time to first token, decode tokens/s, prefill tokens/s, peak memory, and (Spark) power. Record at concurrency 1, 4 and 8.',
  '<b>Matrix:</b> Mac fast model on MLX vs Ollama; Spark candidate models on vLLM vs SGLang vs llama.cpp. Keep quantization and context length identical within a comparison.',
  '<b>Quality check:</b> run the same 10 template tasks on each candidate and count passing generated tests; speed is worthless if pass rate collapses.',
  '<b>Output:</b> a <code>docs/benchmarks.md</code> table and the chosen router configuration, committed before week 2.'])}
<h3>Week-6 gate (unchanged from the POC plan)</h3>
${table(['Metric', 'Pass', 'Kill or rethink'], [
  ['Ideas reaching a working staging app (of 3)', '2 or more', '0 or 1'],
  ['Generated tests passing after repair', '85% or more', 'below 60%'],
  ['Extra human interventions per project', 'fewer than 5', '10 or more'],
  ['Cost per project (tokens plus compute)', 'under $100', 'over $250'],
  ['Time from idea to staging', 'under 4 hours', 'more than 2 days'],
  ['Schema-invalid output reaching later stages', '0', 'any'],
])}
<p>With local inference, "cost per project" is dominated by electricity and your time, so also record cost as if the same tokens had been bought from a hosted API. That is the number a customer-facing business case needs.</p>`);

b.push(`<h2>9. Risks, gaps and open questions</h2>
${table(['Risk', 'Mitigation'], [
  ['Memory bandwidth makes dense 70B unusable', 'MoE and 30B-class models; 4-bit weights; check the ceiling table before choosing a model'],
  ['Serving-engine performance varies widely on the Spark (new GB10 kernels)', 'Benchmark vLLM, SGLang and llama.cpp in week 1; pin image tags; keep a fallback engine'],
  ['Silent fallback to a weaker model corrupts metrics', 'Disable fallback during gate runs; log actual model on every call'],
  ['arm64 or CUDA package gaps', 'NGC containers; check tool support before adopting'],
  ['Unified-memory contention (model, KV cache, services)', 'Cap GPU memory fraction, limit context, watch swap and OOM'],
  ['Local model quality below frontier for planning', 'Template-first and tests-first design; capped frontier escalation; measure the gap in weeks 7-8'],
  ['Results do not transfer to the 8-GPU blueprint', 'Treat as loop validation only. Concurrency, multi-tenant isolation and 70B+ dense serving remain untested'],
  ['Stale specs and prices', 'Re-verify hardware prices, model names and engine versions at week 1'],
])}
<h3>Open questions</h3>
${ul([
  'Which M5 variant and how much RAM? (Decides whether the Mac can host anything above 14B.)',
  'Is a hosted frontier fallback allowed by data policy, and what is the monthly cap?',
  'Is the DGX definitely a Spark, and is it dedicated to this work?',
  'Which demo domain and stack (recommended: FastAPI or Node with SQLite/Postgres and a simple UI)?'])}
<h3>Sources</h3>
${ul([
  '<a href="https://www.apple.com/newsroom/2026/03/apple-introduces-macbook-pro-with-all-new-m5-pro-and-m5-max/">Apple Newsroom: MacBook Pro with M5 Pro and M5 Max (March 2026)</a>',
  '<a href="https://www.lmsys.org/blog/2025-11-03-gpt-oss-on-nvidia-dgx-spark/">LMSYS: Optimizing GPT-OSS on NVIDIA DGX Spark</a>',
  '<a href="https://github.com/luka-loehr/gptoss-spark">Community repository: gpt-oss-120b on one DGX Spark with patched vLLM (68.9 tok/s single-stream, 300 tok/s at 30 users)</a>',
  '<a href="https://github.com/christopherowen/spark-vllm-mxfp4-docker/blob/main/docs/analysis/SGLANG_ANALYSIS.md">SGLang analysis, SM121 / gpt-oss-120b on DGX Spark</a>',
  '<a href="https://dendro-logic.com/engineering/nvidia-dgx-spark-concurrency-benchmark/">Dendro Logic: DGX Spark concurrency benchmark</a>',
  'Repository files: idea-as-a-service-plan/poc.html, POC_Budget.csv; mac-m5-dgx-plan/PLAN.md and starter/'])}
<p class="cap">Community benchmark figures come from search summaries of the linked pages and were not independently reproduced.</p>`);

const html = `<!doctype html><html><head><meta charset="utf-8"><title>IaaS POC on Mac M5 + DGX Spark: Research Report</title><style>${css}</style></head><body>${b.join('\n')}</body></html>`;
const htmlPath = join(here, 'research.html');
const pdfPath = join(here, 'Mac-M5-DGX-POC-Research.pdf');
writeFileSync(htmlPath, html);

const browsers = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];
const exe = browsers.find(existsSync);
if (!exe) throw new Error('Edge or Chrome not found');
execFileSync(exe, ['--headless', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${pdfPath}`, pathToFileURL(htmlPath).href], { stdio: 'inherit' });
console.log('wrote', pdfPath);
