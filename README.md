# Static Academic Homepage

This folder contains a from-scratch static academic homepage.

This repo is 100% developed with Cursor. Please let me know if there is any infringement issue.

## Included sections

- About (personal introduction)
- Publications (selected papers with links)
- Gallery (local photography, with uncropped previews and a full gallery)

## Preview

### macOS / Linux

Run `python3 -m http.server 1313 --bind 127.0.0.1` from this folder, then open
`http://127.0.0.1:1313/`. Stop the preview with Ctrl+C.

To regenerate the gallery's responsive WebP previews (800/1600px), lightbox images
(up to 2560px), dimensions, and 400/800px portrait variants, run
`python3 scripts/build-gallery.py` (requires Pillow: `python3 -m pip install Pillow`).
This preserves originals and existing manifest order/captions; new photos are appended.

### One-command local preview (like `hugo server`)

From this folder, run:

- `npm run preview`

or directly:

- `.\preview.bat`
- `.\preview.ps1`

This will:

- Try `http://localhost:1313` first
- Auto-switch to the next free port if occupied (for example `1314`, `1315`, ...)
- Open your default browser automatically

Alternative port:

- `npm run preview:8080`

## Deploy bundle (one command)

From this folder, run:

- `npm run deploy`

This will:

- Rebuild gallery thumbnails and `gallery.json`
- Generate a ready-to-upload folder: `_deploy`
- Put all required static files inside `_deploy`

Upload everything inside `_deploy` to your school homepage server.

## Customize quickly

- Edit bio and contact links in `content.md` (the homepage also has initial HTML bio text)
- Update publication items in `bibtex/yichuan_deng.bib`; use `selected={true}` for the homepage and `equal_contribution={3}` to mark the first three authors
- Set `cat={Computer Vision}` (or any category name) to group papers on Full Publications. Category order follows first appearance in BibTeX; papers within each category are newest first. Missing/empty categories go under Other Publications. The `cat` field is omitted from copied citations.
- Replace gallery images in `assets/gallery/`
- Tweak visual style in `styles.css`

## Smoke tests

Run `node tests/homepage.test.js`, or on macOS without Node:

`/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc tests/homepage.test.js`

These check author expansion/co-first markers, citation content, email links,
modal focus wrapping, and carousel pause/advance logic; they do not replace visual browser testing.
