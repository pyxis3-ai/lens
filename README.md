<div align="center">

# lens

**Lightweight in-cluster observability for LLM &amp; AI/ML serving on Kubernetes.**

LLM endpoint discovery · full resource browser · in-browser `kubectl exec` · service health board · host metrics &amp; alerts · nginx/WAF &amp; fail2ban security

[![Site](https://img.shields.io/badge/lens.pyxis3.ai-10b981?style=flat-square&logo=googlechrome&logoColor=white)](https://lens.pyxis3.ai/?utm_source=github&utm_medium=readme&utm_campaign=lens)
[![Demo](https://img.shields.io/badge/demo-app.lens.pyxis3.ai-326CE5?style=flat-square&logo=kubernetes&logoColor=white)](https://app.lens.pyxis3.ai/?utm_source=github&utm_medium=readme&utm_campaign=lens)
[![License: MIT](https://img.shields.io/badge/License-MIT-3da639?style=flat-square)](LICENSE)
[![Bun](https://img.shields.io/badge/Bun-14151a?logo=bun&logoColor=fbf0df&style=flat-square)](https://bun.sh)
[![Vue 3](https://img.shields.io/badge/Vue%203-4FC08D?logo=vuedotjs&logoColor=fff&style=flat-square)](https://vuejs.org)
[![Kubernetes](https://img.shields.io/badge/Kubernetes-326CE5?logo=kubernetes&logoColor=fff&style=flat-square)](https://kubernetes.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=fff&style=flat-square)](https://www.typescriptlang.org)

<sub>

[**What it does**](#what-it-does) · [**Why**](#why-this-exists) · [**Architecture**](#architecture) · [**Configuration**](#configuration) · [**Run locally**](#run-locally) · [**In cluster**](#run-in-cluster) · [**Where it fits**](#where-it-fits)

</sub>

</div>

<p align="center"><img src="assets/dashboard.png" alt="lens - LLM endpoint discovery: runtime, model list, and probe latency for every inference Service, with a live system bar and workload tabs" width="860" /></p>

---

A single Bun process, running inside the cluster, that serves a Vue 3 dashboard plus the REST/WebSocket APIs behind it. It is read-only by default and built for the operational pattern of running open-source LLM inference on Kubernetes (vLLM, TGI, llama.cpp, Ollama): discover every inference endpoint, browse and `kubectl exec` into workloads, watch host pressure and per-service health, and triage ingress/WAF/SSH security - all from the browser, with no Electron download, no metrics-server, and no separate auth proxy.

**Demo - [app.lens.pyxis3.ai](https://app.lens.pyxis3.ai/?utm_source=github&utm_medium=readme&utm_campaign=lens)** · login required (the live cluster gates every app behind an SSO forward-auth gateway - one-factor, staff/admins; exec gives shell access to the live cluster). **Site - [lens.pyxis3.ai](https://lens.pyxis3.ai/?utm_source=github&utm_medium=readme&utm_campaign=lens)**.

## What it does

- **LLM / inference endpoint discovery** - scans every cluster `Service` on its declared TCP ports for an OpenAI-compatible `/v1/models` response, ranking candidates by image heuristics (vllm / tgi / llama-server / ollama / sglang first) and probing in batches with a short timeout. Reports the model list, probe latency, and inferred runtime - from `owned_by`, then the `Server` header, then the image - refreshed every 30s and cached, with a manual rescan. No outbound traffic, no tokens spent. *This is the headline view for an LLM-serving cluster.*
- **Full resource browser** - pods, deployments, statefulsets, daemonsets, replicasets, services, ingresses, configmaps, secrets, PVCs, cronjobs, jobs, nodes, certificates, and events - each with a `kubectl describe` view, plus a raw `/api/v1/...` passthrough for anything not surfaced. Built to make the inference layer legible (which pod is `ContainerCreating` vs. actually serving, KEDA scalers, per-tenant `ResourceQuotas`).
- **In-browser `kubectl exec`** - a real shell on any pod via `xterm.js` over WebSocket. Critical for AI/ML serving when you need to inspect model weights, tokenizer state, or attach to a running vLLM process. Pod **log tailing** sits alongside it.
- **Workload actions** - restart or scale a Deployment, or delete a stuck Pod, from the browser. **Gated behind RBAC** (the default ClusterRole is read-only, so these are no-ops until you grant write access) and capped at a safe replica ceiling.
- **Service health board** - discovers every host across your Ingresses, probes its health path over HTTPS, and reports status + latency - an at-a-glance uptime board for everything the cluster exposes, refreshed every 30s.
- **Host metrics & alerts** - node CPU (aggregate + per-core), memory, swap, disk, and load read straight from the host `/proc` every 2s - **no metrics-server required** (so no per-pod live usage; GPU shows by request/allocation). Per-metric `warn`/`crit` **thresholds** are configurable and persisted, raising alerts you can acknowledge or dismiss, streamed live over WebSocket and optionally posted to a webhook.
- **Security suite** - **fail2ban** jail summary (banned IPs and probe counts), **nginx ingress** access-log analytics (traffic by status / host / IP / path / user-agent / TLS version, bytes, response and upstream times, and **ModSecurity WAF** blocks), a persisted **attack log** with retention, and **TLS certificate expiry** warnings.
- **Live & lightweight** - expensive scans are TTL-cached; system metrics, pods, health, and alerts stream over a single WebSocket; history persists in an embedded SQLite file.

## Why this exists

The big Kubernetes dashboards (Lens Desktop, Headlamp, Octant) are general-purpose and heavy. AI/ML serving has different debugging needs:

- Inference pods are large (multi-GB model weights), slow to start, and you need to know *exactly* which one is in `ContainerCreating` versus actually serving traffic.
- `kubectl exec` is the fastest way to confirm a vLLM/TGI process is healthy without exporting `/metrics` for every diagnostic.
- Multi-tenant LLM serving leans on `ResourceQuotas` and `KEDA` - you want pressure visible per namespace, not just per node - and the box itself (host load, ingress traffic, SSH/WAF noise) matters as much as the pods.

lens is single-binary scope: enough to operate an LLM-serving cluster from inside it, without a 200 MB Electron download or a separate auth proxy.

## Architecture

```
┌──────────────┐  HTTPS / WS   ┌────────────────────────────┐  K8s API   ┌─────────────┐
│  Vue 3 SPA   │ ────────────> │  Bun server (TypeScript)   │ ─────────> │ K8s control │
│  xterm.js    │ <──────────── │  • REST proxy + describe   │ <───────── │   plane     │
└──────────────┘   live feed   │  • exec / log WS bridge    │            └─────────────┘
                               │  • metrics + alert loop    │  host /proc, /var/log
                               │  • health + security scans │ <───────────────────────
                               │  • SQLite (history)        │
                               └────────────────────────────┘
```

One process does everything. It authenticates to the API server with the service-account token mounted at `/var/run/secrets/kubernetes.io/serviceaccount/token` (cached and refreshed) - no external secrets store. A background loop samples host `/proc` and pushes metrics, alerts, and health over the WebSocket; scans (LLM, nginx logs, fail2ban) are memoized with short TTLs; thresholds and the attack log persist in an embedded `bun:sqlite` database.

### LLM-endpoint discovery (`/api/llm`)

The server enumerates every cluster `Service`, ranks candidates by container-image heuristics, probes `http://<svc>.<ns>.svc.cluster.local:<port>/v1/models` with a short timeout in batches, and reports the parsed model list plus the time-to-first-byte. Runtime is identified from `data[0].owned_by` (authoritative), then the `Server` header, then the image name. Results are cached; `↻ rescan` bypasses the cache.

## Configuration

Everything is environment-driven, with sane in-cluster defaults; nothing is required to boot.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3002` | HTTP/WS listen port |
| `DB_PATH` | `/data/lens.db` | SQLite file (thresholds + attack log) |
| `HOST_PROC` | `/proc` | host `/proc` mount for node metrics |
| `F2B_LOG` | `/host-var-log/fail2ban.log` | fail2ban log to parse |
| `AUTH_LOG` | `/host-var-log/auth.log` | host auth log |
| `NGINX_NAMESPACE` / `NGINX_LABEL` | `nginx-ingress` / `app=nginx-ingress` | where to find the ingress controller for access logs |
| `ALERT_WEBHOOK` | — | optional URL to POST threshold alerts |
| `K8S_API` / `K8S_WS` / `K8S_TOKEN_PATH` | in-cluster defaults | API server + service-account token |
| `API_SECRET` | — | optional shared secret to guard the API |

Alert thresholds (CPU / memory / disk / swap / load) ship with defaults and are editable at runtime - changes persist to `DB_PATH`.

## Run locally

Requires [Bun](https://bun.sh/) and access to a Kubernetes cluster (a `kind` / `k3d` / `k0s` cluster is fine).

```sh
bun install
bun run dev       # frontend (Vite, HMR)
bun run server    # backend (Bun) on :3002
```

## Run in cluster

```sh
docker build -t lens:dev .
```

Deploy as a `Deployment` + `ServiceAccount`. Bind a **read-only** `ClusterRole` by default; grant `patch`/`delete` only if you want the workload actions live. For full coverage, mount the host `/proc` (metrics) and the node's `/var/log` (fail2ban), and give the SA read access to the ingress-controller namespace (nginx logs).

## Where it fits

Open-source AI-/LLM-infrastructure tooling published by [PYXIS3](https://pyxis3.ai/?utm_source=github&utm_medium=readme&utm_campaign=lens). lens is the in-cluster operations layer for a Kubernetes cluster serving vLLM / TGI / llama.cpp / Ollama side by side.

## Status

Single-developer project, used in production on the PYXIS3 homelab cluster. Read-only by default; `exec` and all write actions (scale / restart / delete) are gated behind RBAC.

## Contributing

Issues, ideas, and PRs are welcome - keep PRs focused on a single concern and follow the existing conventions. Run `bun run build` and `bunx tsc --noEmit` before submitting. Since lens talks to a live Kubernetes API, verifying against a real (or `kind` / `k3d` / `k0s`) cluster is especially valued.

## Support & sponsors

lens is free, open-source, and has no tracking or ads. If it's useful to you, you can support continued development - pay what you like, once or monthly:

<p align="center">
  <a href="https://donate.stripe.com/3cI6oI7Gh1PG0eV8MJ5kk00"><img src="https://img.shields.io/badge/%20Donate%20once-pay%20what%20you%20like-635bff?logo=stripe&logoColor=white" alt="Donate once via Stripe" height="30" /></a>
  &nbsp;
  <a href="https://buy.stripe.com/00wbJ2f8J51S9Pv1kh5kk01"><img src="https://img.shields.io/badge/%20Sponsor%20monthly-recurring-56c4e6?logo=stripe&logoColor=white" alt="Sponsor monthly via Stripe" height="30" /></a>
</p>

## License

[MIT](LICENSE) © 2026 Omar A.
