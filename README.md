# Chess Repertoire

A personal opening repertoire reader and trainer, built as an installable web app (PWA) for iPhone.

Phase 1 (this version): import Lichess studies, read them as a book with a board, and play along.

## Using it

1. **Import** a study from the home screen: paste a Lichess study link (public or unlisted), upload a `.pgn` you downloaded from Lichess, or paste PGN text.
2. The **import check** lists anything odd before you confirm. Warnings never stop an import; you can reopen them later from the course page under *Import issues*.
3. **Read** a chapter: the board stays on top, the text scrolls below. Tap any move to see it. Branches from the Lichess board show as purple, collapsible variations.
4. **Play along** from any position: the board waits for your moves, the text follows you, and the opponent's replies play automatically.
5. **Settings → Save a backup** now and then. Your courses live on the device.

### Clickable lines in your comments

Wrap a line in angle brackets in a Lichess comment and it becomes clickable:

```
We can consider 12...Nf6? but better is <12...Bf6 13. Bxf6 (13. Nxf6 gxf6??) gxf6>.
```

- Only bracketed moves are links; `12...Nf6?` above stays plain (shown in bold).
- A line can start from an earlier move number; it is played from the position where that number fits.
- `( … )` inside the brackets is a side line, an alternative to the move before it.
- A bracketed line with an illegal move is underlined in red and listed in Import issues.

## Install on your iPhone

Open the app's URL in **Safari**, tap **Share → Add to Home Screen**. It then runs full-screen and offline.

## Development

```bash
npm install
npm run dev      # local dev server
npm test         # unit tests
npm run build    # production build in dist/
```

Stack: React + TypeScript + Vite, [chessops](https://github.com/niklasf/chessops) (rules and PGN),
[chessground](https://github.com/lichess-org/chessground) (board), Dexie (IndexedDB), vite-plugin-pwa.

## Deploying

`.github/workflows/deploy.yml` tests, builds and publishes `dist/` to GitHub Pages on every push to `main`.
One-time setup: repository **Settings → Pages → Source: GitHub Actions**.
GitHub Pages on a private repository needs a paid GitHub plan; otherwise make the repository public
(no personal data is in the code; your courses stay on your phone) or host `dist/` on Cloudflare Pages or Netlify.
