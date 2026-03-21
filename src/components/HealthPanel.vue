<script setup lang="ts">
import type { ServiceHealth } from '../lib/types'

defineProps<{ services: ServiceHealth[] }>()
</script>

<template>
  <div v-if="services.length" class="bg-zinc-900/50 border border-zinc-800/50 rounded px-3 py-1.5">
    <div class="flex flex-wrap gap-x-3 gap-y-0.5">
      <a v-for="svc in services" :key="svc.host" :href="`https://${svc.host}`" target="_blank"
        class="text-xs inline-flex items-center gap-1 cursor-pointer hover:bg-zinc-800/50 rounded px-1 -mx-1 transition-colors"
        :title="svc.error || `${svc.host} ${svc.status} ${svc.latency}ms`">
        <span :class="svc.ok ? 'text-emerald-500' : 'text-red-500'">{{ svc.ok ? '\u25CF' : '\u2715' }}</span>
        <span :class="svc.ok ? 'text-zinc-400 hover:text-emerald-400' : 'text-red-400'">{{ svc.name }}</span>
        <span :class="svc.status >= 400 ? 'text-amber-400' : 'text-zinc-600'">{{ svc.status || 'err' }}</span>
        <span class="text-zinc-700">{{ svc.latency }}ms</span>
        <span v-if="svc.error" class="text-red-400/70 truncate max-w-32">{{ svc.error }}</span>
      </a>
    </div>
  </div>
</template>
