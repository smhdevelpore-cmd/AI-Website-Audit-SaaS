import { useEffect, useState, type FormEvent } from "react";

import { useAuth } from "../../auth/AuthProvider.js";
import { config } from "../../config.js";
import { Button } from "../../components/ui/Button.js";
import { ErrorState } from "../../components/ui/ErrorState.js";
import { Input } from "../../components/ui/Input.js";
import { PageHeader } from "../../components/ui/PageHeader.js";
import { Skeleton, SkeletonText } from "../../components/ui/Skeleton.js";
import { useToast } from "../../components/ui/Toast.js";
import { ApiError, apiRequest } from "../../lib/api.js";
import { useProfile, type Profile } from "../../lib/useProfile.js";

interface FormState {
  name: string;
  agencyName: string;
  website: string;
  timezone: string;
  logoUrl: string;
}

const EMPTY: FormState = { name: "", agencyName: "", website: "", timezone: "", logoUrl: "" };

function toForm(profile: Profile): FormState {
  return {
    name: profile.name,
    agencyName: profile.agencyName ?? "",
    website: profile.website ?? "",
    timezone: profile.timezone ?? "",
    logoUrl: profile.logoUrl ?? "",
  };
}

/** Only non-empty fields are sent: the contract treats each optional field as "set this". */
function toPayload(form: FormState): Record<string, string> {
  const payload: Record<string, string> = { name: form.name.trim() };
  const optional: Array<[keyof FormState, string]> = [
    ["agencyName", "agencyName"],
    ["website", "website"],
    ["timezone", "timezone"],
    ["logoUrl", "logoUrl"],
  ];
  for (const [field, key] of optional) {
    const value = form[field].trim();
    if (value !== "") payload[key] = value;
  }
  return payload;
}

/**
 * Settings (Design.md §4). The profile form writes through the API to the real table; a
 * rejected field comes back with a path and lands under the input that caused it.
 */
export function Settings() {
  const { accessToken } = useAuth();
  const { state, reload } = useProfile();
  const toast = useToast();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (state.status === "ready") setForm(toForm(state.profile));
  }, [state]);

  function update(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setSaved(false);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    setFieldErrors({});
    setSaved(false);

    try {
      const result = await apiRequest<Profile>(config.VITE_API_BASE_URL, "/profile", {
        method: "PATCH",
        body: toPayload(form),
        accessToken,
      });
      setForm(toForm(result.data));
      setSaved(true);
      toast.show({ title: "Profile saved", tone: "success" });
    } catch (caught) {
      if (caught instanceof ApiError && caught.details.length > 0) {
        const errors: Record<string, string> = {};
        for (const detail of caught.details) errors[detail.path] = detail.message;
        setFieldErrors(errors);
        setFormError("Some fields need attention.");
      } else {
        setFormError(caught instanceof ApiError ? caught.message : "We could not save your profile.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        description="Your details, and what appears on a report. Profile changes are saved to your account."
      />

      {state.status === "loading" ? (
        <div role="status" aria-label="Loading your settings">
          <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <Skeleton className="h-5 w-32" />
            <div className="mt-4">
              <SkeletonText lines={4} />
            </div>
          </div>
          <span className="sr-only">Loading your settings…</span>
        </div>
      ) : null}

      {state.status === "error" ? (
        <ErrorState title="We could not load your settings" description={state.message} onRetry={reload} />
      ) : null}

      {state.status === "ready" ? (
        <section
          aria-labelledby="profile-heading"
          className="rounded-[var(--radius-card)] border border-line bg-surface p-5"
        >
          <h2 id="profile-heading" className="text-base font-semibold text-ink">
            Profile
          </h2>

          {formError === null ? null : (
            <p
              role="alert"
              className="mt-3 rounded-[var(--radius-control)] bg-tint-critical px-3 py-2 text-sm font-medium text-critical-strong"
            >
              {formError}
            </p>
          )}

          <form onSubmit={onSubmit} className="mt-4 grid gap-4 sm:grid-cols-2" noValidate>
            <Input
              label="Your name"
              required
              value={form.name}
              onChange={(event) => update("name", event.target.value)}
              {...(fieldErrors["name"] === undefined ? {} : { error: fieldErrors["name"] })}
            />
            <Input
              label="Agency name"
              hint="Leave blank to keep what is stored."
              value={form.agencyName}
              onChange={(event) => update("agencyName", event.target.value)}
              {...(fieldErrors["agencyName"] === undefined ? {} : { error: fieldErrors["agencyName"] })}
            />
            <Input
              label="Website"
              type="url"
              inputMode="url"
              placeholder="https://example.com"
              hint="Shown on reports. Leave blank to keep what is stored."
              value={form.website}
              onChange={(event) => update("website", event.target.value)}
              {...(fieldErrors["website"] === undefined ? {} : { error: fieldErrors["website"] })}
            />
            <Input
              label="Time zone"
              placeholder="Europe/Berlin"
              hint="Used for dates on reports."
              value={form.timezone}
              onChange={(event) => update("timezone", event.target.value)}
              {...(fieldErrors["timezone"] === undefined ? {} : { error: fieldErrors["timezone"] })}
            />
            <div className="sm:col-span-2">
              <Input
                label="Report logo URL"
                type="url"
                inputMode="url"
                placeholder="https://example.com/logo.png"
                hint="Optional. An address we can link to, not an upload."
                value={form.logoUrl}
                onChange={(event) => update("logoUrl", event.target.value)}
                {...(fieldErrors["logoUrl"] === undefined ? {} : { error: fieldErrors["logoUrl"] })}
              />
            </div>

            <div className="flex items-center gap-3 sm:col-span-2">
              <Button type="submit" loading={saving}>
                {saving ? "Saving" : "Save changes"}
              </Button>
              {saved ? (
                <p role="status" className="text-sm text-success-strong">
                  Saved.
                </p>
              ) : null}
            </div>
          </form>
        </section>
      ) : null}

      <section
        aria-labelledby="usage-heading"
        className="rounded-[var(--radius-card)] border border-line bg-surface p-5"
      >
        <h2 id="usage-heading" className="text-base font-semibold text-ink">
          Usage
        </h2>
        <p className="mt-2 text-sm text-muted">
          Usage counters appear here once audits have run. This account has no usage to report, so nothing is
          shown rather than a row of zeros.
        </p>
      </section>
    </div>
  );
}
