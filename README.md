# lens

A lightweight Kubernetes observability and exec dashboard. Read-only views over your cluster's resources, plus an in-browser `kubectl exec` terminal — all served from a single Bun process.

Built to run inside the cluster (uses the in-pod service-account token), so it requires zero kubeconfig wrangling.

## What it does

- **Resource browser** — namespaces, pods, deployments, services, configmaps, secrets metadata, events
- **In-browser exec** — open a real shell on any pod via `xterm.js` over WebSocket
- **Security panel** — surfaces failed-auth events from collected log streams (configurable)
- **Monitoring panel** — basic per-namespace resource pressure
- Vue 3 + Vite frontend; Bun TypeScript backend

## Architecture

```
┌─────────────┐   HTTPS/WS    ┌──────────────────────┐   K8s API   ┌────────────┐
│ Vue 3 SPA   │ ────────────> │ Bun server (TS)      │ ──────────> │ K8s control │
│ xterm.js    │ <──────────── │ • REST proxy         │ <────────── │   plane     │
└─────────────┘               │ • exec WS bridge     │             └────────────┘
                              │ • SA-token rotation  │
                              └──────────────────────┘
```

The server reads its bearer token from the standard service-account mount at
`/var/run/secrets/kubernetes.io/serviceaccount/token` and proxies authenticated calls to the API server. No external secrets store needed.

## Run locally

Requires [Bun](https://bun.sh/) and access to a Kubernetes cluster (or a `kind` / `k3d` / `k0s` local cluster).

```sh
# Install
bun install

# Frontend dev
bun run dev

# Backend
bun run server
```

## Run in cluster

```sh
docker build -t lens:dev .
# Then deploy as a Deployment + ServiceAccount with the RBAC permissions you want
# the dashboard to have — by default, read-only ClusterRole bound to the SA.
```

## Why

The big Kubernetes dashboards (Lens Desktop, Headlamp, Octant) are great but heavy. This is single-binary scope: enough to debug a cluster from inside it, without a 200 MB Electron download or a separate auth proxy. Works well on a `k0s` homelab.

## Status

Single-developer project, used in my own homelab and reference deployments. Read-only by default; exec is gated behind RBAC.

## Author

[Omar A.](https://github.com/oabdrabo) · AI infrastructure engineer · [LinkedIn](https://linkedin.com/in/oabdrabo)
