# Still

A small, client-side YouTube viewer. Paste a YouTube video URL (or an 11-character video ID) to open it in YouTube's official embedded player. The player divides the timeline into clickable 45-second sections by default, with 15-, 30-, and 60-second options.

## Run locally

```sh
npm install
npm run dev
```

Run the production build and URL parser tests with:

```sh
npm run build
npm test
```

## Video handling

This app does not download videos, save links, or keep watch history. The link and section controls are held only in the current page's memory. Playback and duration are provided by YouTube's privacy-enhanced embedded player and IFrame API; YouTube may process playback and device data under its own policies.
