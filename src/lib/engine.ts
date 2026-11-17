import { parseInfo, type EngineLine } from './uci';

/**
 * Stockfish running on the device as WebAssembly in a Web Worker.
 * The engine files are served from this app's own origin (public/engine),
 * cached for offline use, and never talk to the network.
 */
const ENGINE_URL = './engine/stockfish-19-lite-single.js';

export interface AnalysisRequest {
  fen: string;
  depth: number; // 0 = until stopped
  multiPv: number;
}

type Listener = (lines: EngineLine[], done: boolean) => void;

class Engine {
  private worker?: Worker;
  private ready?: Promise<void>;
  private searching = false;
  private pending?: { req: AnalysisRequest; listener: Listener };
  private current?: { req: AnalysisRequest; listener: Listener; lines: EngineLine[]; whiteToMove: boolean };
  private stopping = false;

  private boot(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const w = new Worker(ENGINE_URL);
      this.worker = w;
      w.onerror = (e) => reject(new Error(`Engine failed to start: ${e.message ?? 'unknown error'}`));
      w.onmessage = (e: MessageEvent<string>) => {
        const line = String(e.data);
        if (line === 'readyok') resolve();
        else this.onLine(line);
      };
      w.postMessage('uci');
      w.postMessage('setoption name Hash value 32');
      w.postMessage('isready');
    });
    return this.ready;
  }

  private onLine(line: string) {
    if (line.startsWith('bestmove')) {
      const cur = this.current;
      this.searching = false;
      this.current = undefined;
      if (cur && !this.stopping) cur.listener(cur.lines, true);
      this.stopping = false;
      if (this.pending) {
        const p = this.pending;
        this.pending = undefined;
        this.start(p.req, p.listener);
      }
      return;
    }
    const cur = this.current;
    if (!cur || this.stopping) return;
    const info = parseInfo(line, cur.whiteToMove);
    if (!info) return;
    const lines = cur.lines.filter((l) => l.multipv !== info.multipv);
    lines.push(info);
    lines.sort((a, b) => a.multipv - b.multipv);
    cur.lines = lines;
    cur.listener(lines, false);
  }

  private start(req: AnalysisRequest, listener: Listener) {
    const w = this.worker!;
    this.current = { req, listener, lines: [], whiteToMove: req.fen.split(' ')[1] !== 'b' };
    this.searching = true;
    w.postMessage(`setoption name MultiPV value ${req.multiPv}`);
    w.postMessage(`position fen ${req.fen}`);
    w.postMessage(req.depth > 0 ? `go depth ${req.depth}` : 'go infinite');
  }

  /** Analyse a position, replacing any running analysis. */
  async analyse(req: AnalysisRequest, listener: Listener) {
    await this.boot();
    if (this.searching) {
      this.pending = { req, listener };
      if (!this.stopping) {
        this.stopping = true;
        this.worker!.postMessage('stop');
      }
      return;
    }
    this.start(req, listener);
  }

  /** Stop thinking (keeps the engine loaded for a quick restart). */
  stop() {
    this.pending = undefined;
    if (this.searching && !this.stopping) {
      this.stopping = true;
      this.worker?.postMessage('stop');
    }
  }

  /** Stop and unload the engine to free memory and battery. */
  shutdown() {
    this.stop();
    this.worker?.terminate();
    this.worker = undefined;
    this.ready = undefined;
    this.searching = false;
    this.stopping = false;
    this.current = undefined;
  }
}

export const engine = new Engine();

/** One quick evaluation (best line only). Resolves undefined if the engine can't run or takes too long. */
export function evaluate(fen: string, depth = 14, timeoutMs = 8000): Promise<EngineLine | undefined> {
  return new Promise((resolve) => {
    let best: EngineLine | undefined;
    const t = setTimeout(() => { engine.stop(); resolve(best); }, timeoutMs);
    engine
      .analyse({ fen, depth, multiPv: 1 }, (lines, done) => {
        best = lines[0] ?? best;
        if (done) { clearTimeout(t); resolve(best); }
      })
      .catch(() => { clearTimeout(t); resolve(undefined); });
  });
}
