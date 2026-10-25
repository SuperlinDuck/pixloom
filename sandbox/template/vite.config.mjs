import path from 'node:path'
import { Linter } from 'eslint'
import globals from 'globals'

const linter = new Linter()
export function checkUndefinedVariables(source, filename) {
  return linter
    .verify(
      source,
      {
        files: ['**/*.{js,jsx}'],
        languageOptions: {
          ecmaVersion: 'latest',
          sourceType: 'module',
          parserOptions: { ecmaFeatures: { jsx: true } },
          globals: globals.browser,
        },
        linterOptions: { noInlineConfig: true },
        rules: { 'no-undef': 'error' },
      },
      { filename },
    )
    .filter((message) => message.severity === 2)
    .map(
      (message) =>
        `${filename}:${message.line}:${message.column} ${message.message}`,
    )
}

export default {
  plugins: [
    {
      name: 'pixloom-check-undefined-variables',
      enforce: 'pre',
      transform(source, id) {
        const relative = path.relative(process.cwd(), id).replaceAll('\\', '/')
        if (!/^src\/.*\.(jsx|js)$/.test(relative)) return
        const errors = checkUndefinedVariables(source, relative)
        if (errors.length)
          this.error(`源码静态检查失败：\n${errors.slice(0, 20).join('\n')}`)
      },
    },
  ],
  cacheDir: '/workspace/.vite',
  base: process.env.PIXLOOM_PREVIEW_BASE || '/',
  build: { outDir: 'dist', emptyOutDir: true },
}
