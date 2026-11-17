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

What the brackets accept (all covered by `src/lib/__tests__/brackets.test.ts`):

| Written | Accepted |
| --- | --- |
| Move numbers | `12.Nf3`, `12. Nf3`, `12...Nf6`, `12... Nf6`, `12…Nf6`, `12..Nf6`, `12. ... Nf6`; or no number at all |
| Start position | Any earlier move in the line you're reading, a main-line move still to come, or (with no number) the current position, then the move just played |
| Castling | `O-O`, `O-O-O`, `0-0`, `0-0-0` |
| Promotion, check, mate | `e8=Q`, `e8Q`, `+`, `#` (a missing or extra `+` is fine) |
| Marks and evaluations | `Nf6!?` or `Nf6 !?`, `$6`, `+=`, `+/=`, `=`, `∞`, `1-0`, `*`: kept as text, not moves |
| Side lines | `(…)` after a move = an alternative to that move; several in a row; nested to any depth |
| Punctuation | Brackets next to `(`, `)`, quotes, `.`, `,`, `:`; commas inside the brackets |
| Several lines | Any number of `<…>` in one comment |

Flagged (red underline + Import issues): an illegal move, a move number that doesn't fit the position,
unbalanced `(` `)`, prose inside the brackets (`<see above>`), and a lone `<` or `>` without its partner.

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

## Privacy and security

- **No tracking.** No analytics, ads, third-party scripts, fonts or CDNs. Everything the app needs is bundled and served from the same site.
- **One outside connection, only when you ask.** Tapping *Get study* or *Sync* downloads the study from `lichess.org` (no cookies, no referrer). Settings → *Allow downloading studies from lichess.org* switches even that off.
- **Enforced by the browser.** The built page carries a Content Security Policy that only allows the app's own files plus `https://lichess.org`; any other request or script is blocked.
- **No device access.** The app asks for no camera, microphone, location, contacts, photos or notifications. Your courses stay in the app's own storage on the phone. Sharing a backup only opens the iOS share sheet when you tap *Save a backup*.
- **Works offline.** After the first visit the whole app is cached; only the Lichess download needs a connection.
