const distDir = process.env.PIXLOOM_NEXT_DIST_DIR || '.next'
if (!/^\.next(?:-[a-z0-9-]+)?$/.test(distDir))
  throw new Error(
    'PIXLOOM_NEXT_DIST_DIR must be a dedicated .next-* directory inside this project',
  )

module.exports = {
  distDir,
  experimental: { cpus: 2 },
  webpack(config, { isServer }) {
    if (isServer) config.externals.push('node:sqlite', 'pg')
    return config
  },
}
