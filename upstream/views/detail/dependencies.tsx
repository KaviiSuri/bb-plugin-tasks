import { useState } from "react";
import type { DependencyTask, Task } from "../../shared/contract.js";
import {
  dependencyCandidates,
  type DependencyDirection,
} from "./dependencies-model.js";
import { useTasksNavigation } from "../../shell/routes.js";
import { STATUS_LABELS, StatusIcon } from "./meta.js";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@bb/shared-ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@bb/shared-ui/popover";
import { Icon } from "@bb/shared-ui/icon";

export type { DependencyDirection } from "./dependencies-model.js";

function DependencyPicker({
  label,
  candidates,
  onSelect,
}: {
  label: string;
  candidates: DependencyTask[];
  onSelect: (candidate: DependencyTask) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <Icon name="Plus" className="size-3" />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(26rem,var(--radix-popover-content-available-width))] p-0"
        mobileTitle={label}
      >
        <Command>
          <CommandInput placeholder="Search by key, title, or project…" />
          <CommandList>
            <CommandEmpty>No matching tasks.</CommandEmpty>
            <CommandGroup>
              {candidates.map((candidate) => (
                <CommandItem
                  key={candidate.task.id}
                  value={`${candidate.task.key} ${candidate.task.title} ${candidate.project.name}`}
                  onSelect={() => {
                    onSelect(candidate);
                    setOpen(false);
                  }}
                >
                  <StatusIcon status={candidate.task.status} />
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {candidate.task.key}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {candidate.task.title}
                  </span>
                  <span className="max-w-28 truncate text-2xs text-muted-foreground">
                    {candidate.project.name}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function DependencyCollection({
  title,
  direction,
  items,
  candidates,
  busy,
  onAdd,
  onRemove,
}: {
  title: string;
  direction: DependencyDirection;
  items: DependencyTask[];
  candidates: DependencyTask[];
  busy: boolean;
  onAdd: (direction: DependencyDirection, candidate: DependencyTask) => void;
  onRemove: (direction: DependencyDirection, candidate: DependencyTask) => void;
}) {
  const navigation = useTasksNavigation();
  return (
    <div className="min-w-0 flex-1">
      <h2 className="mb-1 text-xs font-semibold text-muted-foreground">{title}</h2>
      {items.map((item) => (
        <div
          key={item.task.id}
          className="group flex h-8 items-center gap-2 border-b border-border-hairline text-sm"
        >
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-foreground"
            title={`${STATUS_LABELS[item.task.status]} · ${item.project.name}`}
            onClick={() =>
              navigation.go({ kind: "task", taskKey: item.task.key })
            }
          >
            <StatusIcon status={item.task.status} />
            <span className="shrink-0 text-xs text-muted-foreground">
              {item.task.key}
            </span>
            <span className="min-w-0 flex-1 truncate">{item.task.title}</span>
            <span className="max-w-28 truncate text-2xs text-muted-foreground">
              {item.project.name}
            </span>
          </button>
          <button
            type="button"
            aria-label={`Remove ${title.toLowerCase()} ${item.task.key}`}
            disabled={busy}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-state-hover hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-40"
            onClick={() => onRemove(direction, item)}
          >
            <Icon name="X" className="size-3" />
          </button>
        </div>
      ))}
      <DependencyPicker
        label={direction === "blockedBy" ? "Add blocker" : "Add blocked task"}
        candidates={candidates}
        onSelect={(candidate) => onAdd(direction, candidate)}
      />
    </div>
  );
}

export function DependenciesSection({
  task,
  blockedBy,
  blocks,
  allTasks,
  busy,
  onAdd,
  onRemove,
}: {
  task: Task;
  blockedBy: DependencyTask[];
  blocks: DependencyTask[];
  allTasks: DependencyTask[];
  busy: boolean;
  onAdd: (direction: DependencyDirection, candidate: DependencyTask) => void;
  onRemove: (direction: DependencyDirection, candidate: DependencyTask) => void;
}) {
  return (
    <section className="mt-6 grid gap-5 border-t border-border-hairline pt-5 @[36rem]:grid-cols-2">
      <DependencyCollection
        title="Blocked by"
        direction="blockedBy"
        items={blockedBy}
        candidates={dependencyCandidates(task, allTasks, blockedBy, blocks, "blockedBy")}
        busy={busy}
        onAdd={onAdd}
        onRemove={onRemove}
      />
      <DependencyCollection
        title="Blocks"
        direction="blocks"
        items={blocks}
        candidates={dependencyCandidates(task, allTasks, blockedBy, blocks, "blocks")}
        busy={busy}
        onAdd={onAdd}
        onRemove={onRemove}
      />
    </section>
  );
}
