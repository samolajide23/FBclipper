import { randomBytes } from "node:crypto";
import express from "express";
import session from "express-session";
import multer from "multer";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

interface FacebookPageSession {
  id: string;
  name: string;
  accessToken: string;
  tasks: string[];
}

declare module "express-session" {
  interface SessionData {
    oauthState?: string;
    facebookPages?: FacebookPageSession[];
    selectedFacebookPageId?: string;
  }
}

type JsonRecord = Record<string, unknown>;

const app = express();
const apiPort = Number(process.env.API_PORT ?? 3001);
const graphVersion = process.env.FACEBOOK_GRAPH_VERSION ?? "v27.0";
const appOrigin = process.env.APP_ORIGIN ?? "http://localhost:5173";
const facebookRedirectUri = process.env.FACEBOOK_REDIRECT_URI ?? "";
const facebookAppId = process.env.FACEBOOK_APP_ID ?? "";
const facebookAppSecret = process.env.FACEBOOK_APP_SECRET ?? "";
const sessionSecret = process.env.SESSION_SECRET ?? randomBytes(32).toString("hex");
const facebookConfigured = Boolean(
  facebookAppId &&
    facebookAppSecret &&
    facebookRedirectUri &&
    process.env.SESSION_SECRET,
);
const uploadClip = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 250 * 1024 * 1024, files: 1 },
}).single("clip");

app.use(
  session({
    name: "still.sid",
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 8 * 60 * 60 * 1000,
    },
  }),
);
app.use(express.json({ limit: "32kb" }));

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(response: Response): Promise<JsonRecord> {
  const body: unknown = await response.json().catch(() => null);
  if (!isRecord(body)) {
    throw new Error("Meta returned an unreadable response.");
  }

  if (!response.ok || body.error) {
    const error = isRecord(body.error) ? body.error : null;
    const message =
      error && typeof error.message === "string"
        ? error.message
        : "Meta rejected the request.";
    throw new Error(message);
  }

  return body;
}

function metaUrl(path: string, params?: URLSearchParams): URL {
  const url = new URL(
    `https://graph.facebook.com/${graphVersion}/${path.replace(/^\/+/, "")}`,
  );
  if (params) url.search = params.toString();
  return url;
}

async function graphGet(
  path: string,
  params: URLSearchParams,
): Promise<JsonRecord> {
  return readJson(await fetch(metaUrl(path, params)));
}

async function graphPost(
  path: string,
  params: URLSearchParams,
): Promise<JsonRecord> {
  return readJson(
    await fetch(metaUrl(path), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params,
    }),
  );
}

function redirectToApp(status: "connected" | "error"): string {
  const url = new URL("/", appOrigin);
  url.searchParams.set("facebook", status);
  return url.toString();
}

function getSelectedPage(
  req: express.Request,
): FacebookPageSession | undefined {
  return req.session.facebookPages?.find(
    (page) => page.id === req.session.selectedFacebookPageId,
  );
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/facebook/status", (req, res) => {
  const pages = req.session.facebookPages ?? [];
  res.json({
    configured: facebookConfigured,
    connected: pages.length > 0,
    pages: pages.map(({ id, name }) => ({ id, name })),
    selectedPageId: req.session.selectedFacebookPageId ?? null,
  });
});

app.get("/api/facebook/oauth/start", (req, res) => {
  if (!facebookConfigured) {
    res.status(503).json({
      error: "Add the Meta app settings to .env.local, then restart the app.",
    });
    return;
  }

  const state = randomBytes(24).toString("hex");
  req.session.oauthState = state;
  const url = new URL(`https://www.facebook.com/${graphVersion}/dialog/oauth`);
  url.searchParams.set("client_id", facebookAppId);
  url.searchParams.set("redirect_uri", facebookRedirectUri);
  url.searchParams.set(
    "scope",
    "pages_show_list,pages_read_engagement,pages_manage_posts",
  );
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  res.redirect(url.toString());
});

