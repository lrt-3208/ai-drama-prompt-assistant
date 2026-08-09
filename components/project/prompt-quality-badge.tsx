import { Badge } from "@/components/ui/badge";

interface PromptQualityBadgeProps {
  score: number | null;
  note?: string | null;
}

export function PromptQualityBadge({ score, note }: PromptQualityBadgeProps) {
  if (!score) return null;

  let variant: "default" | "secondary" | "outline" = "secondary";
  let className = "";

  if (score <= 2) {
    className = "text-red-500 border-red-500/40";
    variant = "outline";
  } else if (score === 3) {
    className = "text-amber-500 border-amber-500/40";
    variant = "outline";
  } else {
    className = "text-green-500 border-green-500/40";
    variant = "outline";
  }

  return (
    <Badge variant={variant} className={className} title={note || undefined}>
      {score}/5
    </Badge>
  );
}
