export function isCurrentSaveContext(
  expectedAccount: string,
  expectedApiKey: string,
  currentAccount: string | null | undefined,
  currentApiKey: string | null | undefined,
) {
  return Boolean(expectedAccount)
    && Boolean(expectedApiKey)
    && expectedAccount === currentAccount
    && expectedApiKey === currentApiKey;
}
