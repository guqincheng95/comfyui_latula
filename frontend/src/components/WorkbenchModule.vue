<script setup>
import GameIcon from './GameIcon.vue'
defineProps({title:String,icon:String,hint:String,roleName:String})
</script>
<template>
 <section class="parchment operation-module" :data-operation="roleName" :aria-label="title">
  <div class="operation-heading"><span class="module-prop"><GameIcon :name="icon" :size="28" /></span><div><h3>{{ title }}</h3><small>{{ hint }}</small></div><slot name="action" /></div>
  <div class="operation-body"><slot /></div>
 </section>
</template>
