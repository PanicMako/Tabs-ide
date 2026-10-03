import { describe, expect, it } from "vitest";
import { normalizeHourInput, normalizeMinuteInput, parseTimeDigits } from "./AppleTimePicker";

describe("AppleTimePicker - parseTimeDigits", () => {
  it("parses 4-digit continuous time entries correctly", () => {
    expect(parseTimeDigits("0120")).toEqual({ hour: 1, minute: 20 });
    expect(parseTimeDigits("1230")).toEqual({ hour: 12, minute: 30 });
    expect(parseTimeDigits("0545")).toEqual({ hour: 5, minute: 45 });
    expect(parseTimeDigits("1200")).toEqual({ hour: 12, minute: 0 });
    expect(parseTimeDigits("1159")).toEqual({ hour: 11, minute: 59 });
  });

  it("parses 3-digit continuous time entries correctly", () => {
    expect(parseTimeDigits("120")).toEqual({ hour: 1, minute: 20 });
    expect(parseTimeDigits("530")).toEqual({ hour: 5, minute: 30 });
    expect(parseTimeDigits("945")).toEqual({ hour: 9, minute: 45 });
    expect(parseTimeDigits("100")).toEqual({ hour: 1, minute: 0 });
  });

  it("handles non-numeric characters gracefully", () => {
    expect(parseTimeDigits("1:20")).toEqual({ hour: 1, minute: 20 });
    expect(parseTimeDigits("01:20")).toEqual({ hour: 1, minute: 20 });
  });

  it("rejects out-of-range hours or minutes", () => {
    // 13:00 is invalid in 12-hour clock
    expect(parseTimeDigits("1300")).toBeNull();
    // Minutes >= 60 are invalid
    expect(parseTimeDigits("0160")).toBeNull();
    expect(parseTimeDigits("165")).toBeNull();
    // Hour 0 is invalid in 12-hour clock (1-12)
    expect(parseTimeDigits("0000")).toBeNull();
    expect(parseTimeDigits("005")).toBeNull();
  });

  it("returns null for strings shorter than 3 digits", () => {
    expect(parseTimeDigits("")).toBeNull();
    expect(parseTimeDigits("1")).toBeNull();
    expect(parseTimeDigits("12")).toBeNull();
  });
});

describe("AppleTimePicker - normalizeHourInput", () => {
  it("normalizes valid hours", () => {
    expect(normalizeHourInput("1", 12)).toEqual({ hour: 1, text: "1" });
    expect(normalizeHourInput("09", 12)).toEqual({ hour: 9, text: "9" });
    expect(normalizeHourInput("12", 1)).toEqual({ hour: 12, text: "12" });
  });

  it("falls back to previous hour when empty or invalid", () => {
    expect(normalizeHourInput("", 5)).toEqual({ hour: 5, text: "5" });
    expect(normalizeHourInput("0", 5)).toEqual({ hour: 5, text: "5" });
    expect(normalizeHourInput("13", 5)).toEqual({ hour: 5, text: "5" });
    expect(normalizeHourInput("99", 8)).toEqual({ hour: 8, text: "8" });
  });
});

describe("AppleTimePicker - normalizeMinuteInput", () => {
  it("formats single digits with leading zero on blur", () => {
    expect(normalizeMinuteInput("2", 0)).toEqual({ minute: 2, text: "02" });
    expect(normalizeMinuteInput("0", 15)).toEqual({ minute: 0, text: "00" });
    expect(normalizeMinuteInput("9", 0)).toEqual({ minute: 9, text: "09" });
  });

  it("preserves valid 2-digit minutes like 20 or 30", () => {
    expect(normalizeMinuteInput("20", 0)).toEqual({ minute: 20, text: "20" });
    expect(normalizeMinuteInput("30", 0)).toEqual({ minute: 30, text: "30" });
    expect(normalizeMinuteInput("45", 0)).toEqual({ minute: 45, text: "45" });
    expect(normalizeMinuteInput("00", 15)).toEqual({ minute: 0, text: "00" });
    expect(normalizeMinuteInput("59", 0)).toEqual({ minute: 59, text: "59" });
  });

  it("falls back to previous minute when empty or out of range", () => {
    expect(normalizeMinuteInput("", 15)).toEqual({ minute: 15, text: "15" });
    expect(normalizeMinuteInput("", 5)).toEqual({ minute: 5, text: "05" });
    expect(normalizeMinuteInput("60", 30)).toEqual({ minute: 30, text: "30" });
    expect(normalizeMinuteInput("99", 0)).toEqual({ minute: 0, text: "00" });
  });
});
