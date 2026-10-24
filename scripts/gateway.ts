import { loadEnvConfig } from '@next/env'
import { publicationConfig, caddyConfig } from '../src/lib/publication/config'
import { createPublicationGateway } from '../src/lib/publication/gateway'

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production')
const config = publicationConfig()
if (process.argv.includes('--caddy-config'))
  process.stdout.write(caddyConfig(config))
else {
  const server = createPublicationGateway(config)
  server.listen(config.port, '127.0.0.1', () =>
    console.log(
      `Pixloom 发布网关监听 127.0.0.1:${config.port}；发布${config.enabled ? '已启用' : '未启用'}`,
    ),
  )
  server.on('error', (error) => {
    console.error(error.message)
    process.exitCode = 1
  })
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => server.close(() => process.exit(0)))
}
