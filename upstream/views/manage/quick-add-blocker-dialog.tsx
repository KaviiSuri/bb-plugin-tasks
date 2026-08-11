import { useState } from "react";
import type { DependencyTask, Task } from "../../shared/contract.js";
import { useTasksRpc } from "../../shell/data.js";
import { BlockerPicker } from "./blocker-picker.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";

export function QuickAddBlockerDialog({
  task,
  open,
  onOpenChange,
}: {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const rpc = useTasksRpc();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addBlocker = async (candidate: DependencyTask) => {
    if (!task || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await rpc.call("addTaskDependencies", {
        dependentTaskId: task.id,
        blockerTaskIds: [candidate.task.id],
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) {
          setError(null);
          onOpenChange(next);
        }
      }}
    >
      <DialogContent className="max-w-lg p-0">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle>Add blocker…</DialogTitle>
          <DialogDescription>
            Choose a task that blocks {task?.key ?? "this task"}.
          </DialogDescription>
        </DialogHeader>
        {task ? (
          <BlockerPicker
            projectId={task.projectId}
            dependentTaskId={task.id}
            selectedTaskIds={[]}
            onSelectedTaskIdsChange={() => {}}
            onSelectTask={(candidate) => void addBlocker(candidate)}
            disabled={busy}
            embedded
          />
        ) : null}
        {error ? (
          <p role="alert" className="px-4 pb-4 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
