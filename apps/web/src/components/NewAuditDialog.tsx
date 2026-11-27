/**
 * Starting an audit (TRD §5 `POST /audits`).
 *
 * The dialog collects the four things the request accepts and nothing else. Two rules shape it:
 *
 *  - The address is checked before it leaves the page (`checkSiteAddress`) so a typo costs a
 *    sentence here rather than a round trip. The server's answer always wins: a 422 replaces
 *    whatever this page thought.
 *  - A successful submission navigates to the audit's own page, because "queued" is a status
 *    someone wants to watch, not a number to remember.
 */

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError } from "../lib/api.js";
import { useCreateAudit } from "../lib/audits.js";
import { checkSiteAddress } from "../lib/site-url.js";
import { Button } from "./ui/Button.js";
import { Dialog } from "./ui/Dialog.js";
import { Input } from "./ui/Input.js";
import { useToast } from "./ui/Toast.js";

const MAX_PAGES = 25;

export function NewAuditDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateAudit();
  const toast = useToast();
  const navigate = useNavigate();

  const [address, setAddress] = useState("");
  const [clientName, setClientName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [pages, setPages] = useState("10");
  const [addressError, setAddressError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // `mutate` returns an object with a new identity on every render, so the effect cannot depend
  // on it without looping. The ref keeps the reset reachable while the dependency stays `open`.
  const resetMutation = useRef(create.reset);
  resetMutation.current = create.reset;

  // A closed dialog should not keep yesterday's error, or the next open shows a stale one.
  useEffect(() => {
    if (open) return;
    setAddressError(null);
    setFormError(null);
    resetMutation.current();
  }, [open]);

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setFormError(null);

    const check = checkSiteAddress(address);
    if (!check.ok) {
      setAddressError(check.message);
      return;
    }
    setAddressError(null);

    const requestedPages = Number.parseInt(pages, 10);
    create.mutate(
      {
        url: address.trim(),
        clientName: clientName.trim(),
        projectName: projectName.trim(),
        ...(Number.isFinite(requestedPages) && requestedPages > 0 ? { maxPages: requestedPages } : {}),
      },
      {
        onSuccess: (audit) => {
          toast.show({
            title: "Audit queued",
            description: `${audit.host} is waiting for a worker. You can follow it on its own page.`,
            tone: "success",
          });
          setAddress("");
          setClientName("");
          setProjectName("");
          onClose();
          navigate(`/audits/${audit.id}`);
        },
        onError: (error: unknown) => {
          if (!(error instanceof ApiError)) {
            setFormError("We could not start that audit. Please try again.");
            return;
          }
          if (error.code === "validation_failed") {
            const issue = error.details.find((detail) => detail.path === "url");
            setAddressError(issue?.message ?? "That address cannot be audited.");
            return;
          }
          if (error.code === "service_unavailable") {
            setFormError("Scanning is unavailable right now, so nothing was queued. Please try again later.");
            return;
          }
          setFormError(error.message);
        },
      },
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New audit"
      description="We fetch a handful of public pages and measure them. Nothing is changed on your site."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          {/* The form's submit button lives in the footer via `form`, so Enter still submits. */}
          <Button type="submit" form="new-audit-form" loading={create.isPending}>
            Start audit
          </Button>
        </>
      }
    >
      <form id="new-audit-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Input
          label="Website address"
          type="url"
          required
          autoComplete="url"
          placeholder="https://example.com"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          hint="The page to start from. Public addresses only."
          {...(addressError === null ? {} : { error: addressError })}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Client name"
            maxLength={80}
            value={clientName}
            onChange={(event) => setClientName(event.target.value)}
            hint="Optional. Appears in the report."
          />
          <Input
            label="Project name"
            maxLength={80}
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            hint="Optional."
          />
        </div>

        <Input
          label="Pages to scan"
          type="number"
          min={1}
          max={MAX_PAGES}
          step={1}
          value={pages}
          onChange={(event) => setPages(event.target.value)}
          hint={`1 to ${MAX_PAGES}. The server caps this at its own limit.`}
        />

        {formError === null ? null : (
          <p
            role="alert"
            className="rounded-[var(--radius-control)] bg-tint-critical px-3 py-2 text-sm text-critical-strong"
          >
            {formError}
          </p>
        )}
      </form>
    </Dialog>
  );
}
