import { k8s } from './k8s'
import { config } from './config'
import { bump, topN } from './util'
import type { NginxStats } from '../src/lib/types'

let _cache: NginxStats | null = null
let _cacheTime = 0
let _pending: Promise<NginxStats> | null = null

async function doFetch(lines: number): Promise<NginxStats> {
    const pods = await k8s.podsByLabel(config.nginxNamespace, config.nginxLabel)
    if (!pods.length) { _cache = emptyStats(); _cacheTime = Date.now(); return _cache }

    const raw = await k8s.podLogs(config.nginxNamespace, pods[0], undefined, lines)

    const statusMap: Record<string, number> = {}
    const hostMap: Record<string, number> = {}
    const ipMap: Record<string, number> = {}
    const pathMap: Record<string, number> = {}
    const uaMap: Record<string, number> = {}
    const tlsMap: Record<string, number> = {}
    let totalRT = 0
    let rtCount = 0
    let totalUpstreamRT = 0
    let upstreamCount = 0
    let totalBytes = 0
    let wafBlocks = 0
    let total = 0

    for (const line of raw) {
      if (!line.includes('"status":')) continue
      try {
        const j = JSON.parse(line)
        total++

        bump(statusMap, String(j.status))
        if (j.host) bump(hostMap, j.host)
        if (j.remote) bump(ipMap, j.remote)
        if (j.uri) bump(pathMap, j.uri)
        if (j.ua && j.ua !== '-') bump(uaMap, j.ua)
        if (j.ssl && j.ssl !== '-') bump(tlsMap, j.ssl)

        if (j.bytes) totalBytes += parseInt(j.bytes) || 0
        if (j.rt) {
          const rt = parseFloat(j.rt)
          if (!isNaN(rt)) { totalRT += rt; rtCount++ }
        }
        if (j.upstream_rt && j.upstream_rt !== '-') {
          const urt = parseFloat(j.upstream_rt)
          if (!isNaN(urt)) { totalUpstreamRT += urt; upstreamCount++ }
        }
      } catch { continue }
    }

    wafBlocks = raw.filter(l => l.includes('ModSecurity') && l.includes('Access denied')).length

    const topIPs = topN(ipMap, 20).map(([ip, count]) => ({ ip, count }))
    const topPaths = topN(pathMap, 15).map(([uri, count]) => ({ uri, count }))
    const topUAs = topN(uaMap, 10).map(([ua, count]) => ({ ua, count }))

    _cache = {
      requestsTotal: total,
      totalBytes,
      byStatus: statusMap,
      byHost: hostMap,
      topIPs,
      topPaths,
      topUAs,
      avgResponseTime: rtCount ? Math.round((totalRT / rtCount) * 1000) : 0,
      avgUpstreamTime: upstreamCount ? Math.round((totalUpstreamRT / upstreamCount) * 1000) : 0,
      wafBlocks,
      tlsVersions: tlsMap,
    }
    _cacheTime = Date.now()
    return _cache
}

export const nginx = {
  async analyze(lines = 500): Promise<NginxStats> {
    if (_cache && Date.now() - _cacheTime < config.nginxCacheTTL) return _cache
    if (_pending) return _pending
    _pending = doFetch(lines).finally(() => { _pending = null })
    return _pending
  },
}

function emptyStats(): NginxStats {
  return { requestsTotal: 0, totalBytes: 0, byStatus: {}, byHost: {}, topIPs: [], topPaths: [], topUAs: [], avgResponseTime: 0, avgUpstreamTime: 0, wafBlocks: 0, tlsVersions: {} }
}
