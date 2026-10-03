import { describe, expect, it } from "vitest";
import { prepareVideoFirstFrame } from "./videoFirstFrame";

describe("prepareVideoFirstFrame", () => {
  it("seeks paused video with valid duration to initial frame", () => {
    const video = {
      autoplay: false,
      paused: true,
      seeking: false,
      currentTime: 0,
      duration: 10,
      played: { length: 0 } as unknown as TimeRanges,
      src: "https://example.com/movie.mp4",
    };

    prepareVideoFirstFrame(video);
    expect(video.currentTime).toBe(0.1);
  });

  it("halves duration when duration is very short (< 0.2s)", () => {
    const video = {
      autoplay: false,
      paused: true,
      seeking: false,
      currentTime: 0,
      duration: 0.1,
      played: { length: 0 } as unknown as TimeRanges,
      src: "https://example.com/short.mp4",
    };

    prepareVideoFirstFrame(video);
    expect(video.currentTime).toBe(0.05);
  });

  it("does not seek if autoplay is set", () => {
    const video = {
      autoplay: true,
      paused: true,
      seeking: false,
      currentTime: 0,
      duration: 10,
      played: { length: 0 } as unknown as TimeRanges,
      src: "https://example.com/movie.mp4",
    };

    prepareVideoFirstFrame(video);
    expect(video.currentTime).toBe(0);
  });

  it("does not seek if video is playing (not paused)", () => {
    const video = {
      autoplay: false,
      paused: false,
      seeking: false,
      currentTime: 0,
      duration: 10,
      played: { length: 0 } as unknown as TimeRanges,
      src: "https://example.com/movie.mp4",
    };

    prepareVideoFirstFrame(video);
    expect(video.currentTime).toBe(0);
  });

  it("does not seek if already played or currentTime > 0", () => {
    const video = {
      autoplay: false,
      paused: true,
      seeking: false,
      currentTime: 2.5,
      duration: 10,
      played: { length: 1 } as unknown as TimeRanges,
      src: "https://example.com/movie.mp4",
    };

    prepareVideoFirstFrame(video);
    expect(video.currentTime).toBe(2.5);
  });

  it("does not seek if src specifies explicit timestamp fragment #t=...", () => {
    const video = {
      autoplay: false,
      paused: true,
      seeking: false,
      currentTime: 0,
      duration: 10,
      played: { length: 0 } as unknown as TimeRanges,
      src: "https://example.com/movie.mp4#t=5",
    };

    prepareVideoFirstFrame(video);
    expect(video.currentTime).toBe(0);
  });
});
