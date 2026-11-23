import { FFmpeg } from "@ffmpeg/ffmpeg";
import ffmpegCoreUrl from "@ffmpeg/core?url";
import ffmpegWasmUrl from "@ffmpeg/core/wasm?url";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import type { VideoSection } from "./youtube";

const REEL_FILTER =
  "[0:v]split=2[background][foreground];" +
  "[background]scale=1080:1920:force_original_aspect_ratio=increase," +
  "crop=1080:1920,boxblur=18:9[blurred];" +
  "[foreground]scale=1080:1920:force_original_aspect_ratio=decrease[main];" +
  "[blurred][main]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[outv]";

export class ReelClipProcessor {
  private readonly ffmpeg = new FFmpeg();
  private loadPromise: Promise<void> | null = null;
  private inputPath: string | null = null;
  private inputFile: File | null = null;

  async createClip(
    file: File,
    section: VideoSection,
    onProgress: (progress: number) => void,
  ): Promise<Blob> {
    await this.ensureLoaded();
    await this.loadInput(file);

    const outputPath = "/reel-clip.mp4";
    const handleProgress = ({ progress }: { progress: number }) => {
      onProgress(Math.min(100, Math.max(0, Math.round(progress * 100))));
    };
    this.ffmpeg.on("progress", handleProgress);

    try {
      const exitCode = await this.ffmpeg.exec([
        "-i",
        this.inputPath!,
        "-ss",
        section.start.toFixed(3),
        "-t",
        (section.end - section.start).toFixed(3),
        "-filter_complex",
        REEL_FILTER,
        "-map",
        "[outv]",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-r",
        "30",
        "-movflags",
        "+faststart",
        outputPath,
      ]);
      if (exitCode !== 0) {
        throw new Error("FFmpeg could not create this clip.");
      }

      const data = await this.ffmpeg.readFile(outputPath);
      if (typeof data === "string") {
        throw new Error("FFmpeg returned an invalid video clip.");
      }

      const bytes = new Uint8Array(data);
      const blob = new Blob([bytes.buffer], { type: "video/mp4" });
      await this.ffmpeg.deleteFile(outputPath);
      onProgress(100);
      return blob;
    } catch (error) {
      this.terminate();
      throw error;
    } finally {
      this.ffmpeg.off("progress", handleProgress);
    }
  }

  terminate(): void {
    if (this.ffmpeg.loaded) this.ffmpeg.terminate();
    this.inputPath = null;
    this.inputFile = null;
    this.loadPromise = null;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.ffmpeg.loaded) return;
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        await this.ffmpeg.load({
          coreURL: await toBlobURL(ffmpegCoreUrl, "text/javascript"),
          wasmURL: await toBlobURL(ffmpegWasmUrl, "application/wasm"),
        });
      })();
    }
    await this.loadPromise;
  }

  private async loadInput(file: File): Promise<void> {
    if (this.inputFile === file && this.inputPath) return;
    if (this.inputPath) await this.ffmpeg.deleteFile(this.inputPath);

    const extension = file.name.match(/\.[a-z0-9]{1,8}$/i)?.[0] ?? ".mp4";
    this.inputPath = `/source${extension.toLowerCase()}`;
    await this.ffmpeg.writeFile(this.inputPath, await fetchFile(file));
    this.inputFile = file;
  }
}
