<script setup lang="ts">
import { onMounted } from 'vue'
import { sshAttacks, loadSSH } from '../lib/ws'
import ExpandableList from './ExpandableList.vue'

onMounted(loadSSH)
</script>

<template>
  <div v-if="!sshAttacks" class="text-zinc-600 text-xs animate-pulse">loading...</div>
  <div v-else class="space-y-2">
    <div class="bg-zinc-900/50 border border-zinc-800/50 rounded px-3 py-2">
      <div class="flex items-center gap-4 text-xs mb-1.5">
        <span class="text-zinc-500">SSH</span>
        <span class="text-red-400">invalid-user:{{ sshAttacks.invalidUsers }}</span>
        <span v-if="sshAttacks.failedPasswords" class="text-red-500">failed-pw:{{ sshAttacks.failedPasswords }}</span>
        <span class="text-zinc-600">probes:{{ sshAttacks.probes }}</span>
        <button @click="loadSSH" class="text-zinc-600 hover:text-zinc-400 ml-auto">↻</button>
      </div>
      <div class="flex gap-2 text-xs flex-wrap items-center">
        <span class="text-zinc-600">IPs ({{ sshAttacks.topIPs.length }}):</span>
        <ExpandableList :items="sshAttacks.topIPs" :limit="5">
          <template #default="{ item: [ip, count] }">
            <span class="text-zinc-500">{{ ip }} <span class="text-red-400">{{ count }}</span></span>
          </template>
        </ExpandableList>
      </div>
      <div class="flex gap-2 text-xs flex-wrap mt-1 items-center">
        <span class="text-zinc-600">users ({{ sshAttacks.topUsers.length }}):</span>
        <ExpandableList :items="sshAttacks.topUsers" :limit="8">
          <template #default="{ item: [user, count] }">
            <span class="text-zinc-500"><span :class="user === 'root' ? 'text-red-400' : 'text-amber-400'">{{ user }}</span> <span class="text-zinc-600">{{ count }}</span></span>
          </template>
        </ExpandableList>
      </div>
    </div>

    <div v-if="sshAttacks.recent?.length" class="overflow-x-auto">
      <table class="w-full text-xs">
        <thead>
          <tr class="text-zinc-600 border-b border-zinc-800">
            <th class="text-left px-2 py-1">TIME</th>
            <th class="text-left px-2 py-1">IP</th>
            <th class="text-left px-2 py-1">USER</th>
            <th class="text-left px-2 py-1">TYPE</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(a, i) in sshAttacks.recent" :key="i" class="row-hover border-b border-zinc-800/30">
            <td class="px-2 py-0.5 text-zinc-600 whitespace-nowrap">{{ a.time }}</td>
            <td class="px-2 py-0.5 text-zinc-400">{{ a.ip }}</td>
            <td class="px-2 py-0.5" :class="a.user === 'root' ? 'text-red-400' : 'text-amber-400'">{{ a.user }}</td>
            <td class="px-2 py-0.5 text-zinc-500">{{ a.type }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
