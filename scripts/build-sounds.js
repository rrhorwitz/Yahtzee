/* Renders the synthesized sounds in fx.js to sounds/*.m4a.
   Usage: npm start (in another terminal, port 8137: python3 -m http.server 8137), then
   node scripts/build-sounds.js /tmp/wav && for f in /tmp/wav/*.wav; do ffmpeg -y -i "$f" -c:a aac -b:a 64k "sounds/$(basename "${f%.wav}").m4a"; done */
const { chromium } = require('playwright'); const fs = require('fs'); const OUT = process.argv[2];
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('http://localhost:8137/'); await p.waitForTimeout(600);
  const res = await p.evaluate(async () => {
    const enc = (buf) => { const ch = buf.getChannelData(0), sr = buf.sampleRate, n = ch.length;
      const dv = new DataView(new ArrayBuffer(44 + n * 2)); const w = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
      w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
      dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.max(-1, Math.min(1, ch[i])) * 0x7fff, true);
      let s = ''; const u8 = new Uint8Array(dv.buffer); for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
    const jobs = [];
    for (let n = 1; n <= 5; n++) for (let v = 0; v < 3; v++) jobs.push([`roll${n}-${v}`, 'roll', n, 0.95]);
    jobs.push(['hold', 'hold', 0, 0.35], ['score', 'score', 0, 0.6], ['upper', 'upper', 0, 1.2], ['bonus', 'bonus', 0, 0.8], ['win', 'win', 0, 1.4]);
    const out = {};
    for (const [file, name, arg, secs] of jobs) { const ctx = new OfflineAudioContext(1, Math.ceil(44100 * secs), 44100); window.FX.SOUNDS[name](ctx, 0.005, arg || undefined); out[file] = enc(await ctx.startRendering()); }
    const sil = new OfflineAudioContext(1, 2205, 44100); out.silent = enc(await sil.startRendering());
    return out;
  });
  fs.mkdirSync(OUT, { recursive: true });
  for (const [k, v] of Object.entries(res)) fs.writeFileSync(`${OUT}/${k}.wav`, Buffer.from(v, 'base64'));
  console.log(Object.keys(res).length, 'files'); await b.close();
})();
