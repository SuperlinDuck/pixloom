export default {
  cacheDir: '/workspace/.vite',
  base: process.env.PIXLOOM_PREVIEW_BASE || '/',
  build: { outDir: 'dist', emptyOutDir: true },
}
