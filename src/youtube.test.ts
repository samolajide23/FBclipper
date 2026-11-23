import { describe, expect, it } from "vitest";
import {
  createVideoSections,
  formatTimestamp,
  getYouTubeVideoId,
} from "./youtube";

describe("getYouTubeVideoId", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?t=42", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ])("extracts a video ID from %s", (input, expected) => {
    expect(getYouTubeVideoId(input)).toBe(expected);
  });

  it.each([
    "https://notyoutube.com/watch?v=dQw4w9WgXcQ",
    "javascript:alert(1)",
    "https://youtube.com/watch?v=short",
    "not a video URL",
  ])("rejects invalid input %s", (input) => {
    expect(getYouTubeVideoId(input)).toBeNull();
  });
});

describe("createVideoSections", () => {
  it("creates equal sections and shortens the final section", () => {
    expect(createVideoSections(725, 300)).toEqual([
      { index: 1, start: 0, end: 300 },
      { index: 2, start: 300, end: 600 },
      { index: 3, start: 600, end: 725 },
    ]);
  });

  it("returns no sections for invalid durations", () => {
    expect(createVideoSections(0, 300)).toEqual([]);
    expect(createVideoSections(100, 0)).toEqual([]);
  });
});

describe("formatTimestamp", () => {
  it("formats timestamps with hours when needed", () => {
    expect(formatTimestamp(305)).toBe("5:05");
    expect(formatTimestamp(3661)).toBe("1:01:01");
  });
});
