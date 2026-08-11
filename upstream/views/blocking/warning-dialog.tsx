import { ConfirmDialog } from "../../components/confirm-dialog.js";

export interface BlockedWorkWarningDialogProps {
  open: boolean;
  taskKey: string;
  blockerKeys: readonly string[];
  onOpenChange: (open: boolean) => void;
  onContinue: () => void;
}

export function BlockedWorkWarningDialog({
  open,
  taskKey,
  blockerKeys,
  onOpenChange,
  onContinue,
}: BlockedWorkWarningDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Begin blocked work?"
      description={
        <>
          {taskKey} is blocked by {blockerKeys.join(", ")}. Resolve the
          {blockerKeys.length === 1 ? " blocker" : " blockers"} first, or
          deliberately continue anyway.
        </>
      }
      confirmLabel="Continue anyway"
      onConfirm={onContinue}
    />
  );
}
