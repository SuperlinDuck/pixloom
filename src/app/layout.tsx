import type { Metadata } from 'next'
import './globals.css'
export const metadata: Metadata = {
  title: 'Pixloom — 从想法到应用',
  description: '描述你的想法，和 Pixloom 一起构建、预览和迭代应用。',
}
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
