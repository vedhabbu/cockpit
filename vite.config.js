import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync } from 'node:fs'
import { resolve } from 'node:path'

// MapLibre GL v6 ships its worker as a separate ESM file
// (maplibre-gl-worker.mjs, which itself imports maplibre-gl-shared.mjs) and
// computes the worker's URL at runtime relative to wherever the main
// maplibre-gl.mjs module is served from. Rollup bundles maplibre-gl.mjs
// into the app's own hashed chunks and has no reason to know it should also
// emit these two files unbundled alongside it — so in a production build
// the worker's computed URL points at a file that was never emitted, the
// module Worker's fetch just hangs, and the map never renders (works in
// dev only because Vite serves node_modules directly). This plugin copies
// both files into the build output as-is; App.jsx points
// maplibregl.setWorkerUrl() at that stable location.
function copyMaplibreWorker() {
  const maplibreDist = resolve('node_modules/maplibre-gl/dist')
  let outDir = 'dist'
  return {
    name: 'copy-maplibre-worker',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
        copyFileSync(resolve(maplibreDist, file), resolve(outDir, file))
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), copyMaplibreWorker()],
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
})
