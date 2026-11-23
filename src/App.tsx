import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  createVideoSections,
  formatTimestamp,
  getYouTubeVideoId,
} from "./youtube";

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path d="M4.25 10h11.5m-5-5 5 5-5 5" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path d="m9 6.75 9 5.25-9 5.25V6.75Z" />
    </svg>
  );
}

export default function App() {
  const [url, setUrl] = useState("");
  const [videoId, setVideoId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [playerError, setPlayerError] = useState("");
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [sectionLengthSeconds, setSectionLengthSeconds] = useState(45);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);

  useEffect(() => {
    if (!videoId || !playerContainerRef.current) return;

    let disposed = false;
    let timer: number | undefined;
    let player: YouTubePlayer | null = null;
    let hasDuration = false;

    const updateTime = (activePlayer: YouTubePlayer) => {
      const nextDuration = activePlayer.getDuration();
      const nextTime = activePlayer.getCurrentTime();
      if (!hasDuration && Number.isFinite(nextDuration) && nextDuration > 0) {
        hasDuration = true;
        setDuration(nextDuration);
      }
      if (Number.isFinite(nextTime) && nextTime >= 0) {
        setCurrentTime(nextTime);
      }
    };

    const createPlayer = (api: YouTubeIframeApi) => {
      if (disposed || !playerContainerRef.current) return;

      player = new api.Player(playerContainerRef.current, {
        host: "https://www.youtube-nocookie.com",
        videoId,
        playerVars: {
          origin: window.location.origin,
          playsinline: 1,
          rel: 0,
        },
        events: {
          onReady: (event) => {
            if (disposed) return;
            playerRef.current = event.target;
            updateTime(event.target);
            timer = window.setInterval(() => updateTime(event.target), 500);
          },
          onStateChange: (event) => updateTime(event.target),
          onError: () => {
            setPlayerError("YouTube couldn’t load this video or its duration.");
          },
        },
      });
    };

    const loadPlayer = () => {
      if (window.YT?.Player) {
        createPlayer(window.YT);
        return;
      }

      const previousCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previousCallback?.();
        if (window.YT?.Player) createPlayer(window.YT);
      };

      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        script.async = true;
        script.onerror = () => {
          if (!disposed) setPlayerError("Couldn’t load YouTube’s player API.");
        };
        document.head.appendChild(script);
      }
    };

    loadPlayer();

    return () => {
      disposed = true;
      if (timer !== undefined) window.clearInterval(timer);
      playerRef.current = null;
      player?.destroy();
    };
  }, [videoId]);

  const sections = createVideoSections(duration, sectionLengthSeconds);
  const activeSection =
    sections.find(
      (section) => currentTime >= section.start && currentTime < section.end,
    ) ?? sections.at(-1);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextVideoId = getYouTubeVideoId(url);

    if (!nextVideoId) {
      setVideoId(null);
      setError("That link doesn’t look right. Try a YouTube video URL.");
      return;
    }

    setVideoId(nextVideoId);
    setError("");
    setPlayerError("");
    setDuration(0);
    setCurrentTime(0);
  }

  function handleClear() {
    setUrl("");
    setVideoId(null);
    setError("");
    setPlayerError("");
    setDuration(0);
    setCurrentTime(0);
  }

  function seekToSection(start: number) {
    playerRef.current?.seekTo(start, true);
    setCurrentTime(start);
  }

  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="Still home">
          <span className="wordmark-icon">
            <PlayIcon />
          </span>
          still<span className="wordmark-period">.</span>
        </a>
        <div className="topbar-note">
          <span className="status-dot" />
          Just the video. Nothing saved.
        </div>
      </header>

      <section className="hero" aria-labelledby="page-title">
        <div className="eyebrow">
          <span className="eyebrow-line" />
          A quieter way to watch
        </div>
        <h1 id="page-title">
          Bring the video.
          <br />
          <span>Leave nothing behind.</span>
        </h1>
        <p className="intro">
          Paste a YouTube link and watch it right here. No downloads, no
          watchlist, no saved history.
        </p>

        <form className="link-form" onSubmit={handleSubmit} noValidate>
          <label className="sr-only" htmlFor="youtube-url">
            YouTube video link
          </label>
          <div className={`input-wrap${error ? " input-wrap-error" : ""}`}>
            <span className="link-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M10 13.5a4 4 0 0 0 5.66 0l3-3A4 4 0 0 0 13 4.84l-1.72 1.71" />
                <path d="M14 10.5a4 4 0 0 0-5.66 0l-3 3A4 4 0 0 0 11 19.16l1.72-1.71" />
              </svg>
            </span>
            <input
              id="youtube-url"
              type="text"
              inputMode="url"
              autoComplete="url"
              placeholder="Paste a YouTube link"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                if (error) setError("");
              }}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "url-error" : "url-hint"}
            />
            <button type="submit" className="watch-button">
              <span>Watch here</span>
              <ArrowIcon />
            </button>
          </div>
          <div className="form-meta">
            {error ? (
              <span id="url-error" className="error-message" role="alert">
                {error}
              </span>
            ) : (
              <span id="url-hint">Works with youtube.com and youtu.be links</span>
            )}
            {videoId && (
              <button type="button" className="clear-button" onClick={handleClear}>
                Clear video
              </button>
            )}
          </div>
        </form>

        {videoId ? (
          <section className="player-section" aria-label="YouTube video player">
            <div className="player-frame">
              <div ref={playerContainerRef} className="youtube-player" />
            </div>
            <p className="player-caption">
              Playing through YouTube’s official player
            </p>
            <div className="sections-header">
              <div>
                <h2>
                  Sections
                  {sections.length > 0 && (
                    <span className="section-count">{sections.length}</span>
                  )}
                </h2>
                <p>
                  {activeSection
                    ? `Section ${activeSection.index} of ${sections.length} · ${formatTimestamp(activeSection.start)}–${formatTimestamp(activeSection.end)}`
                    : playerError || "Finding video length…"}
                </p>
              </div>
              <label className="section-length">
                Every
                <select
                  value={sectionLengthSeconds}
                  onChange={(event) =>
                    setSectionLengthSeconds(Number(event.target.value))
                  }
                  aria-label="Section length"
                >
                  <option value={15}>15 sec</option>
                  <option value={30}>30 sec</option>
                  <option value={45}>45 sec</option>
                  <option value={60}>60 sec</option>
                </select>
              </label>
            </div>
            {sections.length > 0 && (
              <div className="section-list" aria-label="Video sections">
                {sections.map((section) => (
                  <button
                    key={section.index}
                    type="button"
                    className={`section-button${activeSection?.index === section.index ? " section-button-active" : ""}`}
                    onClick={() => seekToSection(section.start)}
                    aria-current={
                      activeSection?.index === section.index ? "time" : undefined
                    }
                    aria-label={`Jump to section ${section.index}, starting at ${formatTimestamp(section.start)}`}
                  >
                    <span className="section-card-heading">
                      <span className="section-number">
                        {String(section.index).padStart(2, "0")}
                      </span>
                      {activeSection?.index === section.index && (
                        <span className="section-now">Now playing</span>
                      )}
                    </span>
                    <span className="section-time-range">
                      <time>{formatTimestamp(section.start)}</time>
                      <span aria-hidden="true">–</span>
                      <time>{formatTimestamp(section.end)}</time>
                    </span>
                    <span className="section-progress" aria-hidden="true">
                      <span
                        style={{
                          width:
                            activeSection?.index === section.index
                              ? `${Math.min(
                                  100,
                                  Math.max(
                                    0,
                                    ((currentTime - section.start) /
                                      (section.end - section.start)) *
                                      100,
                                  ),
                                )}%`
                              : "0%",
                        }}
                      />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        ) : (
          <div className="empty-player" aria-hidden="true">
            <div className="empty-orbit orbit-outer" />
            <div className="empty-orbit orbit-inner" />
            <div className="empty-play">
              <PlayIcon />
            </div>
            <span className="empty-label">Your video will appear here</span>
            <span className="empty-spark spark-one" />
            <span className="empty-spark spark-two" />
            <span className="empty-spark spark-three" />
          </div>
        )}
      </section>

      <footer className="footer">
        <span>Nothing is stored by this page.</span>
        <span className="footer-divider" />
        <span>Playback is provided by YouTube.</span>
      </footer>
    </main>
  );
}
