export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/quote") {
      try {
        if (!env.FUGLE_API_KEY) {
          return Response.json(
            { error: "尚未設定富果 API Key" },
            { status: 500 }
          );
        }

        const symbol = url.searchParams.get("symbol") || "2330";

        const res = await fetch(
          `https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/${symbol}`,
          {
            headers: {
              "X-API-KEY": env.FUGLE_API_KEY
            }
          }
        );

        const data = await res.json();

        return new Response(JSON.stringify(data), {
          status: res.status,
          headers: {
            "content-type": "application/json;charset=UTF-8"
          }
        });

      } catch (e) {
        return Response.json(
          { error: e.message },
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
  background: #09111a;
  color: white;
  font-family: -apple-system, sans-serif;
}

main {
  max-width: 600px;
  margin: auto;
  padding: 20px;
}

h1 {
  font-size: 26px;
}

.card {
  background: #131d29;
  border-radius: 18px;
  padding: 20px;
  margin-top: 20px;
}

input {
  box-sizing: border-box;
  width: 100%;
  padding: 14px;
  font-size: 18px;
  border-radius: 12px;
  border: 1px solid #34465b;
  background: #0b141e;
  color: white;
}

button {
  width: 100%;
  margin-top: 10px;
  padding: 14px;
  border: 0;
  border-radius: 12px;
  background: #69a7ff;
  font-size: 17px;
  font-weight: bold;
}

.name {
  margin-top: 22px;
  font-size: 20px;
  font-weight: bold;
}

.price {
  margin-top: 10px;
  font-size: 44px;
  font-weight: bold;
}

.status {
  margin-top: 12px;
  color: #91a4b8;
  font-size: 13px;
}

</style>
</head>

<body>

<main>

<h1>價差雷達 📡</h1>

<p>富果即時行情測試</p>

<div class="card">

<input
id="symbol"
value="2330"
inputmode="numeric">

<button onclick="loadQuote()">
查詢即時行情
</button>

<div id="name" class="name">
讀取中...
</div>

<div id="price" class="price">
--
</div>

<div id="status" class="status">
正在連接富果 API
</div>

</div>

</main>

<script>

async function loadQuote() {

  const symbol =
    document.getElementById("symbol").value.trim();

  const status =
    document.getElementById("status");

  status.innerText = "讀取中...";

  try {

    const res =
      await fetch("/api/quote?symbol=" + symbol);

    const data =
      await res.json();

    if (!res.ok) {
      throw new Error(
        data.message ||
        data.error ||
        "API 讀取失敗"
      );
    }

    document.getElementById("name").innerText =
      data.name || symbol;

    document.getElementById("price").innerText =
      data.closePrice ??
      data.lastPrice ??
      data.referencePrice ??
      "--";

    status.innerText =
      "富果 API 連線成功 ✓";

  } catch (error) {

    document.getElementById("price").innerText =
      "--";

    status.innerText =
      "錯誤：" + error.message;

  }
}

loadQuote();

</script>

</body>
</html>
`,
    {
      headers: {
        "content-type":
          "text/html;charset=UTF-8"
      }
    });
  }
};
