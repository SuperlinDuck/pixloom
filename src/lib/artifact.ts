import { parse, serialize, type DefaultTreeAdapterMap } from 'parse5'
import { parse as parseJavaScript } from 'acorn'

export function validateArtifact(html: string): string {
  const document = parse(html)
  function visit(node: DefaultTreeAdapterMap['node']) {
    if ('tagName' in node) {
      if (['iframe', 'object', 'embed', 'base'].includes(node.tagName))
        throw new Error('应用包含不支持的嵌入资源')
      if (node.tagName === 'script') {
        if (node.attrs.some((a) => a.name === 'src'))
          throw new Error('应用必须使用内联 JavaScript，不能加载外部脚本')
        const type = node.attrs.find((a) => a.name === 'type')?.value || ''
        if (
          !type ||
          ['module', 'text/javascript', 'application/javascript'].includes(type)
        ) {
          const source = node.childNodes
            .filter((n) => n.nodeName === '#text')
            .map((n) => ('value' in n ? n.value : ''))
            .join('')
          try {
            parseJavaScript(source, {
              ecmaVersion: 'latest',
              sourceType: type === 'module' ? 'module' : 'script',
            })
          } catch (e) {
            throw new Error(`JavaScript 语法错误：${(e as Error).message}`)
          }
        }
      }
      for (const attr of node.attrs) {
        if (attr.name.startsWith('on')) {
          try {
            parseJavaScript(`function handler(event){${attr.value}\n}`, {
              ecmaVersion: 'latest',
            })
          } catch {
            throw new Error(`事件 ${attr.name} 存在 JavaScript 语法错误`)
          }
        }
        if (
          (['src', 'href'].includes(attr.name) &&
            attr.value &&
            !attr.value.startsWith('#') &&
            !attr.value.startsWith('data:')) ||
          (node.tagName === 'meta' &&
            attr.name === 'http-equiv' &&
            attr.value.toLowerCase() === 'refresh')
        )
          throw new Error('应用包含外部资源或跳转，请改用内联资源')
      }
    }
    if ('childNodes' in node) node.childNodes.forEach(visit)
  }
  visit(document)
  if (!/<body[\s>]/i.test(html) || !/<html[\s>]/i.test(html))
    throw new Error('缺少完整的 HTML 文档结构')
  // Parsing/serialization normalizes markup; it does not execute generated scripts.
  return serialize(document)
}
