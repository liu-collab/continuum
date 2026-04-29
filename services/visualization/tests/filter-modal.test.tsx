import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FilterModalButton } from "@/components/filter-modal";
import { FormField } from "@/components/form-field";
import { SearchForm } from "@/components/search-form";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push
  })
}));

describe("filter modal button", () => {
  it("renders modal content as regular children and submits through search form", async () => {
    const user = userEvent.setup();
    push.mockReset();

    render(
      <FilterModalButton activeCount={1} title="筛选记忆" description="按条件筛选">
        <SearchForm action="/memories" initialValues={{ workspace_id: "ws-1" }}>
          <FormField label="工作区" name="workspace_id" placeholder="workspace id" defaultValue="ws-1" />
        </SearchForm>
      </FilterModalButton>
    );

    expect(screen.queryByText("筛选记忆")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /筛选/ }));

    expect(screen.getByText("筛选记忆")).toBeInTheDocument();
    expect(screen.getByDisplayValue("ws-1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "应用" }));

    expect(push).toHaveBeenCalledWith("/memories?workspace_id=ws-1");
    expect(screen.getByTestId("search-form-pending")).toHaveTextContent("正在加载结果");
  });

  it("renders dropdown options above the modal scroll container", async () => {
    const user = userEvent.setup();

    render(
      <FilterModalButton activeCount={1} title="筛选治理记录" description="按条件筛选">
        <SearchForm action="/governance" initialValues={{ proposal_type: "" }}>
          <FormField
            label="动作"
            name="proposal_type"
            options={[
              { label: "归档", value: "archive" },
              { label: "确认", value: "confirm" }
            ]}
          />
        </SearchForm>
      </FilterModalButton>
    );

    await user.click(screen.getByRole("button", { name: /筛选/ }));
    await user.click(screen.getByRole("button", { name: "动作" }));

    const listbox = screen.getByRole("listbox");
    expect(listbox.parentElement).toBe(document.body);
    expect(listbox).toHaveStyle({ position: "fixed", zIndex: "80" });
  });
});
