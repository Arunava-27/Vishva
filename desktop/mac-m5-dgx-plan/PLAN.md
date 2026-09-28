# Plan: Mac M5 + NVIDIA DGX local AI platform

**Assumption:** the DGX is a **DGX Spark** (GB10, 128 GB unified memory, arm64, DGX OS). If it is a DGX Station or a rack DGX, the layout stays the same. Only model sizes, networking and cluster options change.

## 1. Architecture

```
            Unified interface: Open WebUI + IDE/CLI clients + agent dashboard
                                   |  HTTPS (Tailscale + Caddy)
                     LiteLLM gateway (one OpenAI-compatible API)
                aliases · fallbacks · keys · budgets · Langfuse tracing
                    |                          |                 |
        MAC M5 (workstation)         DGX (compute server)     Cloud API
        MLX / Ollama (native)        vLLM / SGLang / NIM      (optional fallback)
        agents (dev), MCP tools      embeddings, batch, tuning
                                     Postgres/pgvector, MinIO
```

**Principle:** the Mac is your workstation and control plane. The DGX is the always-on compute server. Every client talks to one endpoint and picks a model by alias (`fast`, `smart`, `code`, `embed`) without knowing where it runs.

## 2. Workload placement

| Workload | Mac M5 | DGX |
|---|---|---|
| Small/medium interactive models (7-32B, quantized) | MLX, low latency | also fine |
| Large models (70B-120B), long context | no | vLLM / TensorRT-LLM (FP8/FP4) |
| Embeddings, reranking | no | always-on |
| Fine-tuning (LoRA/QLoRA), evals, batch jobs | light LoRA only | yes |
| Agent logic | dev and interactive | long-running, in containers |
| MCP tool servers | local files, git, editor | data services, builds |
| Vector DB, Postgres, object storage | no | yes |

**Constraints to plan around**
- Docker on macOS cannot reach the Metal GPU. Run Mac models natively (MLX, Ollama, LM Studio), never in containers.
- Both machines are arm64, so one `linux/arm64` image runs on either. The DGX runs GPU containers through the NVIDIA Container Toolkit. Prefer NGC images because some CUDA wheels lag on arm64.
- The Mac cannot join a GPU cluster. Treat it as a client and edge node, not a Kubernetes worker.

## 3. Software stack

| Layer | Choice | Notes |
|---|---|---|
| Network | Tailscale + MagicDNS | No open ports. Add a direct 10GbE link Mac to DGX for bulk transfers if the Mac has one. |
| TLS / proxy | Caddy | One hostname per service. |
| Inference (DGX) | vLLM first, then SGLang or TensorRT-LLM | Ollama/llama.cpp for quick trials. |
| Inference (Mac) | MLX-LM or Ollama | Small, fast, private models. |
| Gateway | LiteLLM proxy | Aliases, fallbacks, virtual keys, budgets. |
| Chat UI | Open WebUI | RAG, tools, multi-user. |
| Agents | LangGraph, or Claude Agent SDK / OpenAI Agents SDK pointed at LiteLLM | Tools exposed over MCP. |
| Agent state | Postgres checkpoints, MinIO artifacts | Durable, resumable runs. Add Temporal only if needed. |
| Observability | Langfuse, Prometheus, Grafana, DCGM exporter | GPU, latency, tokens and cost in one place. |
| Evals | promptfoo, lm-eval-harness, Inspect AI | Run on every model or prompt change. |
| Containers | Docker Compose, then k3s when Compose is outgrown | Start simple. |
| Reproducibility | Git repo with compose files, Ansible, `just` | Rebuild from scratch in an hour. |

## 4. Agent harness

1. **Model access:** agents only call the LiteLLM gateway, never a specific engine.
2. **Tools:** MCP servers with least privilege (filesystem, git, browser, shell, your data). Destructive tools need human approval.
3. **Sandbox:** code execution in containers with no host mounts, no network by default, read-only root, CPU/RAM/time limits. Use gVisor (`runsc`) on the DGX for stronger isolation.
4. **State:** LangGraph checkpoints in Postgres so runs resume after a crash.
5. **Verification:** tests or diff checks after every code-producing step, with a capped retry loop (3 attempts).
6. **Traces and evals:** every run traced in Langfuse. A golden-task eval suite gates changes.

