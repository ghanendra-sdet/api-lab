import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { RequestConfigTabs } from "./RequestConfigTabs";
import { useAppStore } from "../../store/useAppStore";
import { createEmptyTab } from "../../lib/seedData";

describe("RequestConfigTabs", () => {
  const tab = createEmptyTab({ id: "tab_test" });

  beforeEach(() => {
    useAppStore.setState({ tabs: [tab], activeTabId: tab.id });
  });

  it("marks the active panel tab as selected", () => {
    render(<RequestConfigTabs tab={tab} />);
    expect(screen.getByRole("tab", { name: "Params" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Headers" })).toHaveAttribute("aria-selected", "false");
  });

  it("switches the active panel in the store when a tab is clicked", () => {
    render(<RequestConfigTabs tab={tab} />);
    fireEvent.click(screen.getByRole("tab", { name: "Headers" }));
    expect(useAppStore.getState().tabs[0]!.activePanel).toBe("headers");
  });
});
