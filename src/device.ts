export function isAppleTouchDevice(userAgent: string, platform: string, maxTouchPoints: number) {
  return /iPad|iPhone|iPod/i.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
}
