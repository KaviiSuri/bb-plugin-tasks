// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp } from "@bb/plugin-sdk/testing/app";

// Install the canonical plugin app test runtime before shared UI imports load.
await loadPluginApp(() => import("../../app"));
const { BlockedWorkWarningDialog } = await import("./warning-dialog");

afterEach(cleanup);

describe("BlockedWorkWarningDialog", () => {
  it("names direct blockers and requires an explicit continuation", () => {
    const onContinue = vi.fn();
    const view = render(
      <BlockedWorkWarningDialog
        open
        taskKey="TSK-8"
        blockerKeys={["TSK-2", "OPS-4"]}
        onOpenChange={() => {}}
        onContinue={onContinue}
      />,
    );

    expect(view.getByText(/TSK-8 is blocked by TSK-2, OPS-4/)).toBeTruthy();
    expect(onContinue).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Continue anyway" }));
    expect(onContinue).toHaveBeenCalledOnce();
  });
});
