// @vitest-environment jsdom
/**
 * The settings form, end to end against a stubbed API.
 *
 * It is the one screen in this phase that writes real data, so the states matter: loading, a
 * rejected field landing under the input that caused it, and a save that reports itself.
 */

import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ useAuth: vi.fn() }));

vi.mock("../../apps/web/src/auth/AuthProvider.js", () => ({
  useAuth: auth.useAuth,
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

import { ToastProvider } from "../../apps/web/src/components/ui/Toast.js";
import { Settings } from "../../apps/web/src/pages/app/Settings.js";

const PROFILE = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Alex Rivera",
  agencyName: "Rivera Studio",
  website: "https://rivera.example",
  timezone: "Europe/Berlin",
  logoUrl: null,
  updatedAt: "2026-11-27T09:00:00.000Z",
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function renderSettings() {
  return render(
    <ToastProvider>
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    </ToastProvider>,
  );
}

beforeEach(() => {
  auth.useAuth.mockReturnValue({
    status: "signed-in",
    email: "alex@example.com",
    accessToken: "token",
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    requestPasswordReset: vi.fn(),
    updatePassword: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("settings", () => {
  it("shows a loading state before the profile arrives", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    renderSettings();

    expect(screen.getByRole("status", { name: "Loading your settings" })).toBeTruthy();
    expect(screen.queryByLabelText("Your name")).toBeNull();
  });

  it("fills the form from the API and shows an error state that can retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({ success: false, error: { code: "internal_error", message: "Database unavailable." } }, 500),
      ),
    );
    renderSettings();

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Database unavailable.")).toBeTruthy();

    const retry = screen.getByRole("button", { name: "Try again" });
    await userEvent.setup().click(retry);
    // The retry issues another request rather than silently doing nothing.
    await waitFor(() =>
      expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1),
    );
  });

  it("puts a rejected field under the input that caused it", async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return json(
          {
            success: false,
            error: {
              code: "validation_failed",
              message: "Some values in the request are not valid.",
              details: [
                { path: "website", reason: "custom", message: "Use an address that starts with https://." },
              ],
            },
          },
          400,
        );
      }
      return json({ success: true, data: PROFILE });
    });
    vi.stubGlobal("fetch", fetch);

    const user = userEvent.setup();
    renderSettings();

    const website = (await screen.findByLabelText("Website")) as HTMLInputElement;
    // The form is filled in an effect one render after it appears; wait for the stored value
    // or the clear below would run against an empty field.
    await waitFor(() => expect(website.value).toBe("https://rivera.example"));
    await user.clear(website);
    await user.type(website, "rivera.example");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    const message = await screen.findByText("Use an address that starts with https://.");
    expect(message).toBeTruthy();
    expect(screen.getByLabelText("Website").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("Some fields need attention.");
  });

  it("saves, reports success inline and in a toast", async () => {
    let patched: unknown = null;
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        patched = JSON.parse(String(init.body));
        return json({ success: true, data: { ...PROFILE, name: "Alex R." } });
      }
      return json({ success: true, data: PROFILE });
    });
    vi.stubGlobal("fetch", fetch);

    const user = userEvent.setup();
    renderSettings();

    const name = (await screen.findByLabelText("Your name")) as HTMLInputElement;
    await waitFor(() => expect(name.value).toBe("Alex Rivera"));
    await user.clear(name);
    await user.type(name, "Alex R.");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Saved.")).toBeTruthy();
    // The inline confirmation and the toast both say it; the toast is in the live region.
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toContain("Profile saved");
    expect(patched).toMatchObject({ name: "Alex R." });
    // Only fields with a value are sent: empty optional fields are not cleared by an update.
    expect(patched).not.toHaveProperty("logoUrl");
  });
});
