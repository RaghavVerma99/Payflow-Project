import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock3,
  Loader2,
  RotateCcw,
  Skull,
  Undo2,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type {
  Dispute,
  PaymentStatus,
  Payout,
  RefundStatus,
  WebhookEvent,
} from "../lib/api";
import { cn, formatCurrency, shortId } from "../lib/utils";
import { Badge } from "./ui";

type PayoutStatus = Payout["status"];
type DisputeStatus = Dispute["status"];
type WebhookStatus = WebhookEvent["status"];

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

const PAYOUT_STYLES: Record<PayoutStatus, StatusStyle> = {
  pending: { label: "Pending", variant: "outline", icon: Clock3 },
  processing: {
    label: "Processing",
    variant: "info",
    icon: Loader2,
    spin: true,
  },
  paid: { label: "Paid", variant: "success", icon: CheckCircle2 },
  failed: { label: "Failed", variant: "danger", icon: XCircle },
  unknown: { label: "Unknown", variant: "warning", icon: AlertTriangle },
};

const DISPUTE_STYLES: Record<DisputeStatus, StatusStyle> = {
  open: { label: "Open", variant: "warning", icon: AlertTriangle },
  won: { label: "Won", variant: "success", icon: CheckCircle2 },
  lost: { label: "Lost", variant: "danger", icon: XCircle },
};

const WEBHOOK_STYLES: Record<WebhookStatus, StatusStyle> = {
  pending: { label: "Pending", variant: "outline", icon: Clock3 },
  delivered: { label: "Delivered", variant: "success", icon: CheckCircle2 },
  failed: { label: "Failed", variant: "danger", icon: XCircle },
  dead: { label: "Dead", variant: "danger", icon: Skull },
};

type StatusKind = "payment" | "refund" | "payout" | "dispute" | "webhook";

const STYLE_MAPS: Record<StatusKind, Record<string, StatusStyle>> = {
  payment: PAYMENT_STYLES,
  refund: REFUND_STYLES,
  payout: PAYOUT_STYLES,
  dispute: DISPUTE_STYLES,
  webhook: WEBHOOK_STYLES,
};

export function StatusBadge({
  status,
  kind = "payment",
  className,
}: {
  status: PaymentStatus | RefundStatus | PayoutStatus | DisputeStatus | string;
  kind?: StatusKind;
  className?: string;
}) {
  const styles = STYLE_MAPS[kind]?.[status];

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
        "tabular whitespace-nowrap font-medium tracking-[-0.01em]",
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
      className={cn(
        "font-mono text-[10px] tracking-[0.01em] text-muted-foreground",
        className,
      )}
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
