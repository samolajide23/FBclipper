const VIDEO_ID_PATTERN = /^[\w-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

export function getYouTubeVideoId(input: string): string | null {
  const value = input.trim();
  if (VIDEO_ID_PATTERN.test(value)) {
    return value;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) {
    return null;
  }

  const segments = url.pathname.split("/").filter(Boolean);
  let videoId: string | null = null;

  if (host === "youtu.be" || host === "www.youtu.be") {
    videoId = segments[0] ?? null;
  } else if (url.pathname === "/watch") {
    videoId = url.searchParams.get("v");
  } else if (["shorts", "embed", "live", "v"].includes(segments[0] ?? "")) {
    videoId = segments[1] ?? null;
  }

  return videoId && VIDEO_ID_PATTERN.test(videoId) ? videoId : null;
}

export interface VideoSection {
  index: number;
  start: number;
  end: number;
}

export function createVideoSections(
  durationSeconds: number,
  sectionLengthSeconds: number,
): VideoSection[] {
  if (
    !Number.isFinite(durationSeconds) ||
    !Number.isFinite(sectionLengthSeconds) ||
    durationSeconds <= 0 ||
    sectionLengthSeconds <= 0
  ) {
    return [];
  }

  const sections: VideoSection[] = [];
  for (let start = 0; start < durationSeconds; start += sectionLengthSeconds) {
    sections.push({
      index: sections.length + 1,
      start,
      end: Math.min(start + sectionLengthSeconds, durationSeconds),
    });
  }
  return sections;
}

export function formatTimestamp(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainder = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}
