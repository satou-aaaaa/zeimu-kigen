// 税の期限の検査。問題の作り方（21種類×3000問：選び肢・答えは1つ・答えと系統が条文の表どおり・出典がある）・
// 今日の5問と上級の組み方（3年分）・とことんの並び（何百回作って1回の中で重ならない）・通しで遊ぶ・まちがい・ヒント・続きから・
// 上級・練習・とことん・税の帳・実績・カレンダー・あとから・文字の大きさ・言い方（公式の情報の代わりにしない）・スマホ幅・PWA・引き継ぎ・見やすさを確かめる。
// 使い方: node qa/run.mjs   失敗があれば終了コード 1。結果は qa-report/report.md。
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { checkTransfer } from "./transfer-check.mjs";
import { checkSwStall } from "./sw-check.mjs";
import { checkDepth } from "./depth-check.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: !!ok, detail: String(detail).slice(0, 400) });
const firstClose = async (q) => { if (await q.locator("#howto[open]").count()) await q.click("#howto-ok"); if (await q.evaluate(() => !!(window.Core && Core.coach && Core.coach.active()))) { await q.evaluate(() => { Core.coach.leave(); scrollTo(0, 0); }); await q.waitForTimeout(100); } }; // はじめての練習の吹き出しをやめてホームへ（sync-template の migrateFirstQa が足した）
const G = createRequire(import.meta.url)(path.join(root, "data.js"));

