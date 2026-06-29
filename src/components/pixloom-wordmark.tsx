import { cn } from "@/lib/utils"

type PixLoomWordmarkProps = {
  className?: string
  accent?: "cyan" | "iris"
}

export function PixLoomWordmark({
  className,
  accent = "iris",
}: PixLoomWordmarkProps) {
  return (
    <span
      aria-label="PixLoom"
      className={cn("font-display font-extrabold tracking-[-0.06em]", className)}
    >
      pixl
      <span className={accent === "iris" ? "text-iris" : "text-signal"}>oo</span>
      m
    </span>
  )
}
