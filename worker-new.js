export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!env.FUGLE_API_KEY) {
      return new Response("FUGLE_API_KEY 未設定", { status: 500 });
    }

    if (url.pathname === "/api/ranking") {
      try {
        const key = env.FUGLE_API_KEY;

        // 1. 取得股票期貨商品清單
        const productRes = await fetch(
          "https://api.fugle.tw/marketdata/v1.0/futopt/intraday/products?type=FUTURE&exchange=TAIFEX&session=REGULAR&contractType=S",
          {
            headers: {
              "X-API-KEY": key
            }
          }
        );

        if (!productRes.ok) {
          const t = await productRes.text();
          return Response.json(
            {
              error: "無法取得股票期貨清單",
              status: productRes.status,
              detail: t
            },
            { status: productRes.status }
          );
        }

        const productData = await productRes.json();

        const products = (productData.data || [])
          .filter(x =>
            x.underlyingSymbol &&
            x.symbol &&
            x.statusCode !== "P"
          );

        // 同一檔現股只保留一個期貨根代碼
        const map = new Map();

        for (const p of products) {
          if (!map.has(p.underlyingSymbol)) {
            map.set(p.underlyingSymbol, p);
          }
        }

        // 先限制前 60 檔，避免 API 請求數過大
        const list = [...map.values()].slice(0, 60);

        async function getJSON(api) {
          const r = await fetch(api, {
            headers: {
              "X-API-KEY": key
            }
          });

          if (!r.ok) return null;

          try {
            return await r.json();
          } catch {
            return null;
          }
        }

        async function worker(p) {
          try {
            const stockCode = p.underlyingSymbol;

            // 股票期貨 root code，例如 CDF
            const root = p.symbol;

            const futSymbol = root + "1!";

            const [stock, future] = await Promise.all([
              getJSON(
                `https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/${stockCode}`
              ),
              getJSON(
                `https://api.fugle.tw/marketdata/v1.0/futopt/intraday/quote/${futSymbol}`
              )
            ]);

            if (!stock || !future) return null;

            const spot =
              stock.lastPrice ??
              stock.closePrice ??
              stock.referencePrice;

            const fut =
              future.lastPrice ??
              future.closePrice ??
              future.referencePrice;

            if (!spot || !fut) return null;

            const spread = fut - spot;
            const spreadPct = spread / spot * 100;

            return {
              stockCode,
              name: stock.name || p.name || stockCode,
              futureSymbol: future.symbol || futSymbol,
              spot,
              future: fut,
              spread,
              spreadPct,
              futureVolume:
                future.total?.tradeVolume ??
                future.totalVolume ??
                0
            };

          } catch {
            return null;
          }
        }

        // 限制同時請求數
        const results = [];

        for (let i = 0; i < list.length; i += 5) {
          const batch = list.slice(i, i + 5);

          const data = await Promise.all(
            batch.map(worker)
          );

          results.push(
            ...data.filter(Boolean)
          );
        }

        return Response.json({
          updatedAt: new Date().toISOString(),
          rows: results
        });

      } catch (e) {
        return Response.json(
          {
            error: e.message
          },
          { status: 500 }
        );
      }
    }

    return new Response(`
<!DOCTYPE html>
<html lang="zh-Hant">

<head>

<meta charset="UTF-8">

<meta name="viewport"
content="width=device-width,initial-scale=1">

<title>價差雷達</title>

<style>

body {
  margin: 0;
  background: #08111a;
  color: #f3f6fa;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
}

main {
  max-width: 900px;
  margin: auto;
  padding: 18px 12px 80px;
}

h1 {
  font-size: 25px;
  margin-bottom: 4px;
}

.sub {
  color: #8da1b5;
  font-size: 13px;
  margin-bottom: 16px;
}

.controls {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

button {
  border: 1px solid #263a50;
  border-radius: 12px;
  padding: 11px 13px;
  background: #111d29;
  color: white;
}

button.active {
  background: #68a7ff;
  color: #07111c;
  font-weight: bold;
}

.status {
  color: #8da1b5;
  font-size: 12px;
  margin-bottom: 12px;
}

.row {
  display: grid;
  grid-template-columns:
    42px
    1.4fr
    .9fr
    .9fr
    .9fr;
  gap: 7px;
  align-items: center;

  background: #111b26;
  border: 1px solid #213247;
  border-radius: 14px;

  padding: 12px 10px;
  margin-bottom: 8px;
}

.head {
  background: transparent;
  border: none;
  color: #8da1b5;
  font-size: 11px;
}

.name {
  font-weight: bold;
}

.code {
  display: block;
  font-size: 11px;
  color: #8da1b5;
  margin-top: 3px;
}

.num {
  text-align: right;
}

.pct {
  font-weight: bold;
}

.pos {
  color: #ff6675;
}

.neg {
  color: #2bd28a;
}

.error {
  background: #25151a;
  border: 1px solid #63313b;
  border-radius: 14px;
  padding: 18px;
  line-height: 1.7;
  color: #ffbdc4;
}

.loading {
  text-align: center;
  padding: 40px;
  color: #8da1b5;
}

@media(max-width:600px) {

  .row {
    grid-template-columns:
      34px
      1.25fr
      .75fr
      .75fr
      .85fr;
  }

}

</style>

</head>

<body>

<main>

<h1>價差雷達 📡</h1>

<div class="sub">
台股現股 × 股票期貨近月即時排行榜
</div>

<div class="controls">

<button
id="premium"
class="active"
onclick="setMode('premium')">

溢價最大

</button>

<button
id="discount"
onclick="setMode('discount')">

折價最大

</button>

<button
id="absolute"
onclick="setMode('absolute')">

絕對價差

</button>

<button onclick="loadData()">
立即更新
</button>

</div>

<div
id="status"
class="status">

載入中...

</div>

<div class="row head">

<div>#</div>

<div>股票</div>

<div class="num">
現股
</div>

<div class="num">
期貨
</div>

<div class="num">
價差％
</div>

</div>

<div
id="list"
class="loading">

正在讀取富果行情...

</div>

</main>

<script>

let rows = [];
let mode = "premium";

function setMode(m) {

  mode = m;

  ["premium","discount","absolute"]
    .forEach(x => {

      document
        .getElementById(x)
        .classList
        .toggle("active", x === m);

    });

  render();

}

function render() {

  let data = [...rows];

  if (mode === "premium") {

    data.sort(
      (a,b) =>
        b.spreadPct -
        a.spreadPct
    );

  }

  if (mode === "discount") {

    data.sort(
      (a,b) =>
        a.spreadPct -
        b.spreadPct
    );

  }

  if (mode === "absolute") {

    data.sort(
      (a,b) =>
        Math.abs(b.spreadPct) -
        Math.abs(a.spreadPct)
    );

  }

  const list =
    document.getElementById("list");

  list.className = "";

  list.innerHTML =
    data
      .slice(0,30)
      .map((r,i) => {

        const cls =
          r.spreadPct >= 0
          ? "pos"
          : "neg";

        return `

<div class="row">

<div>
${i + 1}
</div>

<div>

<span class="name">
${r.name}
</span>

<span class="code">
${r.stockCode}
 ·
${r.futureSymbol}
</span>

</div>

<div class="num">
${Number(r.spot).toLocaleString()}
</div>

<div class="num">
${Number(r.future).toLocaleString()}
</div>

<div class="num pct ${cls}">

${r.spreadPct >= 0 ? "+" : ""}

${r.spreadPct.toFixed(3)}%

</div>

</div>

`;

      })
      .join("");

}

async function loadData() {

  const list =
    document.getElementById("list");

  const status =
    document.getElementById("status");

  list.className =
    "loading";

  list.innerHTML =
    "正在讀取即時行情...";

  try {

    const res =
      await fetch(
        "/api/ranking?t=" +
        Date.now()
      );

    const data =
      await res.json();

    if (!res.ok) {

      throw new Error(
        data.error +
        (
          data.detail
          ? "<br>" + data.detail
          : ""
        )
      );

    }

    rows =
      data.rows || [];

    if (!rows.length) {

      throw new Error(
        "沒有取得股票期貨資料。你的富果方案可能沒有期權即時行情權限。"
      );

    }

    status.innerText =
      "已取得 " +
      rows.length +
      " 檔｜更新：" +
      new Date(
        data.updatedAt
      ).toLocaleTimeString();

    render();

  }

  catch(e) {

    list.className =
      "error";

    list.innerHTML =
      "讀取失敗：<br>" +
      e.message +
      "<br><br>" +
      "如果現股 API 可以使用，但這裡失敗，通常代表目前的富果方案沒有股票期貨即時行情權限。";

  }

}

loadData();

setInterval(
  loadData,
  30000
);

</script>

</body>

</html>
`,
    {
      headers: {
        "content-type":
          "text/html;charset=UTF-8",
        "cache-control":
          "no-store"
      }
    }
  );
}
};