const PIN = "jiko:0:5.4"; // 第1回の1問目（変わったら過去の日の問題が変わった印）
// ---- 1. 問題の作り方（ブラウザを使わない）----
// 条文の表（ゲームとは別に書いた表。data.js の答えと2段目がこれと合うかを見る）
// 出典：e-Gov 法令検索の国税通則法など5つ（2026-11-18 に読んだ）。種類 → [答えの期限, きまり（shinkoku 申告の期限・naosu 直す・不服・kurikoshi 繰越し・さかのぼり）, 説明に出す条]
const TB = {
  sozoku: ["10か月", "shinkoku", "相続税法 第27条"], "jun-kakutei": ["4か月", "shinkoku", "所得税法 第125条"], "shisha-yokunen": ["4か月", "shinkoku", "所得税法 第124条"],
  hojin: ["2か月", "shinkoku", "法人税法 第74条"], "hojin-encho": ["1か月", "shinkoku", "法人税法 第75条の2"], shohi: ["2か月", "shinkoku", "消費税法 第45条"],
  aoiro: ["2か月", "shinkoku", "所得税法 第144条"], kosei: ["5年", "naosu", "国税通則法 第23条"], "kosei-hojin": ["10年", "naosu", "国税通則法 第23条"],
  "kosei-hanketsu": ["2か月", "naosu", "国税通則法 第23条"], "sozoku-kosei": ["4か月", "naosu", "相続税法 第32条"], fufuku: ["3か月", "naosu", "国税通則法 第77条"],
  "fufuku-ato": ["1か月", "naosu", "国税通則法 第77条"], "fufuku-kyakkan": ["1年", "naosu", "国税通則法 第77条"], "kosei-kigen": ["5年", "naosu", "国税通則法 第70条"],
  itsuwari: ["7年", "naosu", "国税通則法 第70条"], junsonshitsu: ["3年", "kurikoshi", "所得税法 第70条"], kesson: ["10年", "kurikoshi", "法人税法 第57条"],
  "zoyo-kasan": ["7年", "kurikoshi", "相続税法 第19条"], jiko: ["5年", "kurikoshi", "国税通則法 第72条"], ennou: ["5年", "kurikoshi", "相続税法 第38条"],
};
// 期間の並び（短い順）
const ORDER = ["1か月", "2か月", "3か月", "4か月", "10か月", "1年", "3年", "5年", "7年", "10年"];
// 説明に当てはまりうるので、まちがいの選び肢にしない組（場面ごとに期間は1つなので無し）
const NEVER = {};
{
  const bad = {}, seen = {}, N = 3000;
  for (const k of G.KINDS) {
    seen[k.id] = new Set();
    for (let s = 0; s < N; s++) {
      const P = G.make(`${k.id}|qa${s}`), why = [], n = k.lv === 0 ? 3 : 4;
      if (P.opts.length !== n || new Set(P.opts).size !== n || !P.opts.includes(P.ans) || P.opts.some((o) => !ORDER.includes(o))) why.push(`選び肢が${n}つちがう・答えを含まない`);
      if ([P.q, P.media, ...P.opts].some((x) => typeof x !== "string" || !x || /undefined|NaN|null|\$\{|＠/.test(x))) why.push("中身が空");
      const t = TB[k.id], near = k.near.map((i) => ORDER[i]);
      if (!t) why.push("条文の表に無い種類");
      else {
        if (P.ans !== t[0]) why.push("答えが条文の表とちがう");
        if (P.grp !== t[1]) why.push("2段目のきまりが条文の表とちがう");
        if (!k.why.includes("（" + t[2]) && !k.why.includes("（" + t[2].replace(/ 第.*/, "") + " 第")) why.push("説明の法令が表とちがう");
        if (!k.why.includes(t[2]) || k.src.length !== 1 || G.SRC[k.src[0]][0] !== "e-Gov 法令検索「" + t[2].replace(/ 第.*/, "") + "」") why.push("出典・説明の条文が表とちがう");
        if (!k.why.includes(t[0])) why.push("説明の期間が答えとちがう");
        if (!/　期間は？$/.test(P.q) || P.rev) why.push("問いの言い方がちがう");
        if (P.q.includes(t[0])) why.push("問いに答えの名前が出ている");
        if (P.opts.some((o) => (NEVER[k.id] || []).includes(o))) why.push("説明に当てはまりうる類が、まちがいの選び肢にまじる");
        if (new Set(P.opts).size !== P.opts.length) why.push("同じ期限が選び肢に2つ出る");
        if (k.lv === 0 && P.opts.some((o) => near.includes(o))) why.push("やさしいのに、まぎらわしい類がまじる");
        if (k.lv === 2 && !P.opts.some((o) => near.includes(o))) why.push("むずかしいのに、まぎらわしい類が無い");
      }
      if (!P.src.length || P.src.some((x) => !Array.isArray(x) || !/^https:\/\/laws\.e-gov\.go\.jp\/law\//.test(x[1]))) why.push("出典が無い");
      if (JSON.stringify(G.make(`${k.id}|qa${s}`)) !== JSON.stringify(P)) why.push("同じ種で同じ問題にならない");
      seen[k.id].add(G.keyOf(P));
      if (why.length && !bad[k.id]) bad[k.id] = why.join("・") + "：" + P.q + " " + P.opts.join(" / ");
    }
  }
  check(`問題：${G.KINDS.length}種類×${N}問で、選び肢（やさしい3・ほか4）・答えは1つ・答えと系統が資料の表どおり・出典がある`.replace("答えと系統が資料", "答えと系統が条文"), Object.keys(bad).length === 0, JSON.stringify(bad));
  const total = Object.values(seen).reduce((a, s) => a + s.size, 0), few = G.KINDS.filter((k) => seen[k.id].size < 12).map((k) => `${k.id}:${seen[k.id].size}`);
  check("問題の数：全部で300通り以上・どの種類も12通り以上（好きなだけ遊んでも同じ問題が続かない。game-dev.md F6）", total >= 300 && few.length === 0, `${total}通り ${few.join(",")}`);
  check("問題：種類は21（やさしい7・ふつう8・むずかしい6）・表の種類と同じ", G.KINDS.length === 21 && [0, 1, 2].map((l) => G.kindsOf(l).length).join() === "7,8,6" && Object.keys(TB).length === 21);
  check("答えは7の期限とも出る・選び肢のもとの一覧（LEVELS）は短い順（画面の選び肢はわざと混ぜる）", ORDER.every((o) => G.KINDS.some((k) => k.ans === o)) && JSON.stringify(G.LEVELS) === JSON.stringify(ORDER));
  check("2段目は3つ（申告の期限／直す・不服／繰越し・さかのぼり）とも答えに出る", Object.keys(G.GROUPS).join() === "shinkoku,naosu,kurikoshi" && Object.keys(G.GROUPS).every((g) => G.KINDS.some((k) => k.grp === g)));
  check("罰則・お金の額は出さない（説明に入れない）", !G.KINDS.some((k) => /円|罰金|罰則|懲役|過料/.test(k.why + k.key + k.look)));
  const longWhy = [], longLook = [], longOpt = [];
  for (const k of G.KINDS) { if ([...k.why].length > 100) longWhy.push(k.id); if ([...k.look].length > 45 || [...k.key].length > 60) longLook.push(k.id); for (let s = 0; s < 200; s++) { const P = G.make(`${k.id}|len${s}`); for (const o of P.opts) if ([...o].length > 20) longOpt.push(`${k.id}:${o}`); if ([...P.q].length > 70) longOpt.push(`${k.id}:${P.q}`); } }
  check("説明は100字以内・ヒントは45字・60字以内・選び肢は20字以内・問いは70字以内（やさしい日本語。一文を短く）", !longWhy.length && !longLook.length && !longOpt.length, longWhy.concat(longLook, longOpt.slice(0, 3)).join(","));
  const SRCS = { "国税通則法": "337AC0000000066", "所得税法": "340AC0000000033", "相続税法": "325AC0000000073", "法人税法": "340AC0000000034", "消費税法": "363AC0000000108" };
  const okSrc = Object.values(G.SRC).every(([n, u]) => { const m = n.match(/^e-Gov 法令検索「(.+)」$/); return m && SRCS[m[1]] && u === "https://laws.e-gov.go.jp/law/" + SRCS[m[1]]; }) && G.KINDS.every((k) => k.src.length && k.src.every((x) => G.SRC[x]));
  check("出典は e-Gov 法令検索の国税通則法など5つの法令だけ・どの種類にも出典がある", okSrc && Object.keys(G.SRC).length === 5);
  const sb = Object.keys(G.GROUPS).filter((g) => G.LEVELS.some((o) => (G.GROUPS[g].name + G.GROUPS[g].sub).includes(o)));
  check("2段目の選び肢に期間を書かない", sb.length === 0, sb.join());
}
{
  // 今日の5問・上級の組み方（3年分）
  const bad = [], cover = new Set(); let sameAsPrev = 0, prev = "";
  const d0 = Date.parse("2026-11-18");
  for (let i = 0; i < 365 * 3; i++) {
    const d = new Date(d0 + i * 864e5).toISOString().slice(0, 10), dl = G.dailyTags(d), hl = G.hardTags(d);
    const dk = dl.map((t) => t.split("|")[0]), hk = hl.map((t) => t.split("|")[0]);
    if (dl.length !== 5 || new Set(dk).size !== 5 || dk.map((k) => G.BY[k].lv).join() !== "0,0,1,1,2") bad.push(d + " 今日");
    if (hl.length !== 3 || new Set(hk).size !== 3 || hk.some((k) => G.BY[k].lv !== 2) || hk.includes(dk[4])) bad.push(d + " 上級");
    if (JSON.stringify(dl) !== JSON.stringify(G.dailyTags(d))) bad.push(d + " 同じにならない");
    if (dk.join() === prev) sameAsPrev++; prev = dk.join();
    if (i < 60) [...dk, ...hk].forEach((k) => cover.add(k));
  }
  check("今日の5問（やさしい2・ふつう2・むずかしい1、種類は重ねない）と上級（むずかしい3・今日のむずかしいと別）を3年分作れる", bad.length === 0, bad.slice(0, 5).join(","));
  check(`2か月のうちに${G.KINDS.length}種類が全部出る・前の日と同じ組の日が少ない`, cover.size === G.KINDS.length && sameAsPrev < 20, `${cover.size}種類・前の日と同じ ${sameAsPrev}日`);
  // 過去の日の問題が変わらない（data.js を直したときの見張り。値は 2026-11-18 に作ったもの）
  const P0 = G.make(G.dailyTags("2026-11-18")[0]);
  check("第1回（2026-11-18）の1問目が作ったときのまま（並べ替え・削除で過去の日の問題を変えない）", `${P0.kind}:${P0.v}` === PIN, `${P0.kind}:${P0.v}`);
}

// ---- 2. ファイルの中身 ----
const html = readFileSync(path.join(root, "index.html"), "utf8"), gen = readFileSync(path.join(root, "data.js"), "utf8"), readme = readFileSync(path.join(root, "README.md"), "utf8");
const ext = [...html.matchAll(/(?:src|href)="(https?:[^"]+)"/g)].map((m) => m[1]).filter((u) => !/^https:\/\/fonts\.googleapis\.com(\/|$)|^https:\/\/ko-fi\.com\/satouaaaaa$/.test(u));
check("外から読むのは文字（Google Fonts）だけ。スクリプト・広告・解析を入れない（出典のリンクは押したときに開くだけ）", ext.length === 0 && ![...html.matchAll(/<script[^>]+src="([^"]+)"/g)].some((m) => /^https?:/.test(m[1])), ext.join(","));
check("CSP で通信先を自分だけにしている（connect-src は 'self' だけ。CodeRabbit menkyo-nenrei#1）", (html.match(/connect-src[^;"]*/g) || []).map((s) => s.trim()).join("|") === "connect-src 'self'");
check("Math.random は練習・とことんの種だけ（今日の5問・上級は日付の乱数。data.js には無い）", (html.match(/Math\.random/g) || []).length === 2 && !/Math\.random/.test(gen));
check("乱数は sort の比較の中で引かない（ブラウザで引く回数が変わる）", !/\.sort\(\s*\([^)]*\)\s*=>[^\n;]*\b(R|rng|rand|Math\.random)\s*\(/.test(html + gen));
{ const inl = html.split("<script>").slice(1).map((x) => x.split("</" + "script>")[0]).join("\n"); // index.html の中の script も見る（nemuri-kotsu#1 で行の途中に // を入れて画面が動かなくなった）
  check("一行の式の途中にコメント // を足さない（行の残りが消える。rosen-hitofude 2026-11-04・nemuri-kotsu#1）", !/;\s*\/\/[^\n]*;\s*\w/.test((gen + "\n" + inl).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n"))); }
check("言い方：「必ず」「絶対」と言い切らない（政令の例外もある）・画像を入れない", !/絶対に|必ず(当て|わか|見分|建て)/.test(html + gen + readme) && !/<img/.test(html));
{ const howto = (html.match(/<dialog id="howto"[\s\S]*?<\/dialog>/) || [""])[0], ab = (html.match(/function about\(\)[\s\S]*?\n}/) || [""])[0], dis = (t) => /代わりではありません/.test(t) && /国税庁の案内、専門家に確かめてください/.test(t) && /条文を、?短く(やさしく)?言いかえ/.test(t);
  check("言い方：遊び方・「このゲームについて」・README のどれにも、条文を言いかえた文であること・公式の情報の代わりではないこと・実際は国税庁の案内、専門家に確かめることがある", dis(howto) && dis(ab) && dis(readme), `遊び方 ${dis(howto)}・について ${dis(ab)}・README ${dis(readme)}`); }
check("写し元（行政の期限・地方自治の日数・国会の日数・借地・借家の期間・裁判の期限・会社の任期と期限・何年とっておく？・特許は何年？・免許は何歳から？・駐車禁止は何m？・届け出いつまで？・危険物の類あて・用途地域あて・岩石系統分け・SDGsの目標あて・震度よみ・憲法のしくみ）の言葉が残っていない（共通部品 store の中は除く・game-dev.md A 手順5）", !/岩石|ganseki|GNK|gnk|産総研|地質|gsj|火成|堆積|変成|SDG|ターゲット|仮訳|外務省|アジェンダ|震度|気象庁|解説表|地震|jma\\.go|shd|SHD|ようす帳|kps|KPS|用途地域|都市計画|建築基準|youto|yto|YTO|危険物|消防法|第何類|固体|液体|品名|kikenbutsu|kbr|KBR|届け出|市区町村|todokede|tdk|TDK|駐車|停車|chusha|ckr|CKR|場所帳|免許|menkyo|mkn|MKN|道路交通法|何歳|特許|商標|意匠|tokkyo|tkk|TKK|期間帳|期限帳|保存期間|hozon|hzk|HZK|カルテ|処方|会社の任期|会社帳|kaisha|ksk|KSK|取締役|監査役|株主|裁判の期限|saiban-kigen|sbk|SBK|刑事|民事|刑事訴訟|民事訴訟|逮捕|勾留|控訴|手続き帳|借地|借家|賃貸|shakuchi|sks|SKS|民法|国会|kokkai|kkn|KKN|衆議院|参議院|憲法|地方自治|chiho|chj|CHJ|自治帳|住民監査|議会|行政の期限|gyosei|gsk|GSK|行政帳|取消訴訟|情報公開|パブリックコメント|意見公募|情報の開示/.test(html.replace(/<!-- store:begin[\s\S]*?<!-- store:end -->/, "") + gen + readme));
// 遊び方・説明・まちがいの案内は、ゲームごとに手で書く所。写し元の文のまま残らないよう、このゲームのきまりの名前と期限の幅で書いてあるかを見る（2026-11-18 incidents/2026-11-18-game-copy-hand-written-text.md）
{ const names = Object.values(G.GROUPS).map((g) => g.name), rng = `${G.LEVELS[0]}〜${G.LEVELS[G.LEVELS.length - 1]}`;
  const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || "", bad = (html.match(/"✕ ちがいます。([^"]*)"/) || [])[1] || "";
  check("遊び方・説明・まちがいの案内が、このゲームのきまりの名前と期限の幅で書いてある（写し元の文が残っていない）", html.includes(`どのきまりか（${names.join("／")}）`) && html.includes(`その期限（${rng}）`) && desc.includes(`（${rng}）`) && names.every((n) => bad.includes(n)), `desc=${desc.slice(0, 40)} bad=${bad.slice(0, 40)}`); }
check("画面にお笑いの言葉を入れない（本物っぽく）", !/お笑い|ギャグ|ツッコミ|なんでやねん|（うそ）/.test(html + gen));
check("引き継ぎ：transfer.js をゲームの script より前に、このゲームの記録のキー（記録・文字・復習）だけで読む・depth.js も前に読む", /<script src="transfer\.js" data-game="zeimu-kigen" data-keys="zsk-v1,zsk-fs,zsk-depth"><\/script>\s*<script src="depth\.js" data-game="zeimu-kigen" data-key="zsk-depth"><\/script>\s*<\/head>/.test(html) && html.indexOf('src="transfer.js"') < html.indexOf('src="data.js"') && /data-hk/.test(html) && existsSync(path.join(root, "transfer.js")));
check("好きなだけ遊べる：チケット・回数の上限・🔒で開くモードを入れない（game-dev.md F1・F2）", !/🎫|チケット|すると開く|🔒/.test(html) && !/\blife\b|ELIFE/.test(html));
{ const og = (k) => (html.match(new RegExp(`<meta (?:property|name)="${k}" content="([^"]+)"`)) || [])[1] || "";
  const png = readFileSync(path.join(root, "og.png"));
  check("SNS で貼ると絵と題が出る（OGP・1200×630・絶対URL）", og("og:title") && og("og:description") && og("og:image") === "https://satou-aaaaa.github.io/zeimu-kigen/og.png" && og("twitter:card") === "summary_large_image" && png.readUInt32BE(16) === 1200 && png.readUInt32BE(20) === 630); }
{ const mk = readFileSync(path.join(root, "tools/make-og.cjs"), "utf8");
  check("SNS の絵に今日の問題と答えを出さない：問題の文・正解の印を make-og に書かない（CodeRabbit mansion-kimari#1）", !/line\([^)]*,\s*1\)/.test(mk) && G.KINDS.every((k) => !mk.includes(k.name) && [...Array(30)].every((_, j) => !mk.includes(G.make(`${k.id}|o${j}`).q.replace(/　(どれ|期間は)？$/, "")))));
}
{ const fy = readFileSync(path.join(root, ".github/ISSUE_TEMPLATE/feedback.yml"), "utf8");
  check("感想フォームの name が3字以上（2字だとフォームが出ない。shared-workflows incidents/2026-11-05-feedback-form-not-shown.md）", [...((fy.match(/^name:\s*(.+)$/m) || [])[1] || "").trim()].length >= 3);
  check("感想フォームは名前・メールを聞かない", /id: fun/.test(fy) && !/id: (name|email|mail)/.test(fy) && /labels: \["感想"\]/.test(fy));
  // 感想フォームの入力例と manifest の説明も手で書く所。写し元の文が残らないよう、このゲームの種類の名前と OGP の説明で書いてあるかを見る（2026-11-18 CodeRabbit kazoku-kigen#1）
  const ex = ((fy.split(/\n\s*- type:/).find((b) => /id: good\b/.test(b)) || "").match(/placeholder: (.+)/) || [])[1] || "", mfd = JSON.parse(readFileSync(path.join(root, "manifest.webmanifest"), "utf8")).description || "", ogd = (html.match(/<meta property="og:description" content="([^"]+)"/) || [])[1];
  check("感想フォームの入力例と manifest の説明が、このゲームの文で書いてある（写し元の文が残っていない）", G.KINDS.some((k) => ex.includes(k.name)) && mfd === ogd, `入力例=${ex}・説明=${mfd}`); }
check("README の URL のすぐ後ろに全角の字を続けない（Link check が URL の一部と読む）", !/https?:\/\/[\x21-\x7e]*[^\x00-\x7f]/.test(readme.replace(/\]\(https?:\/\/[^)\s]+\)/g, "").replace(/<https?:\/\/[^>\s]+>/g, "")));
{ const sw = readFileSync(path.join(root, "sw.js"), "utf8"), mf = JSON.parse(readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
  const shell = JSON.parse(sw.match(/SHELL = (\[[^\]]+\])/)[1]);
  check("PWA：sw.js は画面のファイルを全部保存し（引き継ぎの transfer.js・深さの depth.js も）、取り直して保存し、外へ何も送らない", ["./index.html", "./data.js", "./transfer.js", "./depth.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"].every((f) => shell.includes(f)) && /cache: "reload"/.test(sw) && !/https?:\/\//.test(sw.replace(/^\/\/.*$/gm, "")));
  { const st = await checkSwStall(sw); check("PWA：通信が止まっても4秒ほどで保存した画面に切り替わり、少しずつ届く受信は待ち、何も無ければ60秒で返す（shared-workflows template/qa/sw-check.mjs）", st.ok, JSON.stringify(st)); }
  check("PWA：manifest にアイコン2つと名前がある", mf.name === "税の期限" && mf.icons.length >= 2 && mf.start_url === "./"); }

// ---- 3. ブラウザで遊ぶ ----
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname), f = path.join(root, p === "/" ? "index.html" : p);
  if ((f !== root && !f.startsWith(root + path.sep)) || !existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); res.end(readFileSync(f));
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
const TODAY = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const dayBefore = (n) => new Date(Date.parse(TODAY) - n * 864e5).toISOString().slice(0, 10);
async function newPage(w = 390, ctx) {
  const c = ctx || await browser.newContext({ viewport: { width: w, height: 800 } });
  await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/ERR_FAILED|net::/.test(m.text())) errors.push(m.text()); });
  await p.goto(url); await p.waitForTimeout(200);
  return p;
}
const closeHow = async (p) => { await firstClose(p); };
const ansIdx = (p) => p.evaluate(() => { const c = __nm.cur(); return c.P.opts.indexOf(c.P.ans); });
const wrongIdx = (p) => p.evaluate(() => { const c = __nm.cur(); return c.P.opts.findIndex((o) => o !== c.P.ans && !c.wrong.includes(o)); });
const mem = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("zsk-v1") || "{}"));
// 2段目「どのきまり？」が出たら、正しい系統を押す
const why = async (p) => { await p.waitForSelector(".verdict, .why button"); if (await p.locator(".verdict").count()) return; await p.click(`.why button[data-g="${await p.evaluate(() => __nm.cur().P.grp)}"]`); };
async function solve(p, { wrong = 0 } = {}) {
  for (let i = 0; i < wrong; i++) await p.click(`.ch[data-j="${await wrongIdx(p)}"]`);
  await p.click(`.ch[data-j="${await ansIdx(p)}"]`);
  await why(p);
  await p.waitForSelector(".verdict");
}

try {
  // はじめて：遊び方が出る・文字の大きさ
  const p = await newPage();
  check("はじめて開くと遊び方が出る", await p.locator("#core-coach").waitFor({ timeout: 3000 }).then(() => true, () => false));
  { const c = await browser.newContext(); const r = await c.newPage(); await r.goto(url); await r.waitForTimeout(200); let again = 0;
    for (let i = 0; i < 10; i++) { await r.evaluate(() => localStorage.clear()); await r.reload(); await r.waitForTimeout(200); await r.keyboard.press("Escape"); await r.reload(); await r.waitForTimeout(200); again += await r.locator("#howto[open]").count(); }
    check("遊び方を Esc で閉じてすぐ読み直しても出ない（10回）", again === 0);
  { const c = await browser.newContext(); const r = await c.newPage(); const big = []; // 題が h1{flex:1} で縦に伸び（伸びない形と比べて4pxより高ければ失敗）、iPad の縦で大きなすき間が出た（shared-workflows incidents/2026-11-07-title-stretched.md）
    for (const [w, h] of [[820, 1180], [390, 844], [1280, 800]]) { await r.setViewportSize({ width: w, height: h }); await r.goto(url); await r.waitForTimeout(200); await r.keyboard.press("Escape"); await r.waitForTimeout(100);
      const v = await r.evaluate(() => { const e = [...document.querySelectorAll(".title")].find((x) => x.offsetParent); if (!e) return null; const h = e.getBoundingClientRect().height; const f = e.style.flex; e.style.flex = "none"; const n = e.getBoundingClientRect().height; e.style.flex = f; return h - n; });
      if (v === null || v > 4) big.push(`${w}x${h}:${v === null ? "題なし" : "+" + Math.round(v) + "px"}`); }
    check("ホームの題は縦長の画面でも縦に伸びない（820×1180・390×844・1280×800）", big.length === 0, big.join(" ")); await c.close(); }
    await r.evaluate(() => localStorage.clear()); await r.reload(); await r.waitForTimeout(200);
    check("はじめての練習が始まったその場で「見た」が残る", await r.evaluate(() => { return Object.keys(localStorage).some((k) => { try { return JSON.parse(localStorage.getItem(k)).tut === true; } catch { return false; } }); })); await firstClose(r);
    await r.reload(); await r.waitForTimeout(200); check("遊び方を「わかった」で閉じてすぐ読み直しても出ない（その場で残す）", await r.locator("#howto[open]").count() === 0); await c.close(); }
  await firstClose(p);
  check("文字の大きさ：はじめは「大きい」（19px）", await p.evaluate(() => getComputedStyle(document.documentElement).fontSize) === "19px");
  await p.click('.fsrow button[data-fs="3"]');
  await p.reload(); await p.waitForTimeout(150);
  check("文字の大きさ：「とても大きい」にすると開き直しても残る", await p.evaluate(() => getComputedStyle(document.documentElement).fontSize) === "23px" && await p.locator('.fsrow button[data-fs="3"][aria-pressed="true"]').count() === 1);
  await p.click('.fsrow button[data-fs="2"]');
  check("ホームに今日のきほんが出る", (await p.textContent("#tip")).includes("今日のきほん"));

  // 今日の5問：1問目はまちがえる、2問目はヒント2回、ほかはそのまま
  await p.click("#go-d");
  const tags = await p.evaluate(() => __nm.load().runs.d.list);
  check("今日の5問は日付から決まる（data.js の dailyTags と同じ）", JSON.stringify(tags) === JSON.stringify(G.dailyTags(TODAY)));
  check("問題の画面：場面の問いと、押せる行3つか4つ（高さ56px以上）", await p.locator("#card").count() === 1 && (await p.$$eval(".ch", (b) => b.map((x) => x.getBoundingClientRect().height))).every((h) => h >= 56) && await p.locator(".ch").count() === await p.evaluate(() => __nm.cur().P.opts.length) && await p.locator(".ch").count() >= 3 && (await p.textContent("#card .sit")).length > 5);
  check("押せる行には読み上げ用の名前がある", (await p.$$eval(".ch", (t) => t.filter((x) => !x.getAttribute("aria-label")).length)) === 0);
  await p.click(`.ch[data-j="${await wrongIdx(p)}"]`);
  check("まちがえると ✕ の印と「ちがう」の文字（色だけで分けない）・知らせは role=status", await p.locator(".ch.ng").count() === 1 && (await p.evaluate(() => getComputedStyle(document.querySelector(".ch.ng"), "::after").content)).includes("ちがう") && /✕/.test(await p.textContent("#msg")) && await p.getAttribute("#msg", "role") === "status");
  // 開き直しても、まちがえた選び肢は残る
  await p.reload(); await p.waitForTimeout(150); await p.click("#go-d");
  check("途中で閉じても続きから（同じ問題・まちがえた印のまま）", await p.locator(".ch.ng").count() === 1 && await p.evaluate(() => __nm.cur().i) === 0);
  await solve(p);
  check("正解すると「正解」の判・なぜの説明・出典のリンク・★2（まちがい1回）", await p.locator(".ch.ok").count() === 1 && /正解/.test(await p.evaluate(() => getComputedStyle(document.querySelector(".ch.ok"), "::after").content)) && (await p.textContent(".verdict .why")).length > 20 && await p.locator(".verdict .src a").count() >= 1 && (await p.getAttribute(".verdict .stars", "aria-label")) === "星2つ");
  await p.click("#next");
  await p.click("#hint");
  check("ヒント1は見るところを言う（答えは言わない）", (await p.textContent("#hintbox")).includes("💡") && await p.locator(".ch.ng").count() === 0);
  await p.click("#hint");
  check("ヒント2はまちがいを消して2つにしぼり、表の言葉も見せる・ヒントは2回まで", await p.locator(".ch:not(.ng)").count() === 2 && (await p.textContent("#hintbox")).includes(await p.evaluate(() => __nm.cur().P.key)) && await p.locator("#hint:disabled").count() === 1);
  await solve(p);
  check("ヒント2回は★1", (await p.getAttribute(".verdict .stars", "aria-label")) === "星1つ");
  await p.click("#next");
  check("次の問題へ進むと、フォーカスが問題（#card）に移る", await p.evaluate(() => document.activeElement && document.activeElement.id) === "card");
  for (let i = 2; i < 5; i++) { await solve(p); await p.click("#next"); }
  await p.waitForTimeout(150);
  const s1 = await mem(p);
  check("5問で結果：今日の記録に1問ごとのまちがい（1・2・0・0・0）", JSON.stringify(s1.days[TODAY]?.m) === "[1,2,0,0,0]");
  const share = await p.textContent(".share");
  check("シェアの文に答え・問題を出さない（印だけ）", /第\d+回/.test(share) && /🟢/.test(share) && !G.KINDS.some((k) => share.includes(k.name)) && !G.LEVELS.some((o) => share.includes(o.replace(/（.*/, ""))), share);
  check("まちがいのある日は Ko-fi の一言を出さない", await p.locator(".kofi").count() === 0);
  check("結果に「あと少しの実績」と、続けて遊ぶ・上級のボタン", await p.locator("#achnext").count() === 1 && await p.locator("#go-e").count() === 1 && await p.locator("#go-h").count() === 1);
  check("見抜き帳に解いた種類が載る", Object.keys(s1.dex).length === 5);
  await p.click("#back");
  check("今日を終えたら、ホームは「今日の結果を見る」と上級", (await p.textContent("#go-d")).includes("結果") && await p.locator("#go-h").count() === 1);
  // 上級：ヒントなし・3問
  await p.click("#go-h");
  check("上級はヒントのボタンが無い・3問", await p.locator("#hint").count() === 0 && (await p.evaluate(() => __nm.load().runs.h.list.length)) === 3);
  for (let i = 0; i < 3; i++) { await solve(p); await p.click("#next"); }
  await p.waitForTimeout(150);
  check("上級の記録は hdays に入る", (await mem(p)).hdays[TODAY]?.m.length === 3);
  // 練習：記録を増やさない
  await p.click("#back"); await p.click("#go-p"); await p.click('.lv button[data-t="2"]');
  const before = await mem(p);
  for (let i = 0; i < 5; i++) { await solve(p); await p.click("#next"); }
  await p.waitForTimeout(150);
  const after = await mem(p);
  check("練習は今日の記録を増やさない（見抜き帳の数はふえる）", JSON.stringify(after.days) === JSON.stringify(before.days) && Object.values(after.dex).reduce((a, b) => a + b) === Object.values(before.dex).reduce((a, b) => a + b) + 5);
  // 見抜き帳からその手口だけで練習
  await p.click("#back"); await p.click("#go-dex");
  const firstKind = await p.getAttribute(".book button", "data-k");
  await p.click(".book button");
  check("見抜き帳の手口を押すと、その手口だけで練習", (await p.evaluate(() => __nm.load().runs.p.list)).every((t) => t.startsWith(firstKind + "|")));
  // とことん：まちがえてもヒントを使っても続き、「ここで降りる」で終わる（game-dev.md F1）
  await p.click("#back"); await p.click("#go-e");
  check("とことんは60問の並びから・ライフ（🌸・🎫）が無い", (await p.evaluate(() => __nm.load().runs.e.list.length)) === 60 && !("life" in await p.evaluate(() => __nm.load().runs.e)) && await p.locator("#quit").count() === 1);
  await solve(p); await p.click("#next"); await solve(p); await p.click("#next");
  await solve(p, { wrong: 1 }); await p.click("#next");
  await p.click("#hint"); await p.click("#hint"); await solve(p); await p.click("#next");
  check("とことんはまちがい・ヒント2回でも終わらない", await p.locator(".ch").count() >= 3 && await p.evaluate(() => __nm.load().runs.e.res.length) === 4);
  await p.click("#hint"); await p.click("#hint");
  await p.evaluate(() => { const c = __nm.cur(); [...document.querySelectorAll(".ch:not(.ng)")].find((b) => c.P.opts[+b.dataset.j] !== c.P.ans).click(); });
  await p.waitForTimeout(50);
  check("ヒント2のあとにまちがいを選ぶと、正解だけが押せる（saibanin-shikumi #1）", await p.locator(".ch.ng").count() === await p.evaluate(() => __nm.cur().P.opts.length) - 1 && await p.locator(".ch:not(.ng)").count() === 1 && await p.evaluate(() => { const c = __nm.cur(); const b = document.querySelector(".ch:not(.ng)"); return !!b && !b.disabled && c.P.opts[+b.dataset.j] === c.P.ans; }));
  await p.reload(); await p.waitForTimeout(200);
  check("とことんは閉じても続きから", (await p.textContent("#go-e")).includes("続きから"));
  await p.click("#go-e");
  {
    // 別のタブでこの回を終えて新しい回を始めていたら、古い画面の「ここで降りる」は新しい回を終えない（funka-level #1 の CodeRabbit）
    const keep0 = await p.evaluate(() => __nm.load().runs.e);
    await p.evaluate(() => __nm.save((s) => { s.runs.e = Object.assign({}, s.runs.e, { id: "other-tab-run", res: [] }); }));
    await p.click("#quit"); await p.waitForTimeout(150);
    check("古い画面の「ここで降りる」は、別のタブで始めた新しい回を終えない", (await p.evaluate(() => __nm.load().runs.e && __nm.load().runs.e.id)) === "other-tab-run");
    await p.evaluate((r) => __nm.save((s) => { s.runs.e = r; }), keep0);
    await p.evaluate(() => __nm.play("e"));
  }
  await p.click("#quit"); await p.waitForTimeout(150);
  check("「ここで降りる」で終わり、一度で見抜いた数（2問）が自己ベストに残る", (await mem(p)).ebest === 2 && (await p.textContent("#eres")).includes("4問") && !("e" in (await mem(p)).runs && (await mem(p)).runs.e));
  {
    // とことんの並びを何百回作って、1回の中で同じ問題が無い・続けて同じ種類が無い・足しても重ならない
    const r = await p.evaluate(() => { const K = __nm.G, bad = []; for (let n = 0; n < 300; n++) { const l = __nm.endlessList(), more = l.concat(__nm.moreList(l)); const ks = more.map((t) => K.keyOf(K.make(t))); if (new Set(ks).size !== ks.length) bad.push("重なり"); if (more.some((t, i) => i && t.split("|")[0] === more[i - 1].split("|")[0])) bad.push("同じ種類が続く"); if (l.length !== 60 || more.length !== 100) bad.push("数" + l.length + "/" + more.length); } return bad; });
    check("とことんの並び300回：60問＋足した40問で同じ問題も同じ種類の連続も無い（game-dev.md F6）", r.length === 0, r.slice(0, 3).join(","));
  }
  {
    // 引き継ぎコードなどで数の所に文字が入っても、画面に HTML として出さない（2026-11-05 CodeRabbit）
    const q = await newPage(); await closeHow(q);
    await q.evaluate(() => { const s = JSON.parse(localStorage.getItem("zsk-v1")) || { v: 1 }; s.ebest = '<img id="xss" src=x>'; s.dex = { e: '"><b id="xss2">' }; s.runs = { e: { mode: "e", id: '"><i id="xss3">', date: "2026-11-07", list: ["sozoku|1"], res: [] }, h: { list: "bad", res: [] }, p: { mode: "p", id: "y", date: "2026-11-07", list: ["constructor|1"], res: [] }, d: { mode: "d", id: "z", date: "x", list: ["sozoku|1"], res: [] }, "a:2026-11-06": { mode: "a", id: "a1", date: "2026-11-06", list: ["sozoku|1"], res: [null] }, "a:2026-11-05": { mode: "a", id: "a2", date: "2026-11-05", list: "bad", res: [] }, "a:2026-11-04": { mode: "a", id: "a3", date: "2026-11-04", list: ["sozoku|1", "sozoku|2"], res: [{ m: 0 }], cur: { i: 1, tag: "sozoku|2", wrong: "x", hints: 0 } } }; s.days = { "2026-11-07": { m: "x" }, bad: { m: [0] }, "2026-02-30": { m: [0] } }; localStorage.setItem("zsk-v1", JSON.stringify(s)); });
    await q.reload(); await q.waitForTimeout(250);
    const st = await q.evaluate(() => __nm.load());
    check("記録の形を直す：数の所の文字は0に・形のちがう途中経過と日ごとの記録は捨てる", st.ebest === 0 && st.dex.e === 0 && st.runs.e && !("h" in st.runs) && !("p" in st.runs) && !("d" in st.runs) && !("a:2026-11-06" in st.runs) && !("a:2026-11-05" in st.runs) && st.runs["a:2026-11-04"] && st.runs["a:2026-11-04"].cur === null && Object.keys(st.days).length === 0);
    await q.click("#go-e").catch(() => {}); await q.waitForTimeout(150);
    {
      // 知らない mode や、置き場とちがう mode の途中経過は捨てる（ホームが出なくなるのを防ぐ。2026-11-07 CodeRabbit）
      const z = await newPage(); await closeHow(z);
      await z.evaluate(() => { const s = JSON.parse(localStorage.getItem("zsk-v1")) || { v: 1 }; s.v = 1; s.runs = { d: { mode: "x", date: "2026-11-07", list: [], res: [] }, h: { mode: "d", date: "2026-11-07", list: [], res: [] } }; localStorage.setItem("zsk-v1", JSON.stringify(s)); });
      await z.reload(); await z.waitForTimeout(200);
      const r = await z.evaluate(() => __nm.load().runs);
      check("知らない mode の途中経過は捨て、ホームが出る", !("d" in r) && !("h" in r) && await z.locator("#go-d").count() === 1);
      // 別のタブで終えたまま記録していない上級の回は、次の回を始める前に記録する
      await z.evaluate(() => { const s = __nm.load(), y = "2026-11-06", G = __nm.G; s.runs.h = { mode: "h", date: y, list: G.hardTags(y), res: [{ m: 0 }, { m: 0 }, { m: 0 }], cur: null, id: "old" }; localStorage.setItem("zsk-v1", JSON.stringify(s)); });
      await z.reload(); await z.waitForTimeout(200); await z.evaluate(() => __nm.start("h"));
      check("終えたまま残った前の日の回は、上書きする前に記録する", !!(await mem(z)).hdays["2026-11-06"]);
      // とことんで足せる問題が無くても、くり返し呼んで固まらない
      const ok = await z.evaluate(() => { const s = __nm.load(); s.runs.e = { mode: "e", date: __nm.todayKey(), list: ["sozoku|1", "hojin|1"], res: [{ m: 0 }, { m: 0 }], cur: null, id: "e1" }; localStorage.setItem("zsk-v1", JSON.stringify(s)); const ml = __nm.setMore(() => []); try { __nm.play("e"); return true; } catch (e) { return String(e); } finally { __nm.setMore(ml); } });
      check("とことんで足せる問題が無くても固まらずに終える", ok === true && await z.locator("#eres").count() === 1, String(ok));
      await z.context().close();
    }
    check("記録の文字を HTML として出さない", await q.locator("#xss, #xss2, #xss3").count() === 0);
    await q.context().close();
  }
  // 実績・このゲームについて
  await p.click("#back"); await p.click("#go-ach");
  check("実績は13個で、腕前・集める・続けるの3つの組", await p.locator(".ach").count() === 13 && await p.locator(".agrp").count() === 3 && await p.locator(".ach.got").count() >= 3);
  check("達成した実績は ✓ の文字も付く（色だけで分けない）", (await p.textContent(".ach.got b")).startsWith("✓"));
  await p.click("#back"); await p.click("#f-about");
  check("このゲームについて：公式の情報の代わりではないこと・出典・本当の情報を見る所", (await p.textContent("#about")).includes("代わりではありません") && await p.locator("#about a").count() >= 4);
  await p.context().close();

  // まちがいなしの日は Ko-fi を1回だけ
  {
    const q = await newPage(); await closeHow(q); await q.click("#go-d");
    for (let i = 0; i < 5; i++) { await solve(q); await q.click("#next"); }
    await q.waitForTimeout(150);
    check("全部まちがいなしで初めて終えたときだけ Ko-fi の一言", await q.locator(".kofi").count() === 1 && (await q.textContent(".big")).includes("まちがいなし"));
    await q.click("#back"); await q.click("#go-d");
    check("結果をもう一度見ても Ko-fi は出さない", await q.locator(".kofi").count() === 0);
    await q.context().close();
  }

  // カレンダー・あとから：過去の日の記録を置いて見る。第1回から日がたっていなくても見られるよう、時計を10日進める
  {
    const SHIFT = 10 * 864e5, TODAY = new Date(Date.now() + 9 * 3600e3 + SHIFT).toISOString().slice(0, 10), dayBefore = (n) => new Date(Date.parse(TODAY) - n * 864e5).toISOString().slice(0, 10);
    const cx = await browser.newContext({ viewport: { width: 390, height: 800 } });
    await cx.addInitScript((sh) => { const o = Date.now; Date.now = () => o() + sh; }, SHIFT);
    const q = await newPage(390, cx);
    await q.evaluate(([d2, d3]) => { localStorage.setItem("zsk-v1", JSON.stringify({ v: 1, tut: true, days: { [d2]: { m: [0, 0, 0, 0, 0], k: [] }, [d3]: { m: [1, 0, 0, 2, 0], k: [] } }, hdays: {}, adays: {}, dex: {}, runs: {}, kofi: {}, ach: {}, ebest: 0 })); }, [dayBefore(2), dayBefore(3)]);
    await q.reload(); await q.waitForTimeout(150);
    check("ホームの「続けて」は、きのうを休んだら — （休んだ日を責めない）", (await q.textContent(".stats")).includes("—"));
    await q.click("#go-cal");
    const lateList = await q.evaluate(() => __nm.lateDays(__nm.load()));
    const exp = [1, 4, 5, 6, 7].map(dayBefore).filter((d) => d >= "2026-11-07");
    check("カレンダー：取りこぼした過去7日（第1回より後）を押せる", JSON.stringify(lateList) === JSON.stringify(exp), lateList.join(","));
    check("カレンダー：遊んだ日は★の数の文字も付く", (await q.locator(".cal .c.p3").count()) + (await q.locator(".cal .c.p2").count()) + (await q.locator(".cal .c.p1").count()) >= (dayBefore(3).slice(0, 7) === TODAY.slice(0, 7) ? 2 : 0));
    if (lateList.length) {
      const d = lateList[0];
      await q.evaluate((d) => { const b = document.querySelector(`.cal .miss[data-k="${d}"]`); if (b) b.click(); else { const m = document.querySelector(".calnav #prev"); m && m.click(); } }, d);
      if (!(await q.locator(".ch").count())) await q.click(`.cal .miss[data-k="${d}"]`);
      check("あとから：その日の今日の5問と同じ問題", JSON.stringify(await q.evaluate((d) => __nm.load().runs["a:" + d].list, d)) === JSON.stringify(G.dailyTags(d)));
      for (let i = 0; i < 5; i++) { await solve(q); await q.click("#next"); }
      await q.waitForTimeout(150);
      const s = await mem(q);
      check("あとからは adays に入り、今日の記録・続けた日には数えない", s.adays[d] && !s.days[d] && (await q.locator(".share").count()) === 0 && (await q.locator(".kofi").count()) === 0);
    } else check("あとから：遊べる日がある", false, "第1回の日から日がたっていない");
    await q.context().close();
  }

  // 終えた回（gone）がある側の保存に失敗し、別のタブが古い回を新しく保存しても、終えた回を戻さない（menkyo-nenrei PR #1 の CodeRabbit）
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
    const g = await newPage(390, ctx);
    const left = await g.evaluate(() => {
      const r = { mode: "e", date: __nm.todayKey(), list: ["sozoku|1", "hojin|1"], res: [{ m: 0 }], cur: null, id: "gone1" };
      const base = __nm.load();
      const a = JSON.parse(JSON.stringify(base)); a.runs.e = null; a.gone = { gone1: 1 }; a.t = 100;
      const b = JSON.parse(JSON.stringify(base)); b.runs.e = r; b.t = 200;
      localStorage.setItem("zsk-v1", JSON.stringify(b)); __nm.setMem(JSON.stringify(a));
      try { return __nm.load().runs.e; } finally { __nm.setMem(null); }
    });
    check("終えた回は、別のタブが新しく保存した古い写しから戻さない", !left, JSON.stringify(left));
    await ctx.close();
  }
  // 同じ問題の途中で、保存に失敗した側と保存できた側のまちがいを合わせる（CodeRabbit menkyo-nenrei#1）
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
    const g = await newPage(390, ctx);
    const got = await g.evaluate(() => {
      const base = __nm.load(), mk = (w, w2) => ({ mode: "p", date: __nm.todayKey(), list: ["sozoku|m1", "hojin|m1"], res: [], cur: { i: 0, tag: "sozoku|m1", wrong: w, hints: 0, step: 2, w2 }, id: "mg1" });
      const a = JSON.parse(JSON.stringify(base)); a.runs.p = mk(["4か月"], ["naosu"]); a.t = 100;
      const b = JSON.parse(JSON.stringify(base)); b.runs.p = mk(["1年"], ["kurikoshi"]); b.t = 200;
      localStorage.setItem("zsk-v1", JSON.stringify(b)); __nm.setMem(JSON.stringify(a));
      try { return __nm.load().runs.p.cur; } finally { __nm.setMem(null); }
    });
    check("同じ問題の途中なら、保存に失敗した側のまちがい（1段目・2段目）も消さずに合わせる", got && got.wrong.includes("4か月") && got.wrong.includes("1年") && got.w2.includes("naosu") && got.w2.includes("kurikoshi"), JSON.stringify(got));
    const n = await g.evaluate(() => { __nm.save((s) => { s.runs.p = { mode: "p", date: __nm.todayKey(), list: ["sozoku|s1", "hojin|s1"], res: [], cur: null, id: "sc1" }; }); __nm.play("p"); __nm.sureCount(true); __nm.sureCount(true); return __nm.load().runs.p.ds; });
    check("「自信あり」の数は1問につき1回だけ（2つのタブで同じ問題を当てても2回足さない）", n && n.n === 1 && n.ok === 1, JSON.stringify(n));
    await ctx.close();
  }

  // 古いタブ：同じ問題を2つのタブで開き、片方で答えたら、もう片方は二重に入れない
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
    const a = await newPage(390, ctx); await closeHow(a); await a.click("#go-d");
    const b = await ctx.newPage(); b.on("pageerror", (e) => errors.push(e.message)); await b.goto(url); await b.waitForTimeout(150); await b.click("#go-d");
    await solve(a);
    await b.click(`.ch[data-j="${await ansIdx(b)}"]`);
    await b.waitForTimeout(200);
    const s = await mem(a);
    check("古いタブで同じ問題に答えても二重に数えない", s.runs.d.res.length === 1 && Object.values(s.dex).reduce((x, y) => x + y) === 1);
    // ヒントの数は、別のタブで使った分も減らさない
    await a.click("#next"); await b.goto(url); await b.waitForTimeout(150); await b.click("#go-d");
    await a.click("#hint"); await a.click("#hint");
    await b.click("#hint");
    check("別のタブで使ったヒントの数を減らさない", (await mem(a)).runs.d.cur.hints === 2);
    // 正解した時も、別のタブで使ったヒントを合わせて★を数える（2026-11-07 CodeRabbit）
    await b.click(`.ch[data-j="${await ansIdx(b)}"]`); await why(b); await b.waitForTimeout(150);
    check("正解の時も別のタブのヒントを合わせて数える（★1）", (await mem(b)).runs.d.res[1].m === 2);
    await ctx.close();
  }

  // 1問を深くする（shared-workflows routines/game-dev.md「1問を深くする」）：自信をかける・2段目「どのきまり？」・復習
  {
    const q = await newPage(); await closeHow(q);
    await q.evaluate((tags) => __nm.save((s) => { s.runs.p = { mode: "p", date: __nm.todayKey(), list: tags, res: [], cur: null, id: "dp" }; }), ["sozoku|dp1", "hojin|dp2", "kosei|dp3"]);
    await q.evaluate(() => { Depth.runStart(); __nm.play("p"); });
    const sb = await q.$eval("#dp-sure", (b) => [b.getBoundingClientRect().height, b.getAttribute("aria-pressed"), b.textContent]);
    check("自信のボタン：高さ44px以上・はじめは押していない", sb[0] >= 44 && sb[1] === "false", sb.join(","));
    await q.click("#dp-sure");
    check("自信のボタンを押すと ✓ が出る（色だけで分けない）", (await q.getAttribute("#dp-sure", "aria-pressed")) === "true" && (await q.textContent("#dp-sure")).includes("✓"));
    await q.click(`.ch[data-j="${await wrongIdx(q)}"]`);
    check("自信ありでまちがえると、知らせに「思いこみ」と出て、自信は変えられない", (await q.textContent("#msg")).includes("思いこみ") && await q.locator("#dp-sure:disabled").count() === 1);
    check("まちがえたその時に復習へ入る（解き終えずにやめても残る。2026-11-11 CodeRabbit）", await q.evaluate(() => { const d = JSON.parse(localStorage.getItem("zsk-depth") || "{}"); return !!(d.rv && d.rv[__nm.cur().tag]); }));
    await q.click(`.ch[data-j="${await ansIdx(q)}"]`);
    check("正解すると、2段目「どのきまり？」が3つ出る（押せる所は44px以上）", await q.locator(".why button").count() === 3 && await q.locator(".verdict").count() === 0 && (await q.$$eval(".why button", (b) => b.every((x) => Math.round(x.getBoundingClientRect().height) >= 44))));
    check("2段目の読み上げは、2段目の問いと3つの系統だけ（1段目の選び肢を読まない。funka-level #1 の CodeRabbit）", await q.evaluate(() => { const e = [...document.querySelectorAll("[data-a11y-say]")]; return e.length === 4 && e[0].textContent.includes("どのきまり？") && e.slice(1).every((x) => x.matches(".why button")); }));
    check("2段目の間は、1段目の選び肢は押せない", await q.evaluate(() => [...document.querySelectorAll(".ch")].every((b) => b.disabled)));
    await q.reload(); await q.waitForTimeout(150); await q.evaluate(() => __nm.play("p"));
    check("2段目の途中で閉じても、2段目から続く", await q.locator(".why button").count() === 3);
    const wg = await q.evaluate(() => Object.keys(__nm.G.GROUPS).find((x) => x !== __nm.cur().P.grp));
    await q.click(`.why button[data-g="${wg}"]`);
    check("2段目でまちがえると ✕ ちがう（破線）・もう一度選べる", await q.locator(".why button.ng").count() === 1 && (await q.textContent("#msg")).includes("✕"));
    { const m = await q.textContent("#msg"); check("2段目でまちがえると、このゲームの3つのきまりの見分け方が出る", Object.values(G.GROUPS).every((g) => m.includes(g.name)), m); }
    await q.click("#hint");
    const ng1 = await q.locator(".why button:disabled").count();
    check("2段目のヒントは、まちがえた系統とは別のちがう系統を消す（★を使って何も消えないことが無い。2026-11-11 CodeRabbit）", ng1 === 2 && await q.locator(".why button:not(:disabled)").count() === 1, ng1);
    await q.reload(); await q.waitForTimeout(150); await q.evaluate(() => __nm.play("p"));
    check("2段目のヒントで消した系統は、閉じて開き直しても消えたまま（ヒントも押せないまま）", await q.locator(".why button:disabled").count() === ng1 && ng1 >= 1 && await q.locator("#hint:disabled").count() === 1 && (await q.textContent("#hintbox")).includes("消しました"));
    await why(q); await q.waitForSelector(".verdict");
    const m0 = await q.evaluate(() => __nm.load().runs.p.res[0].m);
    check("★は1段目と2段目のまちがい・ヒントを合わせて数える（1＋1＋1＝3）", m0 === 3, m0);
    check("見抜いた画面に、系統と、自信ありでまちがえたことが出る", (await q.textContent(".verdict")).includes(G.GROUPS[G.make("sozoku|dp1").grp].name) && (await q.textContent(".verdict")).includes("自信ありでまちがえた"));
    await q.click("#next");
    await q.click(`.ch[data-j="${await ansIdx(q)}"]`); await why(q); await q.click("#next");
    await q.click(`.ch[data-j="${await ansIdx(q)}"]`);
    check("どの種類の問題も2段目「どのきまり？」が出る", await q.locator(".why button").count() === 3);
    await why(q); await q.waitForSelector(".verdict");
    await q.click("#next"); await q.waitForTimeout(150);
    check("終えた直後の結果に「自信ありの当たり」が出る", (await q.textContent("#surestat")).includes("0/1"));
    const dp = await q.evaluate(() => JSON.parse(localStorage.getItem("zsk-depth") || "{}"));
    check("まちがえた・ヒントを使った問題だけ復習に入る", Object.keys(dp.rv || {}).join() === "sozoku|dp1", Object.keys(dp.rv || {}).join(","));
    await q.evaluate(() => { const d = JSON.parse(localStorage.getItem("zsk-depth")); for (const k in d.rv) d.rv[k].due = "2026-01-01"; localStorage.setItem("zsk-depth", JSON.stringify(d)); });
    await q.goto(url); await q.waitForTimeout(150);
    check("日の来た復習があると、ホームに「復習 1問」", (await q.textContent("#go-r")).includes("復習 1問"));
    const before = await mem(q);
    await q.click("#go-r");
    check("復習の画面は「復習」と出る・同じ問題", (await q.textContent("header")).includes("復習") && await q.evaluate(() => __nm.cur().tag) === "sozoku|dp1");
    await solve(q); await q.click("#next"); await q.waitForTimeout(150);
    const after = await mem(q), dp2 = await q.evaluate(() => JSON.parse(localStorage.getItem("zsk-depth")));
    check("復習を終えると結果は「復習」・今日の記録は増えない・シェアは出ない", (await q.textContent("h1")).includes("復習") && JSON.stringify(after.days) === JSON.stringify(before.days) && await q.locator("#share").count() === 0);
    check("復習で一度で正解すると、次は3日後へ進む", Object.values(dp2.rv).every((x) => x.s === 1 && x.due > TODAY));
    await q.goto(url); await q.waitForTimeout(150);
    check("復習を終えたら、ホームの「復習」は消える", await q.locator("#go-r").count() === 0);
    await q.evaluate(() => { const d = JSON.parse(localStorage.getItem("zsk-depth")); d.rv["nai|1"] = { s: 0, due: "2026-01-01", t: 1 }; d.rv["constructor|x"] = { s: 0, due: "2026-01-01", t: 2 }; localStorage.setItem("zsk-depth", JSON.stringify(d)); });
    await q.goto(url); await q.waitForTimeout(150);
    check("作り直せない鍵（無い種類・constructor）は復習に数えず、ホームも出る", await q.locator("#go-d").count() === 1 && await q.locator("#go-r").count() === 0);
    // 別のタブで2段目へ進んでいたら、この画面も2段目になる・別のタブで先に進んだ古い画面は復習の段を戻さない（2026-11-11 CodeRabbit）
    { const tq = "sozoku|dq1";
      await q.goto(url); await q.waitForTimeout(150);
      await q.evaluate((t) => { __nm.save((s) => { s.runs.p = { mode: "p", date: __nm.todayKey(), list: [t], res: [], cur: null, id: "dq" }; }); __nm.play("p"); }, tq);
      await q.evaluate((t) => __nm.save((s) => { s.runs.p.cur = { i: 0, tag: t, wrong: [], hints: 0, step: 2, w2: [] }; }), tq);
      await q.click("#hint"); await q.waitForTimeout(100);
      check("別のタブで2段目へ進んでいたら、この画面も2段目になる", await q.locator(".why button").count() === 3 && await q.evaluate(() => __nm.cur().step) === 2);
      await q.evaluate((t) => { __nm.save((s) => { s.runs.p.res.push({ m: 0 }); s.runs.p.cur = null; }); const d = JSON.parse(localStorage.getItem("zsk-depth")); d.rv[t] = { s: 2, due: "2099-01-01", t: 9 }; localStorage.setItem("zsk-depth", JSON.stringify(d)); }, tq);
      await q.click("#hint"); await q.waitForTimeout(50);
      check("別のタブで先に進んだ古い画面でヒントを押しても、復習の段は戻らない", await q.evaluate((t) => JSON.parse(localStorage.getItem("zsk-depth")).rv[t].s, tq) === 2);
    }
    // 復習の途中でヒント・まちがいがあって日の来た問題が0になっても、ホームの「復習の続きから」で戻れる（2026-11-11 CodeRabbit）
    { const rk = Object.keys(dp2.rv)[0];
      await q.evaluate((k) => { const d = JSON.parse(localStorage.getItem("zsk-depth")); d.rv = { [k]: { s: 0, due: "2026-01-01", t: 3 } }; localStorage.setItem("zsk-depth", JSON.stringify(d)); }, rk);
      await q.goto(url); await q.waitForTimeout(150); await q.click("#go-r"); await q.click("#hint");
      await q.evaluate(() => __nm.save((s) => { s.runs.r.date = "2026-01-02"; }));
      await q.goto(url); await q.waitForTimeout(150);
      check("復習の途中でヒントを使って日の来た問題が0になっても・日が替わっても、ホームの「復習の続きから」で戻れる", ((await q.locator("#go-r").count()) ? await q.textContent("#go-r") : "").includes("続きから"));
      if (await q.locator("#go-r").count()) { await q.click("#go-r"); check("復習の続きは同じ問題・使ったヒントはそのまま", await q.evaluate(() => __nm.cur().tag) === rk && await q.evaluate(() => __nm.cur().hints) === 1); }
    }
    await q.context().close();
  }
  // スマホ幅・とても大きい文字でもはみ出さない・押す所は44px以上
  {
    const bad = [], small = [];
    for (const [w, fs] of [[320, 3], [390, 2], [320, 1]]) {
      const q = await newPage(w); await closeHow(q);
      await q.evaluate((fs) => localStorage.setItem("zsk-fs", String(fs)), fs); await q.reload(); await q.waitForTimeout(150);
      for (const go of [null, "#go-d", "solve", "#go-cal", "#go-dex", "#go-ach", "#go-e"]) {
        if (go === "solve") { await solve(q); }
        else if (go) { await q.goto(url); await q.waitForTimeout(100); await q.click(go); }
        await q.waitForTimeout(100);
        const ov = await q.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (ov > 0) bad.push(`${w}px 文字${fs} ${go || "ホーム"} ${ov}px`);
        small.push(...(await q.$$eval("button:not([disabled]), a[href]", (bs) => bs.filter((b) => b.checkVisibility() && !b.closest(".cal")).filter((b) => Math.round(b.getBoundingClientRect().height) < 44).map((b) => (b.id || b.className || b.textContent).slice(0, 20)))).map((x) => `${w}/${fs}/${go}:${x}`));
      }
      await q.context().close();
    }
    check("幅320px・とても大きい文字でも横にはみ出さない", bad.length === 0, bad.join(" / "));
    check("押せる所は高さ44px以上", small.length === 0, [...new Set(small)].slice(0, 8).join(","));
  }

  // 見やすさの設定を全部入れても、ページの一番下まで動ける（読み上げの class が html に当たって固まった。2026-11-05）
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 700 } });
    await ctx.addInitScript(() => localStorage.setItem("a11y-v1", JSON.stringify({ read: true, cvd: true, calm: true, say: true, ruby: true })));
    const q = await newPage(390, ctx); await closeHow(q);
    const r = await q.evaluate(() => { window.scrollTo(0, 1e5); const f = document.querySelector("footer").getBoundingClientRect(); return [scrollY, Math.round(f.bottom), innerHeight, getComputedStyle(document.documentElement).position]; });
    check("見やすさの設定を全部入れても、いちばん下まで動ける（html が固定されない）", r[0] > 0 && r[1] <= r[2] && r[3] === "static", r.join(","));
    await ctx.close();
  }
  // キーボードだけで遊べる（Tab と Enter）
  {
    const q = await newPage(); await closeHow(q);
    await q.focus("#go-d"); await q.keyboard.press("Enter"); await q.waitForTimeout(100);
    const j = await ansIdx(q);
    await q.focus(`.ch[data-j="${j}"]`); await q.keyboard.press("Enter"); await q.waitForTimeout(100);
    if (await q.locator(".why button").count()) { await q.focus(`.why button[data-g="${await q.evaluate(() => __nm.cur().P.grp)}"]`); await q.keyboard.press("Enter"); await q.waitForTimeout(100); }
    check("キーボードだけで選んで答えられる（2段目もキーボードで）", await q.locator(".verdict").count() === 1);
    await q.context().close();
  }
} catch (e) { check("ブラウザでの検査が最後まで動く", false, e.stack.split("\n").slice(0, 3).join(" ")); }

