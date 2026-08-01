export function isValidAccountId(value: string | null): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64 && /^[\p{L}\p{N}_-]+$/u.test(value);
}
