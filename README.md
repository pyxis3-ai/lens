# lens

**Lightweight in-cluster observability for LLM and AI/ML serving on Kubernetes.** Read-only views over your serving cluster's resources, GPU pressure visibility, and an in-browser `kubectl exec` terminal — all served from a single Bun process running inside the cluster.

Built for the operational pattern Pyxis3 uses to run model-agnostic LLM serving infrastructure: open-source inference runtimes (vLLM, TGI, llama.cpp, Ollama) on Kubernetes, where you need a fast way to inspect inference pods, tail accelerator-bound workloads, and exec into a model server without leaving the browser.

**Demo: [lens.pyxis3.ai](https://lens.pyxis3.ai)** (gated — exec gives shell access to the live cluster).

## What it does

- **Pod & workload browser** — namespaces, pods, deployments, services, configmaps, events. Built to surface the inference layer (vLLM/TGI/llama.cpp pods, KEDA scalers, ResourceQuotas per tenant).
- **In-browser `kubectl exec`** — open a real shell on any pod via `xterm.js` over WebSocket. Critical for AI/ML serving where you need to inspect model weights, tokenizer state, or attach to a running vLLM process.
- **Resource pressure** — per-namespace CPU/memory pressure, surfaced for multi-tenant serving where one heavy inference workload can starve neighbours.
- **Security panel** — failed-auth events from collected log streams; helps when fronting LLM endpoints with auth_request.
- Vue 3 + Vite frontend; Bun TypeScript backend.

## Why this exists

The big Kubernetes dashboards (Lens Desktop, Headlamp, Octant) are general-purpose and heavy. AI/ML serving has different debugging needs:

- Inference pods are large (multi-GB model weights), slow to start, and you need to know *exactly* which one is in `ContainerCreating` versus actually serving traffic.
- `kubectl exec` is the fastest way to confirm a vLLM/TGI process is healthy without exporting `/metrics` for every diagnostic.
- Multi-tenant LLM serving uses `ResourceQuotas` and `KEDA` heavily — you want pressure visible per namespace, not just per node.

lens is single-binary scope: enough to debug an LLM-serving cluster from inside it, without a 200 MB Electron download or a separate auth proxy.

## Architecture

```
┌─────────────┐   HTTPS/WS    ┌──────────────────────┐   K8s API   ┌────────────┐
│ Vue 3 SPA   │ ────────────> │ Bun server (TS)      │ ──────────> │ K8s control │
│ xterm.js    │ <──────────── │ • REST proxy         │ <────────── │   plane     │
└─────────────┘               │ • exec WS bridge     │             └────────────┘
                              │ • SA-token rotation  │
                              └──────────────────────┘
```

The server reads its bearer token from the standard service-account mount at `/var/run/secrets/kubernetes.io/serviceaccount/token` and proxies authenticated calls to the API server. No external secrets store needed.

## Run locally

Requires [Bun](https://bun.sh/) and access to a Kubernetes cluster (or a `kind` / `k3d` / `k0s` local cluster).

```sh
bun install
bun run dev       # frontend
bun run server    # backend
```

## Run in cluster

```sh
docker build -t lens:dev .
# Deploy as a Deployment + ServiceAccount with the RBAC permissions you want
# the dashboard to have — by default, read-only ClusterRole bound to the SA.
```

## Where it fits

Part of [PYXIS3](https://pyxis3.ai) — model-agnostic LLM serving infrastructure. lens is the observability layer for an LLM-serving Kubernetes cluster running vLLM / TGI / llama.cpp / Ollama side by side.

## Status

Single-developer project, used in production on the PYXIS3 homelab cluster. Read-only by default; exec is gated behind RBAC.
