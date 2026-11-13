export type CameraRecordingStatus = "idle" | "starting" | "recording" | "processing";

export function isCurrentMediaRequest(requestId: number, currentRequestId: number) {
  return Number.isInteger(requestId) && requestId === currentRequestId;
}

export function canUseResolvedCameraRequest(
  requestId: number,
  currentRequestId: number,
  status: CameraRecordingStatus,
) {
  return isCurrentMediaRequest(requestId, currentRequestId) && status === "starting";
}

export function shouldBlockCameraNavigation(status: CameraRecordingStatus, target: string) {
  return status !== "idle" && target !== "score";
}

export function hasUnsavedCameraWork(status: CameraRecordingStatus, hasPreparedVideo: boolean) {
  return status !== "idle" || hasPreparedVideo;
}

export function shouldExitLateFullscreen(
  requestedTarget: string | null,
  currentTarget: string | null,
  requestedElementIsFullscreen: boolean,
) {
  return requestedElementIsFullscreen && currentTarget !== requestedTarget;
}

export function shouldPreserveExpandedCamera(status: CameraRecordingStatus, cameraModeActive: boolean) {
  return status === "recording" && cameraModeActive;
}

export function boundedRecordingElapsedMs(
  startedAt: number,
  storedElapsedMs: number,
  status: CameraRecordingStatus,
  maximumMs: number,
  now = Date.now(),
) {
  if (!Number.isFinite(maximumMs) || maximumMs <= 0) return 0;
  const stored = Number.isFinite(storedElapsedMs) ? Math.max(0, storedElapsedMs) : 0;
  const live = status === "recording" && Number.isFinite(startedAt) && Number.isFinite(now)
    ? Math.max(0, now - startedAt)
    : 0;
  return Math.min(maximumMs, Math.max(stored, live));
}

export function recordingBitrateForByteLimit(
  maximumBytes: number,
  durationMs: number,
  reserveRatio = 0.9,
) {
  if (!Number.isFinite(maximumBytes) || maximumBytes <= 0) return 0;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  if (!Number.isFinite(reserveRatio) || reserveRatio <= 0 || reserveRatio > 1) return 0;
  return Math.floor((maximumBytes * 8 * reserveRatio * 1000) / durationMs);
}

export function canCommitCapturedMedia(requestId: number, currentRequestId: number, sourceConnected: boolean) {
  return sourceConnected && isCurrentMediaRequest(requestId, currentRequestId);
}

export function recordingOptionCandidates(mimeType: string, videoBitsPerSecond: number): MediaRecorderOptions[] {
  const bitrate = Number.isFinite(videoBitsPerSecond) && videoBitsPerSecond > 0
    ? Math.floor(videoBitsPerSecond)
    : 0;
  const candidates: MediaRecorderOptions[] = [];
  if (mimeType && bitrate) candidates.push({ mimeType, videoBitsPerSecond: bitrate });
  if (bitrate) candidates.push({ videoBitsPerSecond: bitrate });
  if (mimeType) candidates.push({ mimeType });
  candidates.push({});
  return candidates;
}

export function createCompatibleMediaRecorder(
  stream: MediaStream,
  mimeType: string,
  videoBitsPerSecond: number,
) {
  let lastError: unknown;
  for (const options of recordingOptionCandidates(mimeType, videoBitsPerSecond)) {
    try {
      return new MediaRecorder(stream, options);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("MediaRecorderを作成できませんでした。");
}

export function shouldStopActiveRecording(status: CameraRecordingStatus, recorderState: RecordingState | null) {
  return status === "recording" && recorderState === "recording";
}
