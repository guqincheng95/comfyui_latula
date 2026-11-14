<script setup>
defineProps({ name: { type: String, default: 'book' }, size: { type: [Number, String], default: 24 } })
const paths = {
  gear: 'M10 2h4l1 3 3 1 3-1 2 4-2 2v3l2 2-2 4-3-1-3 1-1 3h-4l-1-3-3-1-3 1-2-4 2-2v-3l-2-2 2-4 3 1 3-1 1-3M12 9a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
  book: 'M3 4h7l2 2 2-2h7v16h-7l-2 2-2-2H3V4m9 2v16M6 8h3M6 11h3m6-3h3m-3 3h3',
  scroll: 'M6 3h14v4H8v11H4V6a3 3 0 0 1 2-3m2 15h12v3H7a3 3 0 0 1-3-3m7-8h6m-6 3h6',
  back: 'M15 4l-8 8 8 8M7 12h14',
  chevron: 'M8 4l8 8-8 8',
  close: 'M5 5l14 14M19 5L5 19',
  add: 'M12 4v16M4 12h16',
  upload: 'M12 17V3m-5 5 5-5 5 5M4 16v5h16v-5',
  download: 'M12 3v14m-5-5 5 5 5-5M4 17v4h16v-4',
  heart: 'M12 21 3 12C-3 3 7-2 12 5 17-2 27 3 21 12l-9 9',
  wifi: 'M2 7a16 16 0 0 1 20 0M5 11a11 11 0 0 1 14 0m-11 4a6 6 0 0 1 8 0m-4 4h.01',
  info: 'M12 10v8m0-12h.01M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20',
  update: 'M4 6l8-4 8 4v12l-8 4-8-4V6m0 0 8 4 8-4m-8 4v12m-4-18 8 4',
  power: 'M12 2v10M6 5a9 9 0 1 0 12 0',
  refresh: 'M20 8a9 9 0 1 0 1 8M20 2v6h-6',
  edit: 'm15 3 6 6-12 12H3v-6L15 3m-2 2 6 6',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
  image: 'M3 3h18v18H3V3m0 14 6-6 5 5 3-3 4 4M16 7h.01',
  play: 'm8 3 13 9-13 9V3',
  cat: 'M3 11V3l6 4h6l6-4v8l-2 9H5l-2-9m4 2h1m8 0h1m-6 3h2m-8 1H1m18 0h4',
  check: 'm4 12 5 5L21 5'
}
</script>
<template><svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true"><path :d="paths[name] || paths.book" /></svg></template>
