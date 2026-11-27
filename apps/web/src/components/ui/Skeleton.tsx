import { cx } from "../cx.js";

/**
 * A placeholder shape. Purely decorative: the surrounding region announces the loading state in
 * words, so a screen reader is not read a row of empty boxes.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx("animate-pulse rounded-md bg-tint-neutral", className)} />;
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={cx("h-4", index === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}
