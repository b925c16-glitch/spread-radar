export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!env.FUGLE_API_KEY) {
      return new Response("FUGLE_API_KEY 未設定", { status: 500 });
    }

    if (url.pathname === "/api/ranking") {
      try {
        const key = env.FUGLE_API_KEY;

        const productRes = await fetch(
          "https://api.fugle.tw/marketdata/v1.0/futopt/intraday/products?type=FUTURE&exchange=TAIFEX&session=REGULAR",
          {
            headers: {
              "X-API-KEY": key
            }
          }
        );

        if (!productRes.ok) {
          const detail = await productRes.text();

          return Response.json(
            {
              error: "股票期貨 API 無法使用",
              status: productRes.status,
              detail
            },
            { status: productRes.status }
          );
        }

        const productData = await productRes.json();
        const rawProducts = productData.data || [];

        const stockFutures = rawProducts.filter(function (p) {
          return p.underlyingSymbol && p.symbol;
        });

        const unique = new Map();

        for (const p of stockFutures) {
          if (!unique.has(p.underlyingSymbol)) {
            unique.set(p.underlyingSymbol, p);
          }
        }

        const products = Array.from(unique.values()).slice(0, 30);

        async function getJSON(api) {
          try {
            const r = await fetch(api, {
              headers: {
                "X-API-KEY": key
              }
            });

            if (!r.ok) return null;

            return await r.json();
          } catch {
            return null;
          }
        }

        async function getOne(p) {
          const stockCode = p.underlyingSymbol;
          const futureCode = p.symbol + "1!";

          const result = await Promise.all([
            getJSON(
              "https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/" +
                stockCode
            ),
            getJSON(
              "https://api.fugle.tw/marketdata/v1.0/futopt/intraday/quote/" +
                futureCode
            )
          ]);

          const stock = result[0];
          const future = result[1];

          if (!stock || !future) return null;

          const spot =
            stock.lastPrice ||
            stock.closePrice ||
            stock.referencePrice;

          const fut =
            future.lastPrice ||
            future.closePrice ||
            future.referencePrice;

          if (!spot || !fut) return null;

          const spread = fut - spot;
          const spreadPct = (spread / spot) * 100;

          return {
            stockCode: stockCode,
            name: stock.name || stockCode,
            futureCode: future.symbol || futureCode,
            spot: spot,
            future: fut,
            spread: spread,
            spreadPct: spreadPct
          };
        }

        const rows = [];

        for (let i = 0; i < products.length; i += 3) {
          const batch = products.slice(i, i + 3);

          const batchResult = await Promise.all(
            batch.map(function (p) {
              return getOne(p);
            })
          );

          for (const item of batchResult) {
            if (item) rows.push(item);
          }
        }

        return Response.json({
          updatedAt: new Date().toISOString(),
          rows: rows
        });
      } catch (e) {
        return Response.json(
          {
            error: String(e.message || e)
          },
          { status: 500 }
        );
      }
    }

    const html = [
      '<!DOCTYPE html>',
      '<html lang="zh-Hant">',
      '<head>',
      '<meta charset="UTF-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      '<title>價差雷達</title>',
      '<style>',
      'body{margin:0;background:#08111a;color:#f3f6fa;font-family:-apple-system,BlinkMacSystemFont,sans-serif}',
      'main{max-width:900px;margin:auto;padding:20px 12px 80px}',
      'h1{font-size:26px;margin-bottom:4px}',
      '.sub{font-size:13px;color:#8da1b5;margin-bottom:16px}',
      '.controls{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}',
      'button{border:1px solid #29405a;background:#111d29;color:white;border-radius:12px;padding:11px 13px}',
      'button.active{background:#68a7ff;color:#07111c;font-weight:bold}',
      '.status{font-size:12px;color:#8da1b5;margin-bottom:12px}',
      '.row{display:grid;grid-template-columns:35px 1.3fr .8fr .8fr .9fr;gap:7px;align-items:center;background:#111b26;border:1px solid #213247;border-radius:14px;padding:12px 9px;margin-bottom:8px}',
      '.head{background:transparent;border:0;color:#8da1b5;font-size:11px}',
      '.name{font-weight:bold}',
      '.code{display:block;font-size:11px;color:#8da1b5;margin-top:3px}',
      '.num{text-align:right}',
      '.pct{font-weight:bold}',
      '.pos{color:#ff6675}',
      '.neg{color:#2bd28a}',
      '.loading{text-align:center;color:#8da1b5;padding:40px}',
      '.error{background:#25151a;border:1px solid #63313b;border-radius:14px;padding:18px;line-height:1.7;color:#ffbdc4}',
      '</style>',
      '</head>',
      '<body>',
      '<main>',
      '<h1>價差雷達 📡</h1>',
      '<div class="sub">台股現股 × 股票期貨近月即時排行榜</div>',
      '<div class="controls">',
      '<button id="premium" class="active" onclick="setMode(\'premium\')">溢價最大</button>',
      '<button id="discount" onclick="setMode(\'discount\')">折價最大</button>',
      '<button id="absolute" onclick="setMode(\'absolute\')">絕對價差</button>',
      '<button onclick="loadData()">立即更新</button>',
      '</div>',
      '<div id="status" class="status">載入中...</div>',
      '<div class="row head">',
      '<div>#</div>',
      '<div>股票</div>',
      '<div class="num">現股</div>',
      '<div class="num">期貨</div>',
      '<div class="num">價差%</div>',
      '</div>',
      '<div id="list" class="loading">正在讀取行情...</div>',
      '</main>',
      '<script>',
      'let rows=[];',
      'let mode="premium";',
      '',
      'function setMode(m){',
      ' mode=m;',
      ' ["premium","discount","absolute"].forEach(function(x){',
      '  document.getElementById(x).classList.toggle("active",x===m);',
      ' });',
      ' render();',
      '}',
      '',
      'function render(){',
      ' let data=rows.slice();',
      '',
      ' if(mode==="premium"){',
      '  data.sort(function(a,b){return b.spreadPct-a.spreadPct;});',
      ' }',
      '',
      ' if(mode==="discount"){',
      '  data.sort(function(a,b){return a.spreadPct-b.spreadPct;});',
      ' }',
      '',
      ' if(mode==="absolute"){',
      '  data.sort(function(a,b){return Math.abs(b.spreadPct)-Math.abs(a.spreadPct);});',
      ' }',
      '',
      ' let output="";',
      '',
      ' data.slice(0,30).forEach(function(r,i){',
      '  let cls=r.spreadPct>=0?"pos":"neg";',
      '  let sign=r.spreadPct>=0?"+":"";',
      '',
      '  output += \'<div class="row">\' +',
      '   \'<div>\'+(i+1)+\'</div>\' +',
      '   \'<div><span class="name">\'+r.name+\'</span><span class="code">\'+r.stockCode+\' · \'+r.futureCode+\'</span></div>\' +',
      '   \'<div class="num">\'+Number(r.spot).toLocaleString()+\'</div>\' +',
      '   \'<div class="num">\'+Number(r.future).toLocaleString()+\'</div>\' +',
      '   \'<div class="num pct \'+cls+\'">\'+sign+r.spreadPct.toFixed(3)+\'%</div>\' +',
      '   \'</div>\';',
      ' });',
      '',
      ' document.getElementById("list").className="";',
      ' document.getElementById("list").innerHTML=output;',
      '}',
      '',
      'async function loadData(){',
      ' const list=document.getElementById("list");',
      ' const status=document.getElementById("status");',
      '',
      ' list.className="loading";',
      ' list.innerHTML="正在讀取即時行情...";',
      '',
      ' try{',
      '  const res=await fetch("/api/ranking?t="+Date.now());',
      '  const data=await res.json();',
      '',
      '  if(!res.ok){',
      '   throw new Error(data.error || "API 讀取失敗");',
      '  }',
      '',
      '  rows=data.rows || [];',
      '',
      '  if(!rows.length){',
      '   throw new Error("沒有取得股票期貨資料。你的富果方案可能沒有期權即時行情權限。");',
      '  }',
      '',
      '  status.innerText="取得 "+rows.length+" 檔｜更新 "+new Date(data.updatedAt).toLocaleTimeString();',
      '  render();',
      ' }catch(e){',
      '  list.className="error";',
      '  list.innerHTML="讀取失敗：<br>"+e.message+"<br><br>若現股 API 可以使用，但這裡失敗，通常代表目前富果方案沒有股票期貨即時行情權限。";',
      ' }',
      '}',
      '',
      'loadData();',
      'setInterval(loadData,30000);',
      '</script>',
      '</body>',
      '</html>'
    ].join("");

    return new Response(html, {
      headers: {
        "content-type": "text/html;charset=UTF-8",
        "cache-control": "no-store"
      }
    });
  }
};