## 5. Phases

**Phase 0: Foundations (days 1-2)**
- Update DGX OS and macOS. Verify `nvidia-smi` and GPU access from Docker.
- Install Tailscale on both machines. Cable them directly if possible.
- Create a monorepo: `infra/`, `agents/`, `evals/`, `docs/`. Set up secrets (1Password CLI or sops+age).
- *Done when:* a GPU container runs `nvidia-smi` on the DGX and both machines resolve each other by name.

**Phase 1: Inference plane (week 1)**
- DGX: vLLM with a general model, a coder model and an embedding model.
- Mac: MLX-LM serving a fast small model.
- *Done when:* tokens/s and time-to-first-token are measured on both and recorded in `docs/benchmarks.md`.

**Phase 2: Gateway and UI (weeks 1-2)**
- Deploy LiteLLM with aliases and fallbacks (`smart` to DGX big model to cloud, if allowed), Open WebUI and Langfuse.
- Point IDE and CLI tools at the gateway.
- *Done when:* any client works with any model by changing only the alias, and every call shows up in Langfuse.

**Phase 3: Data and RAG (weeks 2-3)**
- Postgres + pgvector, MinIO, an ingestion pipeline (docling or unstructured), embedding and reranker services.
- Expose retrieval to the UI and as an MCP server.
- *Done when:* a question over your own documents returns cited answers.

**Phase 4: Agents and harness (weeks 3-5)**
- MCP server library, sandbox runner, checkpointed LangGraph agents. Start with a coding agent and a research agent.
- Eval suite of golden tasks with a regression gate.
- *Done when:* each reference agent passes its eval suite and a crashed run resumes.

**Phase 5: Fine-tuning (weeks 5-6)**
- LoRA/QLoRA pipeline on the DGX with MLflow tracking. Merge, quantize, and publish adapters as new LiteLLM aliases.
- *Done when:* a tuned model beats the base model on your evals and is selectable by alias.

**Phase 6: Scale-out (later, only if needed)**
- k3s with the DGX as the GPU node. Add a second Spark over the 200GbE ConnectX-7 link for tensor-parallel 200B+ models.
- exo can pool the Mac and DGX for one model, but it is experimental and usually slower than the DGX alone.

## 6. Security and reliability
- Nothing is exposed to the public internet. Use Tailscale ACLs, and per-user accounts (Open WebUI or Authentik) if others use it.
- Agents run unprivileged in sandboxes. Gate destructive tools behind approval.
- Back up Postgres and MinIO nightly to a separate disk or machine. Everything else is rebuilt from git.
- Health checks and restart policies on all services. Alert on GPU temperature, OOM and gateway 5xx.

## 7. Main risks
- **Memory bandwidth:** the Spark has 128 GB but about 273 GB/s bandwidth, so large dense models decode slowly. Prefer MoE models and FP4/FP8 quantization.
- **Unified memory contention:** GPU and CPU share the 128 GB. Budget model weights, KV cache and services together.
- **arm64 gaps:** some wheels and images lag. Use NGC containers and check support before choosing a tool.
- **Complexity creep:** do not add Kubernetes or Temporal until Compose is a real bottleneck.

## 8. Open questions
1. Which DGX (Spark, Station, rack), and how many?
2. Which M5 variant and how much RAM?
3. Main use: coding agents, research/RAG, fine-tuning, or a multi-user service?
4. May the gateway fall back to a cloud API, or must everything stay local?

## 9. Starter files
`starter/docker-compose.dgx.yml`, `starter/litellm-config.yaml` and `starter/.env.example` are a minimal Phase 1-2 stack (vLLM, LiteLLM, Postgres). Model names and image tags are placeholders. Check them against NVIDIA's DGX Spark playbooks before running.
