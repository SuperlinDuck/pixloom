module.exports = {
  experimental: { cpus: 2 },
  webpack(config, { isServer }) {
    if (isServer) config.externals.push('node:sqlite')
    return config
  },
}
