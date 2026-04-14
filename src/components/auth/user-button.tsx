"use client"

import { signIn, signOut, useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { LogIn, LogOut, User } from "lucide-react"

export function UserButton() {
  const { data: session, status } = useSession()
  const t = useTranslations("auth")

  if (status === "loading") {
    return (
      <div className="h-9 w-9 animate-pulse rounded-full bg-muted" />
    )
  }

  if (!session) {
    return (
      <button
        onClick={() => signIn("google")}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <LogIn className="h-4 w-4" />
        {t("login")}
      </button>
    )
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        {session.user?.image ? (
          <img
            src={session.user.image}
            alt={session.user.name || t("userAvatar")}
            className="h-8 w-8 rounded-full"
          />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
            <User className="h-4 w-4" />
          </div>
        )}
        <span className="hidden text-sm font-medium sm:inline-block">
          {session.user?.name}
        </span>
      </div>
      <button
        onClick={() => signOut()}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        title={t("logout")}
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  )
}
