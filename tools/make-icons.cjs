// アプリのアイコン（icon-192.png・icon-512.png）を作る。紺の地に、書類と時計（税の期限）。
// 使い方: node tools/make-icons.cjs（qa/ の playwright を使う）
const path = require("path");
const { chromium } = require(path.join(__dirname, "..", "qa", "node_modules", "playwright"));
(async () => {
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  for (const s of [192, 512]) {
    const p = await b.newPage({ viewport: { width: s, height: s } });
    await p.setContent(`<body style="margin:0"><svg width="${s}" height="${s}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="#123554"/>
      <rect x="20" y="18" width="50" height="66" rx="4" fill="#fffdf7"/><rect x="28" y="30" width="34" height="5" fill="#8fb8de"/><rect x="28" y="42" width="34" height="5" fill="#8fb8de"/><rect x="28" y="54" width="24" height="5" fill="#8fb8de"/><circle cx="76" cy="74" r="14" fill="#f2a43a"/><path d="M76 66 V74 L82 78" stroke="#123554" stroke-width="3" fill="none"/></svg></body>`);
    await p.screenshot({ path: path.join(__dirname, "..", `icon-${s}.png`), clip: { x: 0, y: 0, width: s, height: s } });
  }
  await b.close();
})();
