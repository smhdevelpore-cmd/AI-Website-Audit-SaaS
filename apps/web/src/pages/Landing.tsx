import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider.js";
import { Badge } from "../components/ui/Badge.js";
import { Button } from "../components/ui/Button.js";
import { Card } from "../components/ui/Card.js";
import { Input } from "../components/ui/Input.js";
import { checkSiteAddress } from "../lib/site-url.js";

/**
 * The marketing page (Design.md §4 "Landing").
 *
 * Two rules govern the copy. Nothing here states a measurement, a customer, a number or a
 * guarantee: the product has no users and no scans to cite. And nothing pretends a scan can
 * start from this page — the address field is checked for obvious typing mistakes, then handed
 * to sign-up, where an account is created first and the server runs the real SSRF gate.
 */

const FEATURES = [
  {
    title: "Real measurements, labelled",
    body: "Every number comes from the page itself or a named provider. A PageSpeed score is never presented as our own check, and a missing measurement reads as N/A rather than zero.",
  },
  {
    title: "Evidence with every finding",
    body: "Each finding carries the affected URL, what was detected, and the evidence behind it — so a claim can be shown to a client rather than asserted.",
  },
  {
    title: "An action plan, not a wall of red",
    body: "Findings are ordered by impact and marked with difficulty, so the first item on the list is the one worth starting on Monday.",
  },
  {
    title: "A report you can send",
    body: "A PDF built from the stored snapshot: scores, methodology, limitations and findings, with your agency details on the cover.",
  },
] as const;

const STEPS = [
  { title: "Add the website", body: "A public address. We validate it before anything is fetched." },
  {
    title: "We scan a bounded set of pages",
    body: "A page limit you set, a time limit, and only HTML over HTTP(S).",
  },
  {
    title: "Review and export",
    body: "Scores with their methodology, findings with evidence, and the report.",
  },
] as const;

const TRUST = [
  "Public pages only — no logins, no private areas, no form submissions.",
  "Scores are deterministic and the weights appear in the report. Unavailable data is N/A, never zero.",
  "AI explains the evidence. It cannot invent a finding, change a measurement or raise a score.",
  "No promises about rankings, traffic or revenue. The findings are what we can show.",
] as const;

