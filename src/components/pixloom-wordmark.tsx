import { cn } from "@/lib/utils"

type PixLoomWordmarkProps = {
  className?: string
}

export function PixLoomWordmark({ className }: PixLoomWordmarkProps) {
  return (
    <span
      aria-label="PixLoom"
      className={cn("font-display font-extrabold tracking-[-0.06em]", className)}
    >
      PixL
      <span className="text-primary">oo</span>
      m
    </span>
  )
}
