export {};

declare global {
  interface YouTubePlayer {
    destroy(): void;
    getCurrentTime(): number;
    getDuration(): number;
    seekTo(seconds: number, allowSeekAhead: boolean): void;
  }

  interface YouTubePlayerEvent {
    target: YouTubePlayer;
  }

  interface YouTubePlayerOptions {
    host: string;
    videoId: string;
    playerVars: {
      origin: string;
      playsinline: number;
      rel: number;
    };
    events: {
      onReady: (event: YouTubePlayerEvent) => void;
      onStateChange: (event: YouTubePlayerEvent) => void;
      onError: () => void;
    };
  }

  interface YouTubeIframeApi {
    Player: new (
      element: HTMLElement,
      options: YouTubePlayerOptions,
    ) => YouTubePlayer;
  }

  interface Window {
    YT?: YouTubeIframeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}
