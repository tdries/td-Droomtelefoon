// osascript -l JavaScript mouth.js <image>... → one JSON line per image: the mouth box (x, y, w, h) and chin,
// normalised 0..1 from the top-left. macOS Vision finds the face; the mouth sits at fixed proportions inside it
// (JXA cannot read Vision's lip points, and this is plenty for a puppet-style talking mouth). Nothing to install.
ObjC.import('Vision');
function run(argv) {
  const r = v => Math.round(v * 10000) / 10000;
  return argv.map(path => {
    const req = $.VNDetectFaceRectanglesRequest.alloc.init;
    $.VNImageRequestHandler.alloc.initWithURLOptions($.NSURL.fileURLWithPath(path), $({})).performRequestsError($([req]), Ref());
    const res = req.results, n = res ? Number(res.count) : 0; // JXA hands counts over as strings
    if (!n) return JSON.stringify({ file: path, error: 'no face' });
    let b = res.objectAtIndex(0).boundingBox;
    for (let i = 1; i < n; i++) { const o = res.objectAtIndex(i).boundingBox; if (o.size.width > b.size.width) b = o; }
    const fx = b.origin.x, fw = b.size.width, fh = b.size.height, bottom = 1 - b.origin.y; // y flipped: Vision's origin is bottom-left
    const cx = fx + fw / 2, cy = bottom - fh * 0.24, w = fw * 0.4, h = fh * 0.1;
    return JSON.stringify({ file: path, x: r(cx - w / 2), y: r(cy - h / 2), w: r(w), h: r(h), chin: r(bottom), face: { x: r(fx), y: r(bottom - fh), w: r(fw), h: r(fh) } });
  }).join('\n');
}
