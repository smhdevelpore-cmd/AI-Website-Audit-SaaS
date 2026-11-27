/** Join class names, dropping empty values. Small enough not to deserve a dependency. */
export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter((value): value is string => typeof value === "string" && value.length > 0).join(" ");
}