// 深さの部品（shared-workflows template/qa/depth-check.mjs）
{ const e = await checkDepth(readFileSync(path.join(root, "depth.js"), "utf8")); check("depth.js（自信をかける・復習）の動き", e.length === 0, e.join(" / ")); }
// 2段目の系統：どの種類にもある（3つのどれか）
{ const q = await newPage(); await closeHow(q);
  check("保存に失敗したら、保存できるまで帯（#savewarn）で知らせ続け、保存できたら消す", await q.evaluate(async () => { const orig = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new Error("full"); }; __nm.save(() => {}); __nm.save(() => {}); const one = document.querySelectorAll("#savewarn").length === 1 && document.getElementById("savewarn").textContent.includes("保存できませんでした"); await new Promise((r) => setTimeout(r, 1500)); const stay = !!document.getElementById("savewarn"); Storage.prototype.setItem = orig; __nm.save(() => {}); return one && stay && !document.getElementById("savewarn"); }));
  await q.evaluate(() => __nm.start("e")); await q.waitForTimeout(100);
  await q.click(`.ch[data-j="${await ansIdx(q)}"]`); await why(q); await q.waitForSelector(".verdict");
  await q.click("#quit"); await q.waitForTimeout(150);
  check("とことんで正解した直後でも「ここで降りる」が効き、その問題も数える", (await q.textContent("#eres")).includes("1問"), await q.textContent("body"));
  // 保存に失敗したまま「ここで降りる」を押しても、保存してあった途中の回を戻さない（CodeRabbit kumo-namae#1）
  await q.evaluate(() => __nm.start("e")); await q.waitForTimeout(100);
  await q.click(`.ch[data-j="${await ansIdx(q)}"]`); await why(q); await q.waitForSelector(".verdict");
  { const eid = await q.evaluate(() => __nm.load().runs.e.id);
    await q.evaluate(() => { window.__origSet = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new Error("full"); }; });
    await q.click("#quit"); await q.waitForTimeout(150);
    const back = await q.evaluate(() => { const r = __nm.load().runs.e; return r ? r.id : null; });
    await q.evaluate(() => { Storage.prototype.setItem = window.__origSet; __nm.save(() => {}); });
    check("保存に失敗したまま「ここで降りる」を押しても、終えた回が「とことんの続き」に戻らない", back === null && (await q.evaluate(() => __nm.load().runs.e)) === null, `${eid} → ${back}`); }
  await q.close(); }
{ const q = await newPage(); await closeHow(q);
  await q.evaluate(() => { localStorage.setItem("zsk-v1", JSON.stringify({ v: 1, tut: true, days: {}, hdays: {}, adays: {}, dex: { constructor: 1, toString: 2, "sozoku": 1 }, runs: {}, kofi: {}, ach: {}, ebest: 0 })); }); await q.reload(); await q.waitForTimeout(150);
  check("記録に constructor などの鍵が入っても、税の帳と実績の種類に数えない（CodeRabbit funka-level#1）", (await q.textContent("#go-dex")).includes(`1/${G.KINDS.length}`) && await q.evaluate(() => __nm.tally(__nm.load()).kinds) === 1, await q.textContent("#go-dex"));
  await q.close(); }
{ const bad = G.KINDS.filter((k) => { for (let i = 0; i < 200; i++) if (!G.GROUPS[G.make(`${k.id}|g${i}`).grp]) return true; return false; }).map((k) => k.id), used = new Set(G.KINDS.map((k) => k.grp));
  check("2段目「どのきまり？」：どの種類の問題も3つ（申告の期限／直す・不服／繰越し・さかのぼり）のどれかで、3つとも使う", bad.length === 0 && Object.keys(G.GROUPS).join() === "shinkoku,naosu,kurikoshi" && used.size === 3, bad.join(",")); }
