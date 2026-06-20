<script setup lang="ts">
import { ref } from 'vue'
const props = withDefaults(defineProps<{ items: any[]; limit?: number }>(), { limit: 8 })
const expanded = ref(false)
</script>

<template>
  <template v-for="(item, i) in (expanded ? items : items.slice(0, limit))" :key="i">
    <slot :item="item" />
  </template>
  <button v-if="items.length > limit" @click="expanded = !expanded" class="text-zinc-600 hover:text-zinc-400">
    {{ expanded ? 'less' : `+${items.length - limit}` }}
  </button>
</template>
