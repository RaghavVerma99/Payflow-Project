import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock3,
  Loader2,
  RotateCcw,
  Undo2,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { PaymentStatus, RefundStatus } from "../lib/api";
import { cn, formatCurrency, shortId } from "../lib/utils";
import { Badge } from "./ui";

type BadgeVariant =
  | "default"
  | "secondary"
  | "outline"
  | "success"
  | "danger"
  | "warning"
  | "info"
  | "violet";

interface StatusStyle {
  label: string;
  variant: BadgeVariant;
  icon: LucideIcon;
  spin?: boolean;
}

const PAYMENT_STYLES: Record<PaymentStatus, StatusStyle> = {
  created: { label: "Created", variant: "outline", icon: Clock3 },
  processing: {
    label: "Processing",
    variant: "info",
    icon: Loader2,
    spin: true,
  },
  succeeded: { label: "Succeeded", variant: "success", icon: CheckCircle2 },
  failed: { label: "Failed", variant: "danger", icon: XCircle },
  canceled: { label: "Canceled", variant: "secondary", icon: Ban },
  unknown: { label: "Unknown", variant: "warning", icon: AlertTriangle },
  partially_refunded: {
    label: "Partially refunded",
    variant: "violet",
    icon: Undo2,
  },
  refunded: { label: "Refunded", variant: "violet", icon: RotateCcw },
};

const REFUND_STYLES: Record<RefundStatus, StatusStyle> = {
  reserved: { label: "Reserved", variant: "outline", icon: Clock3 },
  processing: {
    label: "Processing",
    variant: "info",
    icon: Loader2,
    spin: true,
  },
  succeeded: { label: "Succeeded", variant: "success", icon: CheckCircle2 },
  failed: { label: "Failed", variant: "danger", icon: XCircle },
  canceled: { label: "Canceled", variant: "secondary", icon: Ban },
  unknown: { label: "Unknown", variant: "warning", icon: AlertTriangle },
};

export function StatusBadge({
  status,
  kind = "payment",
  className,
}: {
  status: PaymentStatus | RefundStatus | string;
  kind?: "payment" | "refund";
  className?: string;
}) {
  const styles =
    kind === "refund"
      ? REFUND_STYLES[status as RefundStatus]
      : PAYMENT_STYLES[status as PaymentStatus];

  const fallback: StatusStyle = {
    label: status,
    variant: "outline",
    icon: Clock3,
  };
  const style = styles ?? fallback;
  const Icon = style.icon;

  return (
    <Badge variant={style.variant} className={cn("gap-1", className)}>
      <Icon className={cn("size-3", style.spin && "animate-spin")} />
      {style.label}
    </Badge>
  );
}

export function Amount({
  minor,
  className,
  muted,
}: {
  minor: number;
  className?: string;
  muted?: boolean;
}) {
  return (
    <span
      className={cn(
        "tabular font-medium",
        muted && "text-muted-foreground",
        className,
      )}
    >
      {formatCurrency(minor)}
    </span>
  );
}

export function IdText({ id, className }: { id: string; className?: string }) {
  return (
    <span
      className={cn("font-mono text-xs text-muted-foreground", className)}
      title={id}
    >
      {shortId(id)}
    </span>
  );
}

export function SourceBadge({ type }: { type: string }) {
  const variant: BadgeVariant =
    type === "payment" ? "info" : type === "refund" ? "violet" : "outline";
  return (
    <Badge variant={variant} className="capitalize">
      {type}
    </Badge>
  );
}
