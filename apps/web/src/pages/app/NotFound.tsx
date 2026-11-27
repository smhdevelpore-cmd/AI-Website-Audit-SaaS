import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">Page not found</h1>
      <p className="text-sm text-muted">That address does not match any screen.</p>
      <p className="text-sm">
        <Link to="/dashboard" className="text-primary-strong underline underline-offset-2">
          Go to your overview
        </Link>
      </p>
    </div>
  );
}
