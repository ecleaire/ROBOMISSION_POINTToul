import { describe, expect, it } from "vitest";
import {
  boundedRecordingElapsedMs,
  canCommitCapturedMedia,
  canUseResolvedCameraRequest,
  hasUnsavedCameraWork,
  isCurrentMediaRequest,
  recordingBitrateForByteLimit,
  shouldBlockCameraNavigation,
  shouldExitLateFullscreen,
  shouldPreserveExpandedCamera,
} from "./cameraLifecycle";

describe("camera lifecycle", () => {
  it.each([
    [1, 1, true],
    [2, 2, true],
    [1, 2, false],
    [2, 1, false],
    [1.5, 1.5, false],
  ])("identifies current media request %s/%s", (requestId, currentId, expected) => {
    expect(isCurrentMediaRequest(requestId, currentId)).toBe(expected);
  });

  it.each([
    [3, 3, "starting", true],
    [3, 4, "starting", false],
    [3, 3, "idle", false],
    [3, 3, "recording", false],
    [3, 3, "processing", false],
  ] as const)("accepts resolved request only while current and starting", (requestId, currentId, status, expected) => {
    expect(canUseResolvedCameraRequest(requestId, currentId, status)).toBe(expected);
  });

  it.each([
    ["idle", "rules", false],
    ["starting", "rules", true],
    ["recording", "links", true],
    ["processing", "result", true],
    ["recording", "score", false],
  ] as const)("blocks navigation while camera is busy", (status, target, expected) => {
    expect(shouldBlockCameraNavigation(status, target)).toBe(expected);
  });

  it.each([
    ["idle", false, false],
    ["idle", true, true],
    ["starting", false, true],
    ["recording", false, true],
    ["processing", false, true],
  ] as const)("detects unsaved camera work", (status, hasVideo, expected) => {
    expect(hasUnsavedCameraWork(status, hasVideo)).toBe(expected);
  });

  it.each([
    ["camera", "camera", true, false],
    ["camera", null, true, true],
    ["camera", "stopwatch", true, true],
    ["camera", null, false, false],
  ])("detects a late fullscreen completion", (requested, current, active, expected) => {
    expect(shouldExitLateFullscreen(requested, current, active)).toBe(expected);
  });

  it.each([
    ["recording", true, true],
    ["recording", false, false],
    ["starting", true, false],
    ["processing", true, false],
    ["idle", true, false],
  ] as const)("preserves only an expanded active recording", (status, cameraMode, expected) => {
    expect(shouldPreserveExpandedCamera(status, cameraMode)).toBe(expected);
  });

  it.each([
    [1_000, 0, "recording", 181_000, 180_000],
    [1_000, 20_000, "recording", 11_000, 20_000],
    [20_000, 5_000, "recording", 10_000, 5_000],
    [1_000, 20_000, "processing", 50_000, 20_000],
    [1_000, -5_000, "idle", 50_000, 0],
    [1_000, Number.NaN, "idle", 50_000, 0],
    [1_000, 1_000, "recording", 2_000, 1_000],
  ] as const)("bounds recording elapsed time", (startedAt, stored, status, now, expected) => {
    expect(boundedRecordingElapsedMs(startedAt, stored, status, 180_000, now)).toBe(expected);
  });

  it("returns zero for an invalid recording limit", () => {
    expect(boundedRecordingElapsedMs(0, 20_000, "recording", 0, 30_000)).toBe(0);
  });

  it.each([
    [45 * 1024 * 1024, 180_000, 0.9, 1_887_436],
    [45 * 1024 * 1024, 180_000, 1, 2_097_152],
    [0, 180_000, 0.9, 0],
    [45 * 1024 * 1024, 0, 0.9, 0],
    [45 * 1024 * 1024, 180_000, 1.1, 0],
  ])("calculates a recording bitrate within the byte limit", (bytes, duration, reserve, expected) => {
    expect(recordingBitrateForByteLimit(bytes, duration, reserve)).toBe(expected);
  });

  it.each([
    [8, 8, true, true],
    [8, 9, true, false],
    [8, 8, false, false],
  ])("commits captured media only for a current connected source", (requestId, currentId, connected, expected) => {
    expect(canCommitCapturedMedia(requestId, currentId, connected)).toBe(expected);
  });
});