export function Landing() {
  const navigate = useNavigate();
  const { status } = useAuth();
  const [site, setSite] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (status === "signed-in") {
      navigate("/dashboard");
      return;
    }

    if (site.trim() === "") {
      // The address is optional here: someone can create an account without one.
      navigate("/register");
      return;
    }

    const checked = checkSiteAddress(site);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    navigate(`/register?site=${encodeURIComponent(checked.href)}`);
  }

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2 text-sm font-semibold text-ink">
            <span aria-hidden="true" className="inline-block size-3 rounded-sm bg-primary" />
            Site Audit
          </Link>
          <nav aria-label="Account" className="flex items-center gap-2">
            <Link
              to="/login"
              className="rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium text-ink hover:bg-tint-neutral"
            >
              Sign in
            </Link>
            <Link to="/register">
              <Button size="sm">Create account</Button>
            </Link>
          </nav>
        </div>
      </header>

      <main id="main">
        {/* Hero */}
        <section className="mx-auto grid max-w-5xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-2 lg:items-start lg:py-16">
          <div>
            <Badge tone="brand">Website audits for agencies</Badge>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              Find what&rsquo;s holding your website back.
            </h1>
            <p className="mt-4 max-w-prose text-base text-muted">
              Audit performance, SEO, and technical issues. Turn real findings into a clear action plan and
              client-ready report.
            </p>

            <form
              onSubmit={onSubmit}
              className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end"
              noValidate
            >
              <div className="flex-1">
                <Input
                  label="Your website address"
                  type="url"
                  inputMode="url"
                  placeholder="https://example.com"
                  value={site}
                  onChange={(event) => setSite(event.target.value)}
                  {...(error === null ? {} : { error })}
                />
              </div>
              <Button type="submit" className="sm:mb-0.5">
                Get started
              </Button>
            </form>

            <p className="mt-3 text-sm text-muted">
              Creating an account comes first. No scan starts from this page.
            </p>
          </div>

          {/* Illustrative preview: structure only, no measurements. */}
          <Card className="lg:mt-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-ink">What a report contains</h2>
              <Badge tone="neutral">Illustrative layout</Badge>
            </div>
            <p className="mt-1 text-xs text-muted">
              A layout sample. No website has been scanned for this image.
            </p>

            <div className="mt-4 rounded-[var(--radius-control)] border border-line p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Overall score</p>
              <p className="mt-1 text-2xl font-semibold text-ink" aria-hidden="true">
                —
              </p>
              <p className="sr-only">Score placeholder</p>
            </div>

            <ul className="mt-4 space-y-2">
              {["Performance", "SEO", "Technical", "Mobile", "Accessibility", "Security"].map((category) => (
                <li key={category} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-ink">{category}</span>
                  <span aria-hidden="true" className="h-2 w-24 rounded-full bg-tint-neutral" />
                  <span className="sr-only">No score shown</span>
                </li>
              ))}
            </ul>

            <p className="mt-4 text-xs text-muted">
              Findings, evidence and the action plan follow the scores. Unavailable data stays N/A.
            </p>
          </Card>
        </section>

        {/* Features */}
        <section aria-labelledby="features-heading" className="border-y border-line bg-surface">
          <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
            <h2 id="features-heading" className="text-xl font-semibold tracking-tight text-ink">
              What you get
            </h2>
            <ul className="mt-6 grid gap-4 sm:grid-cols-2">
              {FEATURES.map((feature) => (
                <li key={feature.title}>
                  <Card className="h-full">
                    <h3 className="text-sm font-semibold text-ink">{feature.title}</h3>
                    <p className="mt-2 text-sm text-muted">{feature.body}</p>
                  </Card>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* How it works */}
        <section aria-labelledby="steps-heading" className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
          <h2 id="steps-heading" className="text-xl font-semibold tracking-tight text-ink">
            How it works
          </h2>
          <ol className="mt-6 grid gap-4 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
                <span className="inline-flex size-7 items-center justify-center rounded-full bg-tint-brand text-sm font-semibold text-primary-strong">
                  <span className="sr-only">Step </span>
                  {index + 1}
                </span>
                <h3 className="mt-3 text-sm font-semibold text-ink">{step.title}</h3>
                <p className="mt-1 text-sm text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Audience and trust */}
        <section aria-labelledby="trust-heading" className="border-t border-line bg-surface">
          <div className="mx-auto grid max-w-5xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-2">
            <div>
              <h2 id="trust-heading" className="text-xl font-semibold tracking-tight text-ink">
                Built for people who audit for a living
              </h2>
              <p className="mt-3 text-sm text-muted">
                Small agencies and freelancers doing SEO, web design, growth or maintenance work. The job is
                not &ldquo;find every possible issue&rdquo; — it is preparing a clear, credible audit and
                action plan quickly enough to send it the same afternoon.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink">What we will not do</h3>
              <ul className="mt-3 space-y-2">
                {TRUST.map((item) => (
                  <li key={item} className="flex gap-2 text-sm text-muted">
                    <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
          <div className="flex flex-col items-start gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-ink">Start with your own site</h2>
              <p className="mt-1 text-sm text-muted">
                Create an account, add the details you want on a report.
              </p>
            </div>
            <Link to="/register">
              <Button>Create account</Button>
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>Site Audit — evidence-based website audits.</p>
          <nav aria-label="Footer" className="flex gap-4">
            <Link to="/login" className="hover:text-ink">
              Sign in
            </Link>
            <Link to="/register" className="hover:text-ink">
              Create account
            </Link>
          </nav>
        </div>
        <div className="mx-auto max-w-5xl px-4 pb-8 sm:px-6">
          <p className="text-xs text-muted">
            Early build: accounts, settings and sign-in are live. Scanning arrives in a later release, which
            is why no audit can be started from this page yet.
          </p>
        </div>
      </footer>
    </div>
  );
}
