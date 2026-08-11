import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BlockingFilterChip } from "../list/filter-bar.js";
import {
  loadListPreference,
  sanitizeListPreference,
  storeListPreference,
} from "../list/list-preference.js";

describe("blocking filter", () => {
  it("offers exactly All, Blocked, and Not blocked selections", async () => {
    const onChange = vi.fn();
    render(<BlockingFilterChip value="all" onChange={onChange} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Blocking" }), {
      button: 0,
      ctrlKey: false,
    });
    const blocked = await screen.findByRole("menuitemcheckbox", {
      name: "Blocked",
    });
    expect(
      screen.getByRole("menuitemcheckbox", { name: "All" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Not blocked" }),
    ).toBeTruthy();
    fireEvent.click(blocked);
    expect(onChange).toHaveBeenCalledWith("blocked");
  });

  it("sanitizes and persists the selection with the other list filters", () => {
    window.localStorage.clear();
    expect(
      sanitizeListPreference({
        filters: {
          statuses: ["todo"],
          priorities: ["high"],
          labelNames: ["Backend"],
          blocking: "blocked",
        },
        sort: "priority",
        showSubtasks: true,
      }),
    ).toMatchObject({ filters: { blocking: "blocked" } });

    storeListPreference("all", {
      filters: {
        statuses: ["todo"],
        priorities: ["high"],
        labelNames: ["Backend"],
        blocking: "not_blocked",
      },
      sort: "due",
      showSubtasks: true,
    });
    expect(loadListPreference("all")).toMatchObject({
      filters: {
        statuses: ["todo"],
        priorities: ["high"],
        labelNames: ["Backend"],
        blocking: "not_blocked",
      },
      sort: "due",
      showSubtasks: true,
    });
  });
});
