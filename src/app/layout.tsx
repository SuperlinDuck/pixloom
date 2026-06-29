import type { Metadata } from "next"
import { Bricolage_Grotesque, DM_Sans } from "next/font/google"
import "./globals.css"
import { SessionProvider } from "@/components/providers/session-provider"

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
})

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
})

export const metadata: Metadata = {
  title: "PixLoom - AI 商品图生成平台",
  description: "通过 AI 技术为电商卖家快速生成高质量的商品展示图",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="zh-CN" className="dark">
      <body className={`${dmSans.variable} ${bricolage.variable} font-sans`}>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  )
}
