export function accountScopedStorageKey(baseKey: string, accountId?: string | null) {
  const normalizedAccount = String(accountId || "").trim().toLocaleLowerCase();
  return `${baseKey}-${normalizedAccount || "none"}`;
}

export function shouldCarryGuestDraft(currentAccount: string | null | undefined, hasActivity: boolean) {
  return !currentAccount && hasActivity;
}
