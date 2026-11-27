// @vitest-environment jsdom
/**
 * Dialog focus behaviour and toasts. The dialog is where keyboard users get stranded when it is
 * done wrong, so the rules from Design.md §7 are asserted rather than assumed.
 */

import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button } from "../../apps/web/src/components/ui/Button.js";
import { Dialog } from "../../apps/web/src/components/ui/Dialog.js";
import { Input } from "../../apps/web/src/components/ui/Input.js";
import { ToastProvider, useToast } from "../../apps/web/src/components/ui/Toast.js";

afterEach(cleanup);

function Harness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open settings</Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          onClose();
        }}
        title="Delete audit"
        description="This cannot be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={() => setOpen(false)}>
              Delete
            </Button>
          </>
        }
      >
        <Input label="Type the domain to confirm" />
      </Dialog>
    </>
  );
}

describe("Dialog", () => {
  it("renders nothing while closed", () => {
    render(
      <Dialog open={false} onClose={() => undefined} title="Hidden">
        Body
      </Dialog>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is a modal dialog named by its title", () => {
    render(
      <Dialog open onClose={() => undefined} title="Delete audit" description="This cannot be undone.">
        Body
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Delete audit" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByText("This cannot be undone.")).toBeTruthy();
  });

  it("moves focus inside when it opens", async () => {
    const user = userEvent.setup();
    render(<Harness onClose={() => undefined} />);
    expect(document.activeElement).toBe(document.body);

    await user.click(screen.getByRole("button", { name: "Open settings" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close dialog" }));
  });

  it("returns focus to whatever opened it", async () => {
    const user = userEvent.setup();
    render(<Harness onClose={() => undefined} />);
    const opener = screen.getByRole("button", { name: "Open settings" });

    await user.click(opener);
    await user.click(screen.getByRole("button", { name: "Close dialog" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Open settings" }));
    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps Tab inside the dialog", async () => {
    const user = userEvent.setup();
    render(<Harness onClose={() => undefined} />);
    await user.click(screen.getByRole("button", { name: "Open settings" }));

    const dialog = screen.getByRole("dialog");
    // Tab through everything inside; focus must never leave the panel.
    for (let press = 0; press < 8; press += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement), `focus escaped on tab ${press + 1}`).toBe(true);
    }
  });

  it("wraps from the last control back to the first", async () => {
    const user = userEvent.setup();
    render(<Harness onClose={() => undefined} />);
    await user.click(screen.getByRole("button", { name: "Open settings" }));

    const deleteButton = screen.getByRole("button", { name: "Delete" });
    deleteButton.focus();
    await user.tab();

    const dialog = screen.getByRole("dialog");
    const focusables = dialog.querySelectorAll<HTMLElement>("button, input");
    expect(document.activeElement).toBe(focusables[0]);
  });

  it("closes when the backdrop is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Open settings" }));

    const backdrop = document.querySelector('[aria-hidden="true"].absolute');
    expect(backdrop).toBeTruthy();
    await user.click(backdrop as Element);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

function ToastTrigger({ label, title }: { label: string; title: string }) {
  const toast = useToast();
  return <Button onClick={() => toast.show({ title, tone: "success" })}>{label}</Button>;
}

describe("Toast", () => {
  it("announces a message in a polite live region", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ToastTrigger label="Save" title="Profile saved" />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Save" }));

    const region = document.querySelector('[aria-live="polite"]');
    expect(region).toBeTruthy();
    expect(region?.textContent).toContain("Profile saved");
    expect(screen.getByRole("status").textContent).toContain("Profile saved");
  });

  it("can be dismissed", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ToastTrigger label="Save" title="Profile saved" />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("button", { name: "Dismiss: Profile saved" }));

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps several messages at once", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ToastTrigger label="First" title="First message" />
        <ToastTrigger label="Second" title="Second message" />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "First" }));
    await user.click(screen.getByRole("button", { name: "Second" }));

    expect(screen.getAllByRole("status")).toHaveLength(2);
  });
});
