export function accountScopedStorageKey(baseKey: string, accountId?: string | null) {
  const normalizedAccount = String(accountId || "").trim().toLocaleLowerCase();
  return `${baseKey}-${normalizedAccount || "none"}`;
}
