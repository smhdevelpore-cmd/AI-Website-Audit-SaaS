import { useState } from "react";

import { Input, type InputProps } from "./Input.js";

/**
 * A password field with a show/hide toggle. The toggle is a real button with a name and
 * `aria-pressed`, so the state it controls is announced rather than implied by an eye icon.
 */
export function PasswordInput({ label, hint, ...rest }: Omit<InputProps, "type" | "addon">) {
  const [visible, setVisible] = useState(false);

  return (
    <Input
      {...rest}
      label={label}
      hint={hint}
      type={visible ? "text" : "password"}
      addon={
        <button
          type="button"
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
          className="h-9 shrink-0 rounded-[var(--radius-control)] border border-line-strong px-2 text-xs font-medium text-ink"
        >
          {visible ? "Hide" : "Show"}
        </button>
      }
    />
  );
}
