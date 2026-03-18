<script setup lang="ts">
import { ref } from 'vue'
import type { SecuritySummary } from '../lib/types'

defineProps<{ data: SecuritySummary | null }>()
const expandedJail = ref<string | null>(null)

function toggle(name: string) {
  expandedJail.value = expandedJail.value === name ? null : name
}
</script>

<template>
  <div v-if="data" class="space-y-1.5">
    <div class="flex items-center gap-4 text-xs">
      <span class="text-zinc-500">FAIL2BAN</span>
      <span :class="data.totalBanned > 0 ? 'text-red-400' : 'text-zinc-600'">banned:{{ data.totalBanned }}</span>
      <span :class="data.totalProbes > 0 ? 'text-amber-400' : 'text-zinc-600'">probes:{{ data.totalProbes }}</span>
    </div>

    <div v-for="(jail, name) in data.fail2ban" :key="name"
      class="bg-zinc-900/50 border border-zinc-800/50 rounded px-3 py-1.5">
      <!-- Jail header (clickable to expand) -->
      <div class="flex items-center gap-3 text-xs cursor-pointer" @click="toggle(String(name))">
        <span class="text-zinc-500">{{ expandedJail === name ? '\u25BE' : '\u25B8' }}</span>
        <span class="text-zinc-400 font-medium">{{ name }}</span>
        <span :class="jail.banned > 0 ? 'text-red-400' : 'text-zinc-600'">{{ jail.banned }} banned</span>
        <span class="text-zinc-600">{{ jail.totalBanned }} total</span>
        <span v-if="jail.probes" class="text-amber-400/70">{{ jail.probes }} probes</span>
        <span v-if="jail.uniqueProbeIPs" class="text-zinc-600">({{ jail.uniqueProbeIPs }} ips)</span>
      </div>

      <!-- Expanded: show all IPs -->
      <div v-if="expandedJail === name" class="mt-1.5 space-y-1">
        <!-- Banned IPs -->
        <div v-if="jail.bannedIPs.length">
          <div class="text-xs text-red-400/70 mb-0.5">Currently banned ({{ jail.bannedIPs.length }})</div>
          <div class="flex flex-wrap gap-1">
            <span v-for="ip in jail.bannedIPs" :key="ip"
              class="text-xs bg-red-900/20 text-red-400 px-1.5 py-0 rounded">{{ ip }}</span>
          </div>
        </div>
        <div v-else class="text-xs text-zinc-600">no currently banned IPs</div>

        <!-- Probe IPs -->
        <div v-if="jail.probeIPs?.length">
          <div class="text-xs text-amber-400/70 mb-0.5">Recent probe IPs ({{ jail.uniqueProbeIPs }})</div>
          <div class="flex flex-wrap gap-1">
            <span v-for="ip in jail.probeIPs" :key="ip"
              class="text-xs bg-amber-900/20 text-amber-400/80 px-1.5 py-0 rounded">{{ ip }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
