import { readFile } from 'fs/promises'
import { k8s } from './k8s'
import { config } from './config'


export const security = {
  async summary() {
    const f2b = await this.fail2ban()
    const totalBanned = Object.values(f2b).reduce((s: number, j: any) => s + (j.banned || 0), 0)
    const totalProbes = Object.values(f2b).reduce((s: number, j: any) => s + (j.probes || 0), 0)
    return { fail2ban: f2b, totalBanned, totalProbes }
  },

  async fail2ban() {
    let lines: string[] = []
    try {
      const content = await readFile(config.f2bLog, 'utf-8')
      lines = content.split('\n').filter(Boolean).slice(-2000)
    } catch (e) {
      console.error('[security] Failed to read fail2ban log:', (e as Error).message)
      return {}
    }

    const jails: Record<string, { banned: Set<string>; totalBanned: number; probes: number; probeIPs: Set<string> }> = {}
    for (const line of lines) {
      // Ban/Unban events
      let m = line.match(/\[(\S+)\]\s+(Ban|Unban)\s+(\S+)/)
      if (m) {
        const [, jail, action, ip] = m
        if (!jails[jail]) jails[jail] = { banned: new Set(), totalBanned: 0, probes: 0, probeIPs: new Set() }
        if (action === 'Ban') { jails[jail].banned.add(ip); jails[jail].totalBanned++ }
        else jails[jail].banned.delete(ip)
        continue
      }
      // Found events (probes before ban)
      m = line.match(/\[(\S+)\]\s+Found\s+(\S+)/)
      if (m) {
        const [, jail, ip] = m
        if (!jails[jail]) jails[jail] = { banned: new Set(), totalBanned: 0, probes: 0, probeIPs: new Set() }
        jails[jail].probes++
        jails[jail].probeIPs.add(ip)
      }
    }

    const result: Record<string, any> = {}
    for (const [name, data] of Object.entries(jails)) {
      result[name] = { banned: data.banned.size, totalBanned: data.totalBanned, bannedIPs: [...data.banned], probes: data.probes, uniqueProbeIPs: data.probeIPs.size, probeIPs: [...data.probeIPs].slice(0, 50) }
    }
    return result
  },

  async sshAttacks() {
    try {
      const content = await readFile(config.authLog, 'utf-8')
      const lines = content.split('\n').slice(-3000)

      const attacks: { time: string; ip: string; user: string; type: string }[] = []
      const ipCounts: Record<string, number> = {}
      const userCounts: Record<string, number> = {}

      for (const line of lines) {
        // Invalid user
        let m = line.match(/^(\S+)\s.*Invalid user (\S+) from (\S+)/)
        if (m) {
          attacks.push({ time: m[1], ip: m[3], user: m[2], type: 'invalid-user' })
          ipCounts[m[3]] = (ipCounts[m[3]] || 0) + 1
          userCounts[m[2]] = (userCounts[m[2]] || 0) + 1
          continue
        }
        // Failed password
        m = line.match(/^(\S+)\s.*Failed password for (?:invalid user )?(\S+) from (\S+)/)
        if (m) {
          attacks.push({ time: m[1], ip: m[3], user: m[2], type: 'failed-password' })
          ipCounts[m[3]] = (ipCounts[m[3]] || 0) + 1
          userCounts[m[2]] = (userCounts[m[2]] || 0) + 1
          continue
        }
        // Disconnected from authenticating user (brute force probes)
        m = line.match(/^(\S+)\s.*Disconnected from authenticating user (\S+) (\S+)/)
        if (m) {
          attacks.push({ time: m[1], ip: m[3], user: m[2], type: 'disconnect-probe' })
          ipCounts[m[3]] = (ipCounts[m[3]] || 0) + 1
        }
      }

      const topIPs = Object.entries(ipCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)
      const topUsers = Object.entries(userCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)

      const invalidUsers = attacks.filter(a => a.type === 'invalid-user').length
      const failedPasswords = attacks.filter(a => a.type === 'failed-password').length
      const probes = attacks.filter(a => a.type === 'disconnect-probe').length

      return {
        total: attacks.length,
        invalidUsers,
        failedPasswords,
        probes,
        recent: attacks.filter(a => a.type !== 'disconnect-probe').slice(-50).reverse(),
        topIPs,
        topUsers,
      }
    } catch (e) {
      console.error('[security] Failed to read SSH log:', (e as Error).message)
      return { total: 0, recent: [], topIPs: [], topUsers: [] }
    }
  },

  async authelia() {
    const pods = await k8s.podsByLabel(config.autheliaNamespace, config.autheliaLabel)
    if (!pods.length) return { requests: 0, blocked: 0, byHost: {} as Record<string, number>, recent: [] as any[] }

    const lines = await k8s.podLogs('authelia', pods[0], undefined, 200)
    let requests = 0, blocked = 0
    const byHost: Record<string, number> = {}
    const recent: { time: string; host: string; user: string; status: number; method: string }[] = []

    for (const line of lines) {
      if (!line.includes('"method"')) continue
      try {
        const j = JSON.parse(line)
        if (!j.path?.includes('/api/authz/')) continue
        requests++
        const hostMatch = j.msg?.match(/https?:\/\/([^\s/]+)/)
        const host = hostMatch?.[1] || ''
        const user = j.msg?.match(/user\s+(\S+)/)?.[1] || '<anonymous>'
        const status = j.msg?.includes('status code 401') ? 401 : j.msg?.includes('status code 403') ? 403 : 200

        if (status >= 400) {
          blocked++
          if (host) byHost[host] = (byHost[host] || 0) + 1
        }

        if (user !== '<anonymous>') {
          recent.push({ time: j.time || '', host, user, status, method: j.method || '' })
        }
      } catch { continue }
    }

    return { requests, blocked, byHost, recent: recent.slice(-20).reverse() }
  },

  async nginxAttacks(limit = 100) {
    const pods = await k8s.podsByLabel(config.nginxNamespace, config.nginxLabel)
    if (!pods.length) return { attacks: [], attackCount: 0 }

    const lines = await k8s.podLogs(config.nginxNamespace, pods[0], undefined, limit * 2)
    const attacks = lines
      .filter(l => l.includes('"status":'))
      .map(l => {
        try {
          const j = JSON.parse(l)
          if (j.status >= 400) return { time: j.time, ip: j.remote, method: j.method, uri: j.uri, status: j.status, host: j.host, ua: j.ua }
        } catch { /* unparseable line, skip */ }
        return null
      })
      .filter((a): a is NonNullable<typeof a> => a !== null)
      .slice(-limit)
    return { attacks, attackCount: attacks.length }
  },
}
