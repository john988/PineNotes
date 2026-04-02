# Pine Notes

Pine Notes is a minimal desktop Markdown notes app built with Electron.

It focuses on fast capture, a calm writing surface, and simple local-first storage. Notes stay on your machine, support Markdown preview, and can be packaged as a portable Windows executable.

## Highlights

- Clean two-pane note workflow with sidebar, list, editor, and preview
- Markdown editing with live preview
- Starred notes, archive view, and search
- Image paste / drag-and-drop support
- Local file-based persistence for notes and embedded images
- Portable Windows `.exe` build

## Why This Project Exists

Pine Notes is meant to feel lightweight and focused:

- fast enough for scratch notes
- structured enough for real Markdown writing
- local enough to avoid forcing cloud sync

If you want a private note tool that launches quickly and stays out of the way, this project is aimed at that experience.

## Tech Stack

- Electron
- Plain HTML / CSS / JavaScript
- [marked](https://github.com/markedjs/marked) for Markdown parsing
- electron-builder for packaging

## Getting Started

### Requirements

- Node.js 20+
- npm
- Windows for the packaged `.exe` outputs

### Install dependencies

```bash
npm install
```

### Run in development

```bash
npm start
```

## Build

Build the portable executable:

```bash
npm run build
```

Build portable executable explicitly:

```bash
npm run build:portable
```

Typical build outputs:

- `dist/PineNotes-Portable-<version>.exe`

## Storage

Pine Notes stores data locally on the user's machine.

- Notes are saved as JSON in Electron's `userData` directory
- Pasted or inserted images are written as separate local files
- The app migrates older browser-style localStorage data into the newer file-based storage on startup

This keeps the app usable even when notes include images, instead of running into browser storage limits.

## Features

### Writing

- Plain Markdown editing
- Toolbar shortcuts for common formatting
- Keyboard shortcuts for create / bold / italic / preview

### Organizing

- Star notes you want to keep close
- Archive notes you do not want in the main list
- Search by title or content

### Preview Safety

Markdown preview is sanitized before rendering.

- raw HTML is not executed
- unsafe links are filtered
- image sources are restricted to safe URLs

## Project Structure

```text
main.js        Electron main process and storage IPC
preload.js     Safe bridge between renderer and main process
index.html     App UI, styling, and renderer logic
package.json   Scripts and packaging config
```

## Current Scope

This project is intentionally small and focused. It does not currently include:

- cloud sync
- multi-device account support
- notebooks / folders
- export formats beyond the packaged app itself

Those would be natural next steps if the app grows.

## Roadmap Ideas

- Export notes to Markdown files
- Add note tags
- Add theme variants
- Add import / backup tools
- Add recent-note pinning or quick switcher

## License

No license file has been added yet. If you plan to publish or accept contributions, adding a license is recommended.
