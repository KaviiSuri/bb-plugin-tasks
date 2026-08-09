import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import type { DependencyTask } from "../../shared/contract.js";
import { isTerminalTaskStatus } from "../../shared/blocker-candidates.js";
import { useTasksQuery, useTasksRpc } from "../../shell/data.js";
import { groupBlockerCandidates } from "./blocker-picker-model.js";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@bb/shared-ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";

const CHIP_TRIGGER =
  "h-7 w-auto gap-1.5 rounded-md px-2 text-xs text-muted-foreground";

export interface BlockerPickerHandle {
  /** Re-resolve controlled IDs immediately before create. */
  revalidateSelection(): Promise<string[]>;
}

interface BlockerPickerProps {
  projectId: string | null;
  selectedTaskIds: string[];
  onSelectedTaskIdsChange: (taskIds: string[]) => void;
  disabled?: boolean;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
}

function terminalLabel(candidate: DependencyTask): string | null {
  if (candidate.task.status === "done") return "Done";
  if (candidate.task.status === "canceled") return "Canceled";
  return null;
}

export const BlockerPicker = forwardRef<
  BlockerPickerHandle,
  BlockerPickerProps
>(function BlockerPicker(
  { projectId, selectedTaskIds, onSelectedTaskIdsChange, disabled = false },
  ref,
) {
  const rpc = useTasksRpc();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedItems, setSelectedItems] = useState<DependencyTask[]>([]);

  // Keep resolving while the popover is open or a selection exists. Task
  // invalidations therefore prune deleted/newly-invalid selected blockers even
  // after the picker closes.
  const search = useTasksQuery(
    async (client) => {
      const requestedSelectedTaskIds = [...selectedTaskIds];
      if (projectId === null || (!open && selectedTaskIds.length === 0)) {
        return { candidates: [], selected: [], requestedSelectedTaskIds };
      }
      const result = await client.call("searchBlockerCandidates", {
        projectId,
        query: open ? query : "",
        selectedTaskIds,
      });
      return { ...result, requestedSelectedTaskIds };
    },
    ["tasks:changed"],
    [projectId, open, query, selectedTaskIds],
  );

  useEffect(() => {
    if (
      !search.data ||
      !sameIds(search.data.requestedSelectedTaskIds, selectedTaskIds)
    ) {
      return;
    }
    const durableIds = search.data.selected.map(
      (candidate) => candidate.task.id,
    );
    setSelectedItems(search.data.selected);
    if (!sameIds(durableIds, selectedTaskIds)) {
      onSelectedTaskIdsChange(durableIds);
    }
  }, [search.data, selectedTaskIds, onSelectedTaskIdsChange]);

  useEffect(() => {
    if (selectedTaskIds.length === 0) setSelectedItems([]);
  }, [selectedTaskIds.length]);

  useImperativeHandle(
    ref,
    () => ({
      async revalidateSelection() {
        if (projectId === null || selectedTaskIds.length === 0) return [];
        const result = await rpc.call("searchBlockerCandidates", {
          projectId,
          query: "",
          selectedTaskIds,
          limit: 1,
        });
        const durableIds = result.selected.map(
          (candidate) => candidate.task.id,
        );
        setSelectedItems(result.selected);
        if (!sameIds(durableIds, selectedTaskIds)) {
          onSelectedTaskIdsChange(durableIds);
        }
        return durableIds;
      },
    }),
    [projectId, rpc, selectedTaskIds, onSelectedTaskIdsChange],
  );

  const groups = useMemo(
    () =>
      projectId === null || search.isLoading
        ? []
        : groupBlockerCandidates(search.data?.candidates ?? [], projectId),
    [projectId, search.data, search.isLoading],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-label="Blocked by"
          className={cn(CHIP_TRIGGER, "border-input font-normal")}
        >
          <Icon name="CornerDownRight" className="size-3" />
          {selectedItems.length === 0
            ? "Blocked by"
            : selectedItems.length === 1
              ? `Blocked by · ${selectedItems[0]!.task.key}`
              : `Blocked by · ${selectedItems.length}`}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(30rem,var(--radix-popover-content-available-width))] p-0"
        align="start"
        mobileTitle="Blocked by"
      >
        {selectedItems.length > 0 ? (
          <div className="border-b border-border-hairline p-2">
            <p className="mb-1 px-1 text-2xs font-medium text-muted-foreground">
              Selected blockers
            </p>
            <div className="flex flex-wrap gap-1">
              {selectedItems.map((candidate) => {
                const status = terminalLabel(candidate);
                return (
                  <button
                    key={candidate.task.id}
                    type="button"
                    disabled={disabled}
                    aria-label={`Remove blocker ${candidate.task.key}`}
                    className="flex max-w-full items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs hover:bg-state-hover disabled:opacity-50"
                    onClick={() => {
                      setSelectedItems((current) =>
                        current.filter(
                          (item) => item.task.id !== candidate.task.id,
                        ),
                      );
                      onSelectedTaskIdsChange(
                        selectedTaskIds.filter(
                          (id) => id !== candidate.task.id,
                        ),
                      );
                    }}
                  >
                    <span className="font-medium">{candidate.task.key}</span>
                    <span className="max-w-40 truncate text-muted-foreground">
                      {candidate.task.title}
                    </span>
                    {status ? (
                      <span className="rounded bg-background px-1 text-2xs text-muted-foreground">
                        {status}
                      </span>
                    ) : null}
                    <Icon name="X" className="size-3" />
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search task keys and titles…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>
              {search.isLoading
                ? "Searching tasks…"
                : (search.error ?? "No valid blockers found.")}
            </CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.key} heading={group.label}>
                {group.candidates.map((candidate) => {
                  const status = isTerminalTaskStatus(candidate.task.status)
                    ? terminalLabel(candidate)
                    : null;
                  return (
                    <CommandItem
                      key={candidate.task.id}
                      value={candidate.task.id}
                      onSelect={() => {
                        setSelectedItems((current) => [...current, candidate]);
                        onSelectedTaskIdsChange([
                          ...selectedTaskIds,
                          candidate.task.id,
                        ]);
                        setQuery("");
                      }}
                    >
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-sm"
                        style={{ backgroundColor: candidate.project.color }}
                      />
                      <span className="shrink-0 font-medium text-muted-foreground">
                        {candidate.task.key}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {candidate.task.title}
                      </span>
                      {status ? (
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">
                          {status}
                        </span>
                      ) : null}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
});
