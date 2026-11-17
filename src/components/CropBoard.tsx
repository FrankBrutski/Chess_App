import { useEffect, useRef, useState } from 'react';
import { clampCrop, cropToBlob, guessBoard, type Crop } from '../lib/crop';

interface Props {
  blob: Blob;
  onDone: (img: { blob: Blob; width: number; height: number }) => void | Promise<void>;
}

/** Square crop around the board: suggested automatically, drag to move, drag the corner to resize. */
export function CropBoard({ blob, onDone }: Props) {
  const [img, setImg] = useState<HTMLImageElement>();
  const [url, setUrl] = useState<string>();
  const [crop, setCrop] = useState<Crop>();
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: 'move' | 'size'; px: number; py: number; start: Crop } | null>(null);

  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    const im = new Image();
    im.onload = async () => {
      setImg(im);
      setCrop(await guessBoard(im));
    };
    im.src = u;
    return () => URL.revokeObjectURL(u);
  }, [blob]);

  if (!img || !url || !crop) return <p className="muted center">Finding the board…</p>;
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  /** Screen pixels → image pixels. */
  const scale = () => W / (wrap.current?.clientWidth || W);

  const onDown = (mode: 'move' | 'size') => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { mode, px: e.clientX, py: e.clientY, start: crop };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const k = scale();
    const dx = (e.clientX - d.px) * k;
    const dy = (e.clientY - d.py) * k;
    setCrop(
      d.mode === 'move'
        ? clampCrop({ ...d.start, x: d.start.x + dx, y: d.start.y + dy }, W, H)
        : clampCrop({ ...d.start, size: d.start.size + Math.max(dx, dy) }, W, H),
    );
  };
  const onUp = () => { drag.current = null; };

  return (
    <div className="crop">
      <div className="crop-wrap" ref={wrap} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <img src={url} alt="Screenshot" draggable={false} />
        <div
          className="crop-box"
          style={{ left: pct(crop.x, W), top: pct(crop.y, H), width: pct(crop.size, W), height: pct(crop.size, H) }}
          onPointerDown={onDown('move')}
        >
          <span className="crop-grid" aria-hidden="true" />
          <span className="crop-handle" onPointerDown={onDown('size')} aria-label="Resize" />
        </div>
      </div>
      <p className="muted small center">Drag the square onto the board, and the corner to resize. Only the board is kept.</p>
      <div className="row">
        <button type="button" className="wide" onClick={() => setCrop({ x: 0, y: 0, size: Math.min(W, H) })}>Whole image</button>
        <button
          type="button"
          className="wide primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try { await onDone(await cropToBlob(img, crop)); } finally { setBusy(false); }
          }}
        >
          {busy ? 'Saving…' : 'Use this crop'}
        </button>
      </div>
    </div>
  );
}
