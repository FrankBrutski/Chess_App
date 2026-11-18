import numpy as np, sys, json, base64, glob
NF = 777
ROW = NF + 2
CL = ['', 'K', 'Q', 'R', 'B', 'N', 'P', 'k', 'q', 'r', 'b', 'n', 'p']

def load(paths):
    a = np.concatenate([np.fromfile(p, dtype=np.uint8).reshape(-1, ROW) for p in paths])
    return a[:, 2:].astype(np.float32) / 255, a[:, 0].astype(np.int64), a[:, 1]

train_files = sys.argv[1].split(',')
test_files = sys.argv[2].split(',') if len(sys.argv) > 2 and sys.argv[2] else []
out = sys.argv[3] if len(sys.argv) > 3 else None
H = int(sys.argv[4]) if len(sys.argv) > 4 else 128
EPOCHS = int(sys.argv[5]) if len(sys.argv) > 5 else 30
X, y, _ = load(train_files)
print('train', X.shape, np.bincount(y, minlength=13))
mean = X.mean(0); std = X.std(0) + 0.05
Xn = (X - mean) / std
rng = np.random.default_rng(0)
sizes = [NF, H, 13]
Ws = [rng.normal(0, np.sqrt(2 / sizes[i]), (sizes[i + 1], sizes[i])).astype(np.float32) for i in range(2)]
bs = [np.zeros(sizes[i + 1], np.float32) for i in range(2)]
params = Ws + bs
m = [np.zeros_like(p) for p in params]; v = [np.zeros_like(p) for p in params]
lr = 2e-3; wd = 1e-4; t = 0
def fwd(Xb, train=False):
    h = Xb @ Ws[0].T + bs[0]
    h = np.maximum(h, 0)
    if train:
        drop = (rng.random(h.shape) > 0.2) / 0.8
        h = h * drop
    o = h @ Ws[1].T + bs[1]
    return h, o
for ep in range(EPOCHS):
    idx = rng.permutation(len(Xn))
    tot = 0
    for s in range(0, len(idx), 256):
        bi = idx[s:s + 256]
        Xb = Xn[bi]
        # input noise for robustness
        Xb = Xb + rng.normal(0, 0.1, Xb.shape).astype(np.float32)
        yb = y[bi]
        h, o = fwd(Xb, True)
        o = o - o.max(1, keepdims=True)
        p = np.exp(o); p /= p.sum(1, keepdims=True)
        tot += -np.log(p[np.arange(len(yb)), yb] + 1e-9).sum()
        g = p; g[np.arange(len(yb)), yb] -= 1; g /= len(yb)
        gW1 = g.T @ h; gb1 = g.sum(0)
        gh = g @ Ws[1]; gh[h <= 0] = 0
        gW0 = gh.T @ Xb; gb0 = gh.sum(0)
        grads = [gW0 + wd * Ws[0], gW1 + wd * Ws[1], gb0, gb1]
        t += 1
        for i, (pp, gg) in enumerate(zip(params, grads)):
            m[i] = 0.9 * m[i] + 0.1 * gg; v[i] = 0.999 * v[i] + 0.001 * gg * gg
            pp -= lr * (m[i] / (1 - 0.9 ** t)) / (np.sqrt(v[i] / (1 - 0.999 ** t)) + 1e-8)
    if ep == int(EPOCHS * 0.6) or ep == int(EPOCHS * 0.85): lr /= 3
    print(f'epoch {ep} loss {tot / len(Xn):.4f}', flush=True)

def quant(W):
    sc = np.abs(W).max() / 127
    return np.clip(np.round(W / sc), -127, 127).astype(np.int8), sc
qW = [quant(W) for W in Ws]
Wq = [q.astype(np.float32) * sc for q, sc in qW]
def predict(Xt):
    h = np.maximum(((Xt - mean) / std) @ Wq[0].T + bs[0], 0)
    return (h @ Wq[1].T + bs[1]).argmax(1)
acc = (predict(X) == y).mean(); print('train acc', acc)
if test_files:
    Xt, yt, st = load(test_files)
    pr = predict(Xt)
    print('heldout acc', (pr == yt).mean(), 'n', len(yt))
    for s in np.unique(st):
        k = st == s; print(' set', s, (pr[k] == yt[k]).mean())
    occ = yt > 0
    print(' occupied acc', (pr[occ] == yt[occ]).mean(), ' empty acc', (pr[~occ] == 0).mean())
    colour = lambda a: np.where(a == 0, 0, np.where(a <= 6, 1, 2))
    print(' colour acc (occupied)', (colour(pr[occ]) == colour(yt[occ])).mean())
    cm = np.zeros((13, 13), int)
    for a, b in zip(yt, pr): cm[a, b] += 1
    print('confusion (rows true):'); print('   ' + ' '.join(f'{c or "."!s:>4}' for c in CL))
    for i in range(13): print(f'{CL[i] or ".":>2} ' + ' '.join(f'{x:4d}' for x in cm[i]))
if out:
    j = {'sizes': sizes, 'mean': [round(float(x), 4) for x in mean], 'std': [round(float(x), 4) for x in std],
         'layers': [{'scale': float(sc), 'w': base64.b64encode(q.tobytes()).decode(), 'b': [round(float(x), 5) for x in b]} for (q, sc), b in zip(qW, bs)]}
    json.dump(j, open(out, 'w'), separators=(',', ':'))
    print('wrote', out)
