import { useId, type InputHTMLAttributes, type ReactNode } from "react";

import { cx } from "../cx.js";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  /** Required, not optional: an input without a label is the failure this component prevents. */
  label: string;
  hint?: ReactNode;
  error?: string;
  /** Rendered inside the field, e.g. a show/hide toggle. */
  addon?: ReactNode;
}

/**
 * A labelled text input with hint and error wiring: `aria-describedby` points at whichever of
 * hint/error is present, and `aria-invalid` is set when there is an error. The `label` prop is
 * mandatory, so there is no way to render this component unlabelled.
 */
export function Input({ label, hint, error, addon, className, ...rest }: InputProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint === undefined ? null : hintId, error === undefined ? null : errorId]
    .filter((value): value is string => value !== null)
    .join(" ");

  return (
    <div className="flex flex-col gap-1.5">
      {/* The asterisk sits beside the label, not inside it: `<label>` text is what assistive
          tech reads, and "Email*" is not a field name. `required` is announced natively. */}
      <div className="flex items-center gap-1">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
        </label>
        {rest.required === true ? (
          <span className="text-muted" aria-hidden="true">
            *
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <input
          {...rest}
          id={id}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={describedBy === "" ? undefined : describedBy}
          className={cx(
            "h-11 w-full rounded-[var(--radius-control)] border bg-surface px-3 text-sm text-ink",
            "placeholder:text-muted disabled:bg-tint-neutral disabled:text-muted",
            error === undefined ? "border-line-strong" : "border-critical",
            className,
          )}
        />
        {addon}
      </div>

      {hint === undefined ? null : (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p id={errorId} className="text-sm font-medium text-critical-strong">
          {error}
        </p>
      )}
    </div>
  );
}
