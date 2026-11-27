// @vitest-environment jsdom
/**
 * The shared components. These assert behaviour a user can perceive — names, roles, states —
 * not class names, so a styling change does not break them and a real regression does.
 */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Badge } from "../../apps/web/src/components/ui/Badge.js";
import { Button } from "../../apps/web/src/components/ui/Button.js";
import { Card, CardDescription, CardTitle } from "../../apps/web/src/components/ui/Card.js";
import { EmptyState } from "../../apps/web/src/components/ui/EmptyState.js";
import { ErrorState } from "../../apps/web/src/components/ui/ErrorState.js";
import { Input } from "../../apps/web/src/components/ui/Input.js";
import { PageHeader } from "../../apps/web/src/components/ui/PageHeader.js";
import { PasswordInput } from "../../apps/web/src/components/ui/PasswordInput.js";
import { Skeleton } from "../../apps/web/src/components/ui/Skeleton.js";
import { DataTable } from "../../apps/web/src/components/ui/Table.js";

afterEach(cleanup);

describe("Button", () => {
  it("renders a button with its label as the accessible name", () => {
    render(<Button>Save changes</Button>);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
  });

  it("is disabled and marked busy while loading, keeping its name", () => {
    render(<Button loading>Saving</Button>);
    const button = screen.getByRole("button", { name: "Saving" });
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not set aria-busy when idle", () => {
    render(<Button>Idle</Button>);
    expect(screen.getByRole("button", { name: "Idle" }).getAttribute("aria-busy")).toBeNull();
  });

  it("defaults to type=button so a button inside a form cannot submit it by accident", () => {
    render(<Button>Not a submit</Button>);
    expect(screen.getByRole("button", { name: "Not a submit" }).getAttribute("type")).toBe("button");
  });

  it("calls the click handler", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Act</Button>);
    await userEvent.setup().click(screen.getByRole("button", { name: "Act" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("Input", () => {
  it("associates its label with the field", () => {
    render(<Input label="Email" />);
    const field = screen.getByLabelText("Email");
    expect(field.tagName).toBe("INPUT");
  });

  it("points aria-describedby at the hint", () => {
    render(<Input label="Website" hint="Shown on reports." />);
    const field = screen.getByLabelText("Website");
    const hintId = field.getAttribute("aria-describedby");
    expect(hintId).toBeTruthy();
    expect(document.getElementById(hintId as string)?.textContent).toBe("Shown on reports.");
  });

  it("marks an error with aria-invalid and describes it", () => {
    render(<Input label="Website" error="Use an https address." />);
    const field = screen.getByLabelText("Website");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    const describedBy = field.getAttribute("aria-describedby");
    expect(document.getElementById(describedBy as string)?.textContent).toBe("Use an https address.");
  });

  it("describes both the hint and the error when both are present", () => {
    render(<Input label="Name" hint="Your full name." error="Required." />);
    const field = screen.getByLabelText("Name");
    const ids = (field.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
    expect(ids).toHaveLength(2);
  });

  it("hides the required asterisk from the accessible name, which already gets the attribute", () => {
    render(<Input label="Name" required />);
    // Computed name, not text content: `aria-hidden` must keep the asterisk out of it.
    const field = screen.getByRole("textbox", { name: "Name" });
    expect((field as HTMLInputElement).required).toBe(true);
    expect(screen.getByText("*").getAttribute("aria-hidden")).toBe("true");
  });
});

describe("PasswordInput", () => {
  it("starts masked and reveals on request, reporting the state", async () => {
    render(<PasswordInput label="Password" />);
    const field = screen.getByLabelText("Password") as HTMLInputElement;
    expect(field.type).toBe("password");

    const toggle = screen.getByRole("button", { name: "Show" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    await userEvent.setup().click(toggle);
    expect(field.type).toBe("text");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("Badge", () => {
  it("carries its meaning in text, not colour alone", () => {
    render(
      <>
        <Badge tone="success">Completed</Badge>
        <Badge tone="critical">Failed</Badge>
      </>,
    );
    expect(screen.getByText("Completed")).toBeTruthy();
    expect(screen.getByText("Failed")).toBeTruthy();
  });
});

describe("Card and PageHeader", () => {
  it("gives the card a heading and description", () => {
    render(
      <Card>
        <CardTitle>Recent audits</CardTitle>
        <CardDescription>The last few scans.</CardDescription>
      </Card>,
    );
    expect(screen.getByRole("heading", { name: "Recent audits" })).toBeTruthy();
    expect(screen.getByText("The last few scans.")).toBeTruthy();
  });

  it("renders the page title as the page's level-one heading", () => {
    render(<PageHeader title="Settings" description="Your details." />);
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeTruthy();
    expect(screen.getByText("Your details.")).toBeTruthy();
  });
});

describe("EmptyState and ErrorState", () => {
  it("renders no action when there is none", () => {
    render(<EmptyState title="No audits yet" description="Nothing has run." />);
    expect(screen.getByRole("heading", { name: "No audits yet" })).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders the provided action", () => {
    render(<EmptyState title="Empty" description="Nothing." action={<Button>Start</Button>} />);
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
  });

  it("announces a failure as an alert and retries on request", async () => {
    const onRetry = vi.fn();
    render(<ErrorState description="The request failed." onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("offers no retry button when retrying makes no sense", () => {
    render(<ErrorState description="This cannot be retried." />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("Skeleton", () => {
  it("is hidden from assistive tech, which is told the state in words elsewhere", () => {
    render(<Skeleton className="h-4" />);
    const placeholder = document.querySelector('[aria-hidden="true"]');
    expect(placeholder).toBeTruthy();
  });
});

interface Row {
  domain: string;
  issues: number;
}

const ROWS: Row[] = [
  { domain: "fixture-one.example", issues: 3 },
  { domain: "fixture-two.example", issues: 1 },
];

describe("DataTable", () => {
  it("exposes a named table with column headers and a row per record", () => {
    render(
      <DataTable<Row>
        caption="Fixture audits"
        rows={ROWS}
        getRowKey={(row) => row.domain}
        emptyMessage="Nothing to show."
        columns={[
          { key: "domain", header: "Domain", cell: (row) => row.domain },
          { key: "issues", header: "Issues", cell: (row) => row.issues },
        ]}
      />,
    );

    expect(screen.getByRole("table", { name: "Fixture audits" })).toBeTruthy();
    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Domain", "Issues"]);
    // header row + two data rows
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("renders the empty message instead of an empty table", () => {
    render(
      <DataTable<Row>
        caption="Fixture audits"
        rows={[]}
        getRowKey={(row) => row.domain}
        emptyMessage="No audits yet."
        columns={[{ key: "domain", header: "Domain", cell: (row) => row.domain }]}
      />,
    );
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("No audits yet.")).toBeTruthy();
  });

  it("keeps every cell labelled in the stacked mobile layout", () => {
    render(
      <DataTable<Row>
        caption="Fixture audits"
        rows={ROWS}
        getRowKey={(row) => row.domain}
        emptyMessage="Nothing to show."
        columns={[
          { key: "domain", header: "Domain", cell: (row) => row.domain },
          { key: "issues", header: "Issues", cell: (row) => row.issues },
        ]}
      />,
    );
    // Both presentations exist in the DOM; CSS chooses one, so the labels are never dropped.
    const lists = screen.getAllByRole("list", { name: "Fixture audits" });
    expect(lists.length).toBeGreaterThan(0);
    expect(screen.getAllByText("Issues").length).toBeGreaterThanOrEqual(2);
  });
});