// 引き継ぎコード（shared-workflows template/qa/transfer-check.mjs）
try {
  const sample = { "zsk-v1": JSON.stringify({ v: 1, tut: true, days: { "2026-11-13": { m: [0, 1, 0, 0, 2], k: ["sozoku", "hojin", "fufuku", "kosei", "jiko"] } }, hdays: {}, adays: {}, dex: { "sozoku": 1, "dei": 1, "sekkai": 1, "fufuku": 1, "kessho": 1 }, runs: {}, kofi: {}, ach: {}, ebest: 7, t: 1 }), "zsk-fs": "3", "zsk-depth": JSON.stringify({ v: 1, rv: { "sozoku|x1": { s: 1, due: "2026-11-20", t: 5 } } }) }; // 復習の記録も引き継ぐかを見る（CodeRabbit menkyo-nenrei#1）
  await checkTransfer({ browser, url, game: "zeimu-kigen", sample, check, open: async (pg) => { await firstClose(pg); } });
} catch (e) { check("引き継ぎの検査が最後まで動く", false, e.message.split("\n")[0]); }
await browser.close();
server.close();
check("画面のエラーが無い", errors.length === 0, errors.slice(0, 3).join(" | "));

{ // 見やすさ・読みやすさ・偏り（shared-workflows template/qa/a11y.mjs の写し）
  const { spawnSync } = await import("node:child_process");
  const a = spawnSync(process.execPath, [path.join(root, "qa", "a11y.mjs")], { encoding: "utf8", env: process.env });
  check("見やすさ・読みやすさの検査（qa/a11y.mjs。中身は qa-report/a11y.md）", a.status === 0, (a.stdout.match(/^- ❌.*$/gm) || []).join(" / ") || (a.status ? a.stderr.slice(-300) : ""));
}

const ng = results.filter((r) => !r.ok);
const md = `# 税の期限 QA\n\n${results.map((r) => `- ${r.ok ? "✅" : "❌"} ${r.name}${r.detail ? `（${r.detail}）` : ""}`).join("\n")}\n\n${ng.length ? `❌ ${ng.length}件` : `✅ ${results.length}項目すべて通過`}\n`;
mkdirSync(path.join(root, "qa-report"), { recursive: true });
writeFileSync(path.join(root, "qa-report/report.md"), md);
console.log(md);
process.exit(ng.length ? 1 : 0);
