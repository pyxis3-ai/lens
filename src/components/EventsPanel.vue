<script setup lang="ts">
import { ref } from 'vue'
import { events, certificates, loadEvents } from '../lib/ws'
import { timeAgo, daysUntil } from '../lib/formatters'

type EventView = 'events' | 'certs'
const EVENT_VIEWS: EventView[] = ['events', 'certs']
const active = ref<EventView>('events')

function cycleTab(dir: number) {
  const idx = EVENT_VIEWS.indexOf(active.value)
  active.value = EVENT_VIEWS[(idx + dir + EVENT_VIEWS.length) % EVENT_VIEWS.length]
}

defineExpose({ cycleTab })
const expandedEvent = ref(-1)
</script>

<template>
  <div>
    <div class="flex items-center gap-1 mb-2">
      <button v-for="t in (['events', 'certs'] as EventView[])" :key="t"
        @click="active = t"
        :class="active === t ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:bg-zinc-800'"
        class="px-2 py-0.5 text-xs rounded transition-colors">
        {{ t }}
        <span class="text-zinc-600 ml-0.5">{{ t === 'events' ? events.length : certificates.length }}</span>
      </button>
      <button @click="loadEvents" class="text-xs text-zinc-600 hover:text-zinc-400 ml-auto">\u21BB</button>
    </div>

    <div v-if="active === 'events'">
      <div v-if="!events.length" class="text-zinc-600 text-xs animate-pulse">loading...</div>
      <div v-else class="overflow-x-auto">
        <table class="w-full text-xs">
          <thead>
            <tr class="text-zinc-600 border-b border-zinc-800">
              <th class="text-left px-2 py-1">AGE</th>
              <th class="text-left px-2 py-1">TYPE</th>
              <th class="text-left px-2 py-1">NS</th>
              <th class="text-left px-2 py-1">OBJECT</th>
              <th class="text-left px-2 py-1">REASON</th>
              <th class="text-left px-2 py-1">MESSAGE</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(e, i) in events" :key="i">
              <tr class="border-b border-zinc-800/30 cursor-pointer"
                :class="[e.type === 'Warning' ? 'text-amber-300/80' : 'text-zinc-400', expandedEvent === i ? 'bg-zinc-800/30' : 'row-hover']"
                @click="expandedEvent = expandedEvent === i ? -1 : i">
                <td class="px-2 py-0.5 text-zinc-600 whitespace-nowrap">{{ timeAgo(e.time) }}</td>
                <td class="px-2 py-0.5" :class="e.type === 'Warning' ? 'text-amber-400' : 'text-zinc-500'">{{ e.type === 'Warning' ? '\u26A0' : '\u00B7' }}</td>
                <td class="px-2 py-0.5 text-zinc-500">{{ e.namespace }}</td>
                <td class="px-2 py-0.5 max-w-36 truncate">{{ e.object }}</td>
                <td class="px-2 py-0.5">{{ e.reason }}</td>
                <td class="px-2 py-0.5 max-w-96 truncate text-zinc-500">{{ e.message }}</td>
              </tr>
              <tr v-if="expandedEvent === i" class="bg-zinc-900/30">
                <td colspan="6" class="px-4 py-2 text-xs text-zinc-400 whitespace-pre-wrap">{{ e.message }}</td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <div v-else-if="active === 'certs'">
      <div v-if="!certificates.length" class="text-zinc-600 text-xs animate-pulse">loading...</div>
      <div v-else class="overflow-x-auto">
        <table class="w-full text-xs">
          <thead>
            <tr class="text-zinc-600 border-b border-zinc-800">
              <th class="text-left px-2 py-1 w-4"></th>
              <th class="text-left px-2 py-1">NS</th>
              <th class="text-left px-2 py-1">NAME</th>
              <th class="text-right px-2 py-1">EXPIRES</th>
              <th class="text-right px-2 py-1">DOMAINS</th>
              <th class="text-left px-2 py-1">DNS NAMES</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="cert in certificates" :key="cert.name" class="row-hover border-b border-zinc-800/30">
              <td class="px-2 py-0.5" :class="cert.ready ? 'text-emerald-400' : 'text-red-400'">{{ cert.ready ? '\u25CF' : '\u2715' }}</td>
              <td class="px-2 py-0.5 text-zinc-500">{{ cert.namespace }}</td>
              <td class="px-2 py-0.5 text-zinc-300">{{ cert.name }}</td>
              <td class="px-2 py-0.5 text-right" :class="daysUntil(cert.notAfter) < 14 ? 'text-amber-400' : 'text-zinc-600'">{{ daysUntil(cert.notAfter) }}d</td>
              <td class="px-2 py-0.5 text-right text-zinc-400">{{ cert.dnsNames?.length }}</td>
              <td class="px-2 py-0.5 text-zinc-600 max-w-96 truncate">{{ cert.dnsNames?.join(', ') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
