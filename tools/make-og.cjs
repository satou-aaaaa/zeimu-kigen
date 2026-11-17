// SNS で貼られたときの絵（og.png 1200×630）を作る。今日の問題（答え）は入れず、遊び方の例だけ（問題データにない言い方で、正解の印も付けない。CodeRabbit mansion-kimari#1）。
// 使い方: node tools/make-og.cjs（qa/ の playwright を使う）
const path = require("path");
const { chromium } = require(path.join(__dirname, "..", "qa", "node_modules", "playwright"));
const K = require(path.join(__dirname, "..", "data.js"));
(async () => {
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
  const line = (t, ok) => `<div style="position:relative;font-size:30px;font-weight:700;padding:10px ${ok ? "150px" : "20px"} 10px 20px;border-radius:12px;background:#fff;border:${ok ? "5px solid #b23a24" : "3px solid #1d2a3f55"}">${t}${ok ? `<span style="position:absolute;right:16px;top:50%;transform:translateY(-50%) rotate(-8deg);border:4px solid #83261a;color:#83261a;border-radius:8px;padding:0 10px;font-size:28px;font-weight:900">正解</span>` : ""}</div>`;
  await p.setContent(`<body style="margin:0;font-family:'Noto Sans CJK JP','IPAPGothic',sans-serif">
  <div style="width:1200px;height:630px;box-sizing:border-box;padding:48px 64px;background:#f3efe4;color:#1d2a3f;display:flex;gap:48px;align-items:center">
    <div style="flex:0 0 420px">
      <div style="font-size:30px;color:#83261a;letter-spacing:.06em">申告・更正の請求・繰越し</div>
      <div style="font-size:84px;font-weight:900;margin-top:8px;line-height:1.15;color:#123554">税の<br><span style="color:#2f6fae">期限</span></div>
      <div style="font-size:36px;margin-top:14px">その期限<br>どれだけ？</div>
    </div>
    <div style="flex:1;background:#fffdf7;border:4px solid #1d2a3f;border-radius:8px;overflow:hidden">
      <div style="font-size:30px;font-weight:700;padding:22px 20px 6px">〰 税の手続きの場面から期限を選ぶ。</div>
      <div style="display:flex;flex-direction:column;gap:10px;padding:16px">${line("1週間？")}${line("10日？")}${line("2年？")}</div>
    </div>
  </div></body>`);
  await p.screenshot({ path: path.join(__dirname, "..", "og.png") });
  await b.close();
})();
