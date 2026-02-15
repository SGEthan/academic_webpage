# Static Academic Homepage

This folder contains a from-scratch static academic homepage.

## Included sections

- About (personal introduction)
- Publications (selected papers with links)
- Gallery (local SVG images)

## Preview

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

- Edit bio and contact links in `index.html`
- Update publication items in `index.html`
- Replace gallery images in `assets/gallery/`
- Tweak visual style in `styles.css`
