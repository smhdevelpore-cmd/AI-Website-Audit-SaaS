// @vitest-environment jsdom
/**
 * The exit criteria for this phase, as tests: every input is labelled, every control has a name,
 * no link goes nowhere, and the shell's navigation works by keyboard on a narrow screen.
 *
 * A page is rendered the way a user meets it — inside the router and the providers — and the
 * DOM is then inspected, rather than trusting that a component was used correctly.
 */

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  useAuth: vi.fn(),
}));

vi.mock("../../apps/web/src/auth/AuthProvider.js", () => ({
  useAuth: auth.useAuth,
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

import { AppShell } from "../../apps/web/src/components/AppShell.js";
import { ToastProvider } from "../../apps/web/src/components/ui/Toast.js";
import { Landing } from "../../apps/web/src/pages/Landing.js";
import { Audits } from "../../apps/web/src/pages/app/Audits.js";
import { NewAuditDialog } from "../../apps/web/src/components/NewAuditDialog.js";
import { NotFound } from "../../apps/web/src/pages/app/NotFound.js";
import { Settings } from "../../apps/web/src/pages/app/Settings.js";
import { ForgotPassword } from "../../apps/web/src/pages/auth/ForgotPassword.js";
import { Login } from "../../apps/web/src/pages/auth/Login.js";
import { Register } from "../../apps/web/src/pages/auth/Register.js";
import { UiGallery } from "../../apps/web/src/pages/dev/UiGallery.js";

const signedIn = {
  status: "signed-in" as const,
  email: "alex@example.com",
  accessToken: "token",
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  requestPasswordReset: vi.fn(),
  updatePassword: vi.fn(),
};

const ROUTES = new Set([
  "/",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/dashboard",
  "/audits",
  "/settings",
]);

/** Routes with a parameter. The id is a uuid, so the shape is checked, not the value. */
const ROUTE_PATTERNS: readonly RegExp[] = [
  /^\/audits\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
];

/**
 * Renders a signed-in page with the providers it needs. The audit screens fetch, so the empty
 * list is stubbed: these tests are about the DOM the user meets, not about the network.
 */
function renderAuthed(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: [],
            meta: { page: 1, limit: 10, total: 0, totalPages: 1, hasMore: false },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ),
  );
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>{node}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  auth.useAuth.mockReturnValue(signedIn);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Every control a user can meet must be nameable by a screen reader. */
function controlProblems(root: HTMLElement): string[] {
  const problems: string[] = [];

  for (const element of root.querySelectorAll("input, select, textarea")) {
    const field = element as HTMLInputElement;
    if (field.type === "hidden") continue;
    const labelled =
      (field.labels !== null && field.labels.length > 0) ||
      field.hasAttribute("aria-label") ||
      field.hasAttribute("aria-labelledby");
    if (!labelled) problems.push(`unlabelled <${element.tagName.toLowerCase()} type="${field.type}">`);
  }

  for (const button of root.querySelectorAll("button")) {
    const named =
      (button.textContent ?? "").trim() !== "" ||
      button.hasAttribute("aria-label") ||
      button.hasAttribute("aria-labelledby");
    if (!named) problems.push("button with no accessible name");
  }

  for (const link of root.querySelectorAll("a")) {
    const named = (link.textContent ?? "").trim() !== "" || link.hasAttribute("aria-label");
    if (!named) problems.push(`link with no accessible name (${link.getAttribute("href")})`);

    const href = link.getAttribute("href");
    if (href === null || href === "" || href === "#") {
      problems.push(`link that goes nowhere (href="${href}")`);
    } else if (href.startsWith("/")) {
      const path = href.split("?")[0] as string;
      if (!ROUTES.has(path) && !ROUTE_PATTERNS.some((pattern) => pattern.test(path))) {
        problems.push(`link to a route that does not exist (${href})`);
      }
    }
  }

  for (const image of root.querySelectorAll("img")) {
    if (!image.hasAttribute("alt")) problems.push("image without alt text");
  }

  return problems;
}

function expectClean(root: HTMLElement): void {
  const problems = controlProblems(root);
  expect(problems, problems.join("\n")).toEqual([]);
}

describe("public pages", () => {
  it("landing page has labelled controls, named links and one h1", () => {
    const { container } = render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>,
    );

    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("holding your website back");
    expectClean(container);
  });

  it("landing page rejects an address that is not http(s)", async () => {
    auth.useAuth.mockReturnValue({ ...signedIn, status: "signed-out", accessToken: null });
    const user = userEvent.setup();
    const { container } = render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("Your website address"), "ftp://example.com");
    await user.click(screen.getByRole("button", { name: "Get started" }));

    expect(screen.getByText(/only http and https/i)).toBeTruthy();
    expectClean(container);
  });

  it("sign-in page labels both fields", () => {
    const { container } = render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expectClean(container);
  });

  it("registration page labels all three fields", () => {
    const { container } = render(
      <MemoryRouter>
        <Register />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText("Your name")).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expectClean(container);
  });

  it("the reset request page labels its field", () => {
    const { container } = render(
      <MemoryRouter>
        <ForgotPassword />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expectClean(container);
  });

  it("the 404 page offers a way back", () => {
    const { container } = render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Page not found");
    expectClean(container);
  });

  it("the component gallery is labelled as fixtures and still labelled for a screen reader", () => {
    const { container } = render(
      <ToastProvider>
        <UiGallery />
      </ToastProvider>,
    );
    expect(screen.getByText(/every row and number below is a fixture/i)).toBeTruthy();
    expectClean(container);
  });
});

describe("authenticated pages", () => {
  it("settings labels every field and shows no zeros for usage it does not have", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: true,
              data: {
                id: "11111111-1111-4111-8111-111111111111",
                name: "Alex",
                agencyName: null,
                website: null,
                timezone: null,
                logoUrl: null,
                updatedAt: "2026-11-27T00:00:00.000Z",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    const { container } = render(
      <ToastProvider>
        <MemoryRouter>
          <Settings />
        </MemoryRouter>
      </ToastProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText("Your name")).toBeTruthy());
    expect(screen.getByLabelText("Agency name")).toBeTruthy();
    expect(screen.getByLabelText("Website")).toBeTruthy();
    expect(screen.getByLabelText("Time zone")).toBeTruthy();
    expect(screen.getByLabelText("Report logo URL")).toBeTruthy();
    expect(screen.getByText(/no usage to report/i)).toBeTruthy();
    expectClean(container);
  });

  it("the new-audit dialog labels every field and can be dismissed with Escape", async () => {
    const user = userEvent.setup();
    const { container } = renderAuthed(<NewAuditDialog open onClose={() => undefined} />);

    expect(screen.getByRole("dialog", { name: "New audit" })).toBeTruthy();
    expect(screen.getByLabelText("Website address")).toBeTruthy();
    expect(screen.getByLabelText("Client name")).toBeTruthy();
    expect(screen.getByLabelText("Project name")).toBeTruthy();
    expect(screen.getByLabelText("Pages to scan")).toBeTruthy();
    expectClean(container);

    await user.keyboard("{Escape}");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("audit history says it is empty instead of showing a table of nothing", async () => {
    const { container } = renderAuthed(<Audits />);
    expect(screen.getByRole("heading", { name: "My audits" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "No audits yet" })).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expectClean(container);
  });
});

describe("the app shell", () => {
  function renderShell(): ReturnType<typeof render> {
    return render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/dashboard"]}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/dashboard" element={<p>Overview content</p>} />
              <Route path="/audits" element={<p>Audits content</p>} />
              <Route path="/settings" element={<p>Settings content</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );
  }

  it("marks the current page in the navigation", () => {
    renderShell();
    const current = screen
      .getAllByRole("link", { name: "Overview" })
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.length).toBeGreaterThan(0);
  });

  it("offers a skip link that points at the main region", () => {
    renderShell();
    const skip = screen.getByRole("link", { name: "Skip to content" });
    expect(skip.getAttribute("href")).toBe("#main");
    expect(document.querySelector("main")?.id).toBe("main");
  });

  it("opens the navigation on a narrow screen and reports the state", async () => {
    const user = userEvent.setup();
    renderShell();

    const menu = screen.getByRole("button", { name: "Menu" });
    expect(menu.getAttribute("aria-expanded")).toBe("false");

    await user.click(menu);
    expect(screen.getByRole("dialog", { name: "Menu" })).toBeTruthy();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the drawer after navigating from it", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: "Menu" }));
    const drawer = screen.getByRole("dialog", { name: "Menu" });
    const auditLinks = drawer.querySelectorAll('a[href="/audits"]');
    expect(auditLinks.length).toBe(1);

    await user.click(auditLinks[0] as Element);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the navigation labelled for assistive tech", () => {
    const { container } = renderShell();
    expect(screen.getAllByRole("navigation", { name: "Main" }).length).toBeGreaterThan(0);
    expectClean(container);
  });
});
