"use client"

import { signIn, signOut, useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { LogIn, LogOut, User } from "lucide-react"
import Image from "next/image"

export function UserButton() {
  const { data: session, status } = useSession()
  const t = useTranslations("auth")

  if (status === "loading") {
    return (
      <div className="flex h-10 w-[92px] items-center justify-end" aria-hidden="true">
        <div className="h-9 w-9 animate-pulse rounded-full bg-muted" />
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex h-10 w-[92px] items-center justify-end">
        <button
          onClick={() => signIn("google")}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <LogIn className="h-4 w-4 shrink-0" />
          {t("login")}
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-10 w-[92px] items-center justify-end">
      <button
        type="button"
        onClick={() => signOut()}
        className="group relative h-9 w-9 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FA4DAD] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label={t("logout")}
        title={t("logout")}
      >
        {session.user?.image ? (
          <Image
            src={session.user.image}
            alt={session.user.name || t("userAvatar")}
            width={36}
            height={36}
            unoptimized
            className="h-9 w-9 rounded-full object-cover ring-1 ring-border transition group-hover:brightness-50"
          />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted ring-1 ring-border transition group-hover:brightness-50">
            <User className="h-4 w-4" />
          </span>
        )}

        <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-black/25 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <LogOut className="h-4 w-4 text-white" />
        </span>

        <span className="pointer-events-none absolute right-0 top-full mt-2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground opacity-0 shadow-md transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
          {t("logout")}
        </span>
      </button>
    </div>
  )
}
