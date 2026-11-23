import { useEffect, useRef, useState } from "react";
import { ReelClipProcessor } from "./clipProcessor";
import { createVideoSections, formatTimestamp } from "./youtube";
import type { VideoSection } from "./youtube";

interface FacebookPage {
  id: string;
  name: string;
}

interface FacebookStatus {
  configured: boolean;
  connected: boolean;
  pages: FacebookPage[];
  selectedPageId: string | null;
}

interface ApiResponse {
  error?: string;
  success?: boolean;
}

const MAX_SOURCE_SIZE = 500 * 1024 * 1024;
const MIN_REEL_SECONDS = 3;

async function readApiResponse(response: Response): Promise<ApiResponse> {
  const body: unknown = await response.json().catch(() => null);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("The app server returned an invalid response.");
  }

  const result = body as ApiResponse;
  if (!response.ok) {
    throw new Error(result.error ?? "The Facebook request failed.");
  }
  return result;
}

export default function FacebookReelCreator() {
  const [facebook, setFacebook] = useState<FacebookStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceDuration, setSourceDuration] = useState(0);
  const [selectedSection, setSelectedSection] = useState<VideoSection | null>(
    null,
  );
  const [clipBlob, setClipBlob] = useState<Blob | null>(null);
  const [clipUrl, setClipUrl] = useState("");
  const [title, setTitle] = useState("Reel clip");
  const [description, setDescription] = useState("");
  const [processing, setProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [publishedSections, setPublishedSections] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const processorRef = useRef<ReelClipProcessor | null>(null);

  const sections = createVideoSections(sourceDuration, 45);
  const selectedSectionWasPublished =
    selectedSection !== null &&
    publishedSections.includes(selectedSection.index);

  useEffect(() => {
    const processor = new ReelClipProcessor();
    processorRef.current = processor;
    return () => {
      processor.terminate();
      if (processorRef.current === processor) processorRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!sourceFile) {
      setSourceUrl("");
      setSourceDuration(0);
      return;
    }

    const url = URL.createObjectURL(sourceFile);
    setSourceUrl(url);
    setSourceDuration(0);
    setSelectedSection(null);
    setClipBlob(null);
    setPublishedSections([]);
    setTitle("Reel clip");
    setDescription("");
    return () => URL.revokeObjectURL(url);
  }, [sourceFile]);

  useEffect(() => {
    if (!clipBlob) {
      setClipUrl("");
      return;
    }

    const url = URL.createObjectURL(clipBlob);
    setClipUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [clipBlob]);

  useEffect(() => {
    let active = true;
    setStatusLoading(true);
    fetch("/api/facebook/status", { credentials: "same-origin" })
      .then(readApiResponse)
      .then(async (result) => {
        if (!active) return;
        if (
          typeof result !== "object" ||
          typeof (result as FacebookStatus).configured !== "boolean"
        ) {
          throw new Error("The app server returned an invalid Facebook status.");
        }
        setFacebook(result as FacebookStatus);
      })
      .catch((requestError: unknown) => {
        if (active) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Could not reach the app server.",
          );
        }
      })
      .finally(() => {
        if (active) setStatusLoading(false);
      });

    const params = new URLSearchParams(window.location.search);
    const facebookResult = params.get("facebook");
    if (facebookResult === "connected") {
      setNotice("Facebook authorization completed. Choose a Page to continue.");
    } else if (facebookResult === "error") {
      setError("Facebook authorization did not complete. Please try again.");
    }
    if (facebookResult) {
      window.history.replaceState({}, "", window.location.pathname);
    }

    return () => {
      active = false;
    };
  }, []);

  async function handleSelectPage(pageId: string) {
    setError("");
    try {
      const response = await fetch("/api/facebook/select-page", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pageId }),
      });
      await readApiResponse(response);
      setFacebook((current) =>
        current ? { ...current, selectedPageId: pageId } : current,
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not select the Page.",
      );
    }
  }

  function handleFileChange(file: File | undefined) {
    setError("");
    setNotice("");
    setClipBlob(null);
    setSelectedSection(null);
    if (!file) {
      setSourceFile(null);
      return;
    }
    if (!file.type.startsWith("video/")) {
      setError("Choose a video file.");
      return;
    }
    if (file.size > MAX_SOURCE_SIZE) {
      setError("Choose a source video smaller than 500 MB.");
      return;
    }
    setSourceFile(file);
  }

  async function handlePrepareClip(section: VideoSection) {
    if (!sourceFile || !processorRef.current) return;

    if (section.end - section.start < MIN_REEL_SECONDS) {
      setError("Facebook Reels must be at least 3 seconds long.");
      return;
    }

    setSelectedSection(section);
    setClipBlob(null);
    setTitle(`Clip ${section.index}`);
    setError("");
    setNotice("");
    setProcessing(true);
    setProcessingProgress(0);

    try {
      const blob = await processorRef.current.createClip(
        sourceFile,
        section,
        setProcessingProgress,
      );
      setClipBlob(blob);
      setNotice(
        `Clip ${section.index} is ready. Preview it before publishing.`,
      );
    } catch (processingError) {
      setError(
        processingError instanceof Error
          ? processingError.message
          : "Could not process this clip in your browser.",
      );
    } finally {
      setProcessing(false);
    }
  }

  async function handlePublish() {
    if (!clipBlob || !selectedSection || !facebook?.selectedPageId) return;

    setPublishing(true);
    setError("");
    setNotice("");

    try {
      const formData = new FormData();
      formData.append(
        "clip",
        clipBlob,
        `reel-${String(selectedSection.index).padStart(2, "0")}.mp4`,
      );
      formData.append("title", title.trim() || `Clip ${selectedSection.index}`);
      formData.append("description", description);

      const response = await fetch("/api/facebook/upload", {
        method: "POST",
        credentials: "same-origin",
        body: formData,
      });
      const result = await readApiResponse(response);
      if (!result.success) {
        throw new Error("Facebook did not confirm the Reel upload.");
      }

      setPublishedSections((current) =>
        current.includes(selectedSection.index)
          ? current
          : [...current, selectedSection.index],
      );
      setNotice(`Clip ${selectedSection.index} was published to Facebook.`);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Could not publish this clip.",
      );
    } finally {
      setPublishing(false);
    }
  }

  async function handleDisconnect() {
    setError("");
    try {
      const response = await fetch("/api/facebook/disconnect", {
        method: "POST",
        credentials: "same-origin",
      });
      await readApiResponse(response);
      setFacebook((current) =>
        current
          ? { ...current, connected: false, pages: [], selectedPageId: null }
          : current,
      );
      setNotice("Facebook has been disconnected.");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not disconnect Facebook.",
      );
    }
  }

  const selectedPage = facebook?.pages.find(
    (page) => page.id === facebook.selectedPageId,
  );

  return (
    <section className="reel-creator" aria-labelledby="reel-heading">
      <div className="reel-intro">
        <div className="eyebrow">
          <span className="eyebrow-line" />
          Facebook Page publishing
        </div>
        <h1 id="reel-heading">
          Make a Reel.
          <br />
          <span>Keep the moment.</span>
        </h1>
        <p className="intro">
          Choose a local video, turn it into 45-second vertical clips, and
          publish each one to your Facebook Page.
        </p>
      </div>

      <div className="creator-grid">
        <section className="creator-card facebook-card" aria-labelledby="facebook-card-title">
          <div className="creator-card-header">
            <div className="facebook-mark" aria-hidden="true">
              f
            </div>
            <div>
              <h2 id="facebook-card-title">Connect a Page</h2>
              <p>Authorize publishing through Facebook</p>
            </div>
            <span
              className={`connection-indicator${facebook?.connected ? " connection-indicator-on" : ""}`}
              aria-label={facebook?.connected ? "Connected" : "Not connected"}
            />
          </div>

          {statusLoading ? (
            <p className="creator-muted">Checking Facebook connection…</p>
          ) : !facebook?.configured ? (
            <div className="setup-notice">
              <strong>Meta app setup needed</strong>
              <span>
                Add your app ID, app secret, callback URL, and session secret to
                <code>.env.local</code>, then restart the app.
              </span>
              <a
                href="https://developers.facebook.com/apps/"
                target="_blank"
                rel="noreferrer"
              >
                Open Meta for Developers
              </a>
            </div>
          ) : !facebook.connected ? (
            <a className="facebook-connect" href="/api/facebook/oauth/start">
              Connect Facebook
              <span aria-hidden="true">→</span>
            </a>
          ) : (
            <div className="page-select-wrap">
              {facebook.pages.length > 0 ? (
                <>
                  <label htmlFor="facebook-page">Publish to</label>
                  <select
                    id="facebook-page"
                    value={facebook.selectedPageId ?? ""}
                    onChange={(event) => handleSelectPage(event.target.value)}
                  >
                    <option value="" disabled>
                      Select a Page
                    </option>
                    {facebook.pages.map((page) => (
                      <option key={page.id} value={page.id}>
                        {page.name}
                      </option>
                    ))}
                  </select>
                  {selectedPage && (
                    <span className="selected-page-note">
                      Reels publish publicly to {selectedPage.name}.
                    </span>
                  )}
                  <button
                    type="button"
                    className="text-button"
                    onClick={handleDisconnect}
                  >
                    Disconnect Facebook
                  </button>
                </>
              ) : (
                <div className="setup-notice">
                  <strong>No publishable Pages found</strong>
                  <span>
                    Your Facebook account needs a Page with permission to create
                    content.
                  </span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={handleDisconnect}
                  >
                    Disconnect
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        <section className="creator-card source-card" aria-labelledby="source-card-title">
          <div className="creator-card-header">
            <div className="source-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14.5v4A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-4" />
              </svg>
            </div>
            <div>
              <h2 id="source-card-title">Choose your video</h2>
              <p>Use a video file you own or can publish</p>
            </div>
          </div>

          <label className="file-picker">
            <input
              type="file"
              accept="video/*"
              disabled={processing || publishing}
              onChange={(event) =>
                handleFileChange(event.currentTarget.files?.[0])
              }
            />
            <span className="file-picker-icon" aria-hidden="true">
              +
            </span>
            <span>
              <strong>{sourceFile ? "Choose a different video" : "Choose video file"}</strong>
              <small>MP4, MOV, or another browser-supported video · up to 500 MB</small>
            </span>
          </label>

          {sourceFile && (
            <div className="source-details">
              <span className="file-name">{sourceFile.name}</span>
              {sourceDuration > 0 ? (
                <span>{formatTimestamp(sourceDuration)} · 45-second clips</span>
              ) : (
                <span>Reading video length…</span>
              )}
            </div>
          )}

          {sourceUrl && (
            <video
              className="source-metadata-video"
              src={sourceUrl}
              preload="metadata"
              aria-hidden="true"
              onLoadedMetadata={(event) => {
                const nextDuration = event.currentTarget.duration;
                if (Number.isFinite(nextDuration) && nextDuration > 0) {
                  setSourceDuration(nextDuration);
                }
              }}
              onError={() => setError("This video file could not be opened.")}
            />
          )}
        </section>
      </div>

      {sourceFile && sourceDuration > 0 && (
        <section className="clip-workspace" aria-labelledby="clips-heading">
          <div className="sections-header clip-sections-header">
            <div>
              <h2>
                Your clips
                <span className="section-count">{sections.length}</span>
              </h2>
              <p>Choose a clip to format it for a vertical Facebook Reel.</p>
            </div>
            <span className="reel-format-badge">9:16 · 45 sec</span>
          </div>

          {sections.length > 30 && (
            <p className="rate-limit-note">
              Facebook allows up to 30 API-published Reels per Page in a rolling
              24-hour period. Select only the clips you want to publish.
            </p>
          )}

          <div className="section-list reel-section-list" aria-label="Source video clips">
            {sections.map((section) => {
              const tooShort = section.end - section.start < MIN_REEL_SECONDS;
              const published = publishedSections.includes(section.index);
              return (
                <button
                  key={section.index}
                  type="button"
                  className={`section-button${selectedSection?.index === section.index ? " section-button-active" : ""}`}
                  disabled={tooShort || processing || publishing}
                  onClick={() => handlePrepareClip(section)}
                  aria-label={
                    tooShort
                      ? `Clip ${section.index}, too short for a Facebook Reel`
                      : `Prepare clip ${section.index}, ${formatTimestamp(section.start)} to ${formatTimestamp(section.end)}`
                  }
                >
                  <span className="section-card-heading">
                    <span className="section-number">
                      {String(section.index).padStart(2, "0")}
                    </span>
                    <span className="section-now">
                      {published
                        ? "Published"
                        : selectedSection?.index === section.index
                          ? "Selected"
                          : tooShort
                            ? "Under 3 sec"
                            : ""}
                    </span>
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
                          published || selectedSection?.index === section.index
                            ? "100%"
                            : "0%",
                      }}
                    />
                  </span>
                </button>
              );
            })}
          </div>

          {processing && (
            <div className="processing-status" role="status">
              <span className="processing-spinner" aria-hidden="true" />
              Preparing clip in your browser… {processingProgress}%
            </div>
          )}

          {selectedSection && clipBlob && clipUrl && (
            <section className="clip-preview" aria-label="Clip preview">
              <div className="clip-preview-video">
                <video src={clipUrl} controls playsInline />
              </div>
              <div className="clip-publish-form">
                <div className="clip-preview-heading">
                  <div>
                    <span className="reel-format-badge">Ready to publish</span>
                    <h3>
                      Clip {selectedSection.index}
                      <span>
                        {formatTimestamp(selectedSection.start)}–
                        {formatTimestamp(selectedSection.end)}
                      </span>
                    </h3>
                  </div>
                </div>
                <label htmlFor="reel-title">Reel title</label>
                <input
                  id="reel-title"
                  value={title}
                  maxLength={255}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Give this Reel a title"
                />
                <label htmlFor="reel-description">Caption</label>
                <textarea
                  id="reel-description"
                  value={description}
                  maxLength={2200}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Add a caption or hashtags (optional)"
                  rows={3}
                />
                <button
                  type="button"
                  className="facebook-publish"
                  disabled={
                    !facebook?.selectedPageId ||
                    publishing ||
                    processing ||
                    selectedSectionWasPublished
                  }
                  onClick={handlePublish}
                >
                  {publishing
                    ? "Publishing to Facebook…"
                    : selectedSectionWasPublished
                      ? "Already published"
                      : facebook?.selectedPageId
                        ? "Publish Reel to Facebook"
                        : "Connect and select a Page to publish"}
                </button>
                <p className="publish-disclosure">
                  Publishing posts this Reel publicly to the selected Facebook
                  Page. Only the generated clip is sent for upload.
                </p>
              </div>
            </section>
          )}
        </section>
      )}

      <div className="processing-disclosure">
        Your source video is processed locally in your browser. The app does not
        save it. A generated clip is sent to Facebook only when you choose
        Publish; Facebook stores published Reels on your Page.
      </div>

      {(error || notice) && (
        <div
          className={error ? "creator-message creator-message-error" : "creator-message"}
          role={error ? "alert" : "status"}
        >
          {error || notice}
          <button
            type="button"
            className="message-dismiss"
            aria-label="Dismiss message"
            onClick={() => {
              setError("");
              setNotice("");
            }}
          >
            ×
          </button>
        </div>
      )}
    </section>
  );
}
