import { readFile } from 'fs/promises'
import { statfsSync } from 'fs'
import { config } from './config'

export interface SystemMetrics {
  cpu: { percent: number; cores: number; perCore: number[]; load1: number; load5: number; load15: number }
  memory: { total: number; used: number; available: number; percent: number; buffers: number; cached: number }
  swap: { total: number; used: number; percent: number }
  disk: { total: number; used: number; free: number; percent: number }
  network: { rxBytes: number; txBytes: number; rxRate: number; txRate: number; connections: number }
  uptime: number
  processes: number
}

const PROC = config.hostProc

async function readProc(path: string): Promise<string> {
  try { return await readFile(path, 'utf-8') } catch { return '' }
}

// CPU usage tracking (need two samples to calculate)
let prevCpu = { idle: 0, total: 0 }
let prevPerCore: { idle: number; total: number }[] = []

function parseCpuUsage(stat: string): { percent: number; perCore: number[] } {
  const lines = stat.split('\n')

  // Aggregate CPU
  const aggParts = lines[0].replace(/^cpu\s+/, '').split(/\s+/).map(Number)
  const aggIdle = aggParts[3] + (aggParts[4] || 0)
  const aggTotal = aggParts.reduce((s, v) => s + v, 0)
  const dIdle = aggIdle - prevCpu.idle
  const dTotal = aggTotal - prevCpu.total
  prevCpu = { idle: aggIdle, total: aggTotal }
  const percent = dTotal === 0 ? 0 : Math.round((1 - dIdle / dTotal) * 100 * 10) / 10

  // Per-core CPU
  const perCore: number[] = []
  const coreLines = lines.filter(l => /^cpu\d+/.test(l))
  for (let i = 0; i < coreLines.length; i++) {
    const parts = coreLines[i].replace(/^cpu\d+\s+/, '').split(/\s+/).map(Number)
    const idle = parts[3] + (parts[4] || 0)
    const total = parts.reduce((s, v) => s + v, 0)
    const prev = prevPerCore[i] || { idle: 0, total: 0 }
    const di = idle - prev.idle
    const dt = total - prev.total
    perCore.push(dt === 0 ? 0 : Math.round((1 - di / dt) * 100 * 10) / 10)
    if (!prevPerCore[i]) prevPerCore.push({ idle, total })
    else prevPerCore[i] = { idle, total }
  }

  return { percent, perCore }
}

function parseNetworkBytes(dev: string): { rx: number; tx: number } {
  let rx = 0, tx = 0
  for (const line of dev.split('\n')) {
    const match = line.match(/^\s*(\w+):\s*(\d+)(?:\s+\d+){7}\s+(\d+)/)
    if (match) {
      const iface = match[1]
      if (/^(lo|veth|docker|cni|flannel|kube|cali|tunl|dummy)/.test(iface)) continue
      rx += parseInt(match[2])
      tx += parseInt(match[3])
    }
  }
  return { rx, tx }
}

let prevNet = { rx: 0, tx: 0, ts: Date.now() }

export const metrics = {
  async system(): Promise<SystemMetrics> {
    const [meminfo, loadavg, stat, uptime, netdev, netstat] = await Promise.all([
      readProc(`${PROC}/meminfo`),
      readProc(`${PROC}/loadavg`),
      readProc(`${PROC}/stat`),
      readProc(`${PROC}/uptime`),
      readProc(`${PROC}/net/dev`),
      readProc(`${PROC}/net/tcp`),
    ])

    // Memory
    const memTotal = parseInt(meminfo.match(/MemTotal:\s+(\d+)/)?.[1] || '0') * 1024
    const memAvail = parseInt(meminfo.match(/MemAvailable:\s+(\d+)/)?.[1] || '0') * 1024
    const memUsed = memTotal - memAvail
    const buffers = parseInt(meminfo.match(/Buffers:\s+(\d+)/)?.[1] || '0') * 1024
    const cached = parseInt(meminfo.match(/Cached:\s+(\d+)/)?.[1] || '0') * 1024
    const swapTotal = parseInt(meminfo.match(/SwapTotal:\s+(\d+)/)?.[1] || '0') * 1024
    const swapFree = parseInt(meminfo.match(/SwapFree:\s+(\d+)/)?.[1] || '0') * 1024

    // CPU
    const { percent: cpuPercent, perCore } = parseCpuUsage(stat)
    const cpuCount = perCore.length || (stat.match(/^cpu\d+/gm) || []).length
    const loads = loadavg.split(' ')
    const processes = parseInt(loads[3]?.split('/')[1] || '0')
    const connections = netstat.split('\n').filter(l => l.trim() && !l.includes('local_address')).length

    // Network rate
    const net = parseNetworkBytes(netdev)
    const now = Date.now()
    const dt = (now - prevNet.ts) / 1000
    const rxRate = dt > 0 ? (net.rx - prevNet.rx) / dt : 0
    const txRate = dt > 0 ? (net.tx - prevNet.tx) / dt : 0
    prevNet = { ...net, ts: now }

    return {
      cpu: {
        percent: cpuPercent,
        cores: cpuCount,
        perCore,
        load1: parseFloat(loads[0] || '0'),
        load5: parseFloat(loads[1] || '0'),
        load15: parseFloat(loads[2] || '0'),
      },
      memory: {
        total: memTotal,
        used: memUsed,
        available: memAvail,
        buffers,
        cached,
        percent: memTotal ? Math.round((memUsed / memTotal) * 100 * 10) / 10 : 0,
      },
      swap: {
        total: swapTotal,
        used: swapTotal - swapFree,
        percent: swapTotal ? Math.round(((swapTotal - swapFree) / swapTotal) * 100 * 10) / 10 : 0,
      },
      network: {
        rxBytes: net.rx,
        txBytes: net.tx,
        rxRate: Math.round(rxRate),
        txRate: Math.round(txRate),
        connections,
      },
      disk: (() => {
        try {
          const s = statfsSync('/')
          const total = s.blocks * s.bsize
          const free = s.bfree * s.bsize
          const used = total - free
          return { total, used, free, percent: total ? Math.round((used / total) * 100 * 10) / 10 : 0 }
        } catch {
          return { total: 0, used: 0, free: 0, percent: 0 }
        }
      })(),
      uptime: parseFloat(uptime.split(' ')[0] || '0'),
      processes,
    }
  },
}
