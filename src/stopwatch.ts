export function formatStopwatch(milliseconds: number) {
  const centiseconds = Math.max(0, Math.floor(milliseconds / 10));
  const minutes = Math.floor(centiseconds / 6000);
  const remainder = centiseconds % 6000;
  return `${String(minutes).padStart(2, "0")}:${String(Math.floor(remainder / 100)).padStart(2, "0")}.${String(remainder % 100).padStart(2, "0")}`;
}

export function secondsFromStopwatch(milliseconds: number) {
  return Math.max(0, Math.floor(milliseconds / 10) / 100);
}

export function formatRecordingTime(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
