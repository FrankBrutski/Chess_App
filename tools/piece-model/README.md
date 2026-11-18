# Piece model

`src/lib/pieceModel.json` is the small network `src/lib/recognize.ts` uses to read pieces off a board screenshot.
It runs on the phone; nothing here ships in the app.

How it was made:

1. Piece sets: the SVGs from lichess-org/lila `public/piece/<set>/` (32 sets: alpha, anarcandy, caliente, california,
   cardinal, cburnett, celtic, chess7, chessnut, companion, cooke, dubrovny, fantasy, firi, fresca, gioco, governor,
   icpieces, kosal, leipzig, maestro, merida, mpchess, papercut, pirouetti, reillycraig, rhosgfx, riohacha, spatial,
   staunty, tatiana, totoy) in `sets/<set>/wK.svg` etc. They are only used to draw training boards.
2. `node gen.cjs out.bin <sets,comma,separated> <boards> <seed> [keepEmpty]` draws random positions in Chromium with
   18 board colour themes, last-move highlights, coordinates, check glows, JPEG compression and a slightly-off crop,
   then runs the app's own `squareFeatures` (bundle `src/lib/recognize.ts` to `rec.js` as an IIFE named `Rec` with esbuild).
3. `python3 train.py <train.bin,...> <test.bin> <out.json> 256 40` trains the 777→256→13 network (numpy only) and
   stores int8 weights.
4. `node real.cjs model.json` runs the whole thing (find the board, crop, read) on real screenshots.

Accuracy with 4 sets held out (staunty, tatiana, maestro, california never seen in training): 97.4% of squares,
91% of pieces (staunty 91%, tatiana 96%, maestro 94%, california 83%: its white pieces are drawn mostly in black).
Real iPhone screenshots tried: Apiary (start position, flipped) and a Chessable screen (32 pieces, flipped): all squares right.