app.get("/api/facebook/oauth/callback", async (req, res) => {
  const state = req.query.state;
  const code = req.query.code;
  const stateMatches =
    typeof state === "string" &&
    typeof req.session.oauthState === "string" &&
    state === req.session.oauthState;
  delete req.session.oauthState;

  if (!stateMatches || typeof code !== "string" || !facebookConfigured) {
    res.redirect(redirectToApp("error"));
    return;
  }

  try {
    const shortTokenParams = new URLSearchParams({
      client_id: facebookAppId,
      client_secret: facebookAppSecret,
      redirect_uri: facebookRedirectUri,
      code,
    });
    const shortTokenResponse = await graphGet(
      "oauth/access_token",
      shortTokenParams,
    );
    const shortToken = shortTokenResponse.access_token;
    if (typeof shortToken !== "string") {
      throw new Error("Meta did not return a user access token.");
    }

    const longTokenResponse = await graphGet(
      "oauth/access_token",
      new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: facebookAppId,
        client_secret: facebookAppSecret,
        fb_exchange_token: shortToken,
      }),
    );
    const userToken = longTokenResponse.access_token;
    if (typeof userToken !== "string") {
      throw new Error("Meta did not return a long-lived access token.");
    }

    const pageResponse = await graphGet(
      "me/accounts",
      new URLSearchParams({
        access_token: userToken,
        fields: "id,name,access_token,tasks",
        limit: "100",
      }),
    );
    const data = Array.isArray(pageResponse.data) ? pageResponse.data : [];
    const pages = data.flatMap((item): FacebookPageSession[] => {
      if (!isRecord(item)) return [];
      const { id, name, access_token: accessToken, tasks } = item;
      if (
        typeof id !== "string" ||
        typeof name !== "string" ||
        typeof accessToken !== "string" ||
        !Array.isArray(tasks)
      ) {
        return [];
      }

      const pageTasks = tasks.filter(
        (task): task is string => typeof task === "string",
      );
      if (!pageTasks.includes("CREATE_CONTENT")) return [];
      return [{ id, name, accessToken, tasks: pageTasks }];
    });

    req.session.facebookPages = pages;
    req.session.selectedFacebookPageId =
      pages.length === 1 ? pages[0].id : undefined;
    res.redirect(redirectToApp("connected"));
  } catch (error) {
    console.error(
      "Facebook authorization failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    res.redirect(redirectToApp("error"));
  }
});

app.post("/api/facebook/select-page", (req, res) => {
  const pageId = req.body?.pageId;
  if (typeof pageId !== "string") {
    res.status(400).json({ error: "Choose a Facebook Page." });
    return;
  }

  const page = req.session.facebookPages?.find(
    (candidate) =>
      candidate.id === pageId && candidate.tasks.includes("CREATE_CONTENT"),
  );
  if (!page) {
    res.status(403).json({
      error: "That Page is not available for publishing with this account.",
    });
    return;
  }

  req.session.selectedFacebookPageId = page.id;
  res.json({ selectedPageId: page.id, pageName: page.name });
});

app.post("/api/facebook/upload", (req, res, next) => {
  uploadClip(req, res, (error) => {
    if (error) {
      next(error);
      return;
    }

    void publishReel(req, res).catch(next);
  });
});

async function publishReel(
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const page = getSelectedPage(req);
  if (!page) {
    res.status(401).json({ error: "Connect and choose a Facebook Page first." });
    return;
  }

  const clip = req.file;
  if (!clip || clip.mimetype !== "video/mp4" || clip.size === 0) {
    res.status(400).json({ error: "Choose a valid MP4 clip to publish." });
    return;
  }

  const title =
    typeof req.body.title === "string" ? req.body.title.trim() : "New Reel";
  const description =
    typeof req.body.description === "string"
      ? req.body.description.trim()
      : "";
  if (title.length > 255 || description.length > 2200) {
    res.status(400).json({
      error: "The title or description is longer than Facebook allows.",
    });
    return;
  }

  const start = await graphPost(
    `${encodeURIComponent(page.id)}/video_reels`,
    new URLSearchParams({
      upload_phase: "start",
      access_token: page.accessToken,
    }),
  );
  if (typeof start.video_id !== "string") {
    throw new Error("Meta did not return a video ID for the upload.");
  }

  const uploadUrl = new URL(
    `https://rupload.facebook.com/video-upload/${graphVersion}/${encodeURIComponent(start.video_id)}`,
  );
  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      authorization: `OAuth ${page.accessToken}`,
      offset: "0",
      file_size: String(clip.size),
      "content-type": "application/octet-stream",
    },
    body: clip.buffer,
    signal: AbortSignal.timeout(15 * 60 * 1000),
  });
  await readJson(uploadResponse);

  await graphPost(
    `${encodeURIComponent(page.id)}/video_reels`,
    new URLSearchParams({
      upload_phase: "finish",
      video_id: start.video_id,
      video_state: "PUBLISHED",
      title,
      description,
      access_token: page.accessToken,
    }),
  );

  res.json({ success: true, videoId: start.video_id });
}

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (error instanceof multer.MulterError) {
      const message =
        error.code === "LIMIT_FILE_SIZE"
          ? "This clip is too large. Try a shorter or smaller source video."
          : "The clip could not be received.";
      res.status(400).json({ error: message });
      return;
    }

    const message =
      error instanceof Error ? error.message : "The upload failed unexpectedly.";
    console.error("Facebook Reel upload failed:", message);
    res.status(502).json({ error: message });
  },
);

app.listen(apiPort, "127.0.0.1", () => {
  console.log(`Still API listening at http://127.0.0.1:${apiPort}`);
  if (!facebookConfigured) {
    console.log("Facebook publishing is not configured; see .env.example.");
  }
});
