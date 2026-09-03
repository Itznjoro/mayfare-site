(function () {
  'use strict';

  // ============================================================
  // Shared helpers
  // ============================================================

  function fmtMoney(v) {
    if (v >= 1000) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (v >= 1) return '$' + v.toFixed(2);
    if (v >= 0.01) return '$' + v.toFixed(4);
    return '$' + v.toFixed(6);
  }

  function fmtFx(v) {
    if (v >= 100) return v.toFixed(2);
    return v.toFixed(4);
  }

  function fmtPct(p) {
    var sign = p >= 0 ? '+' : '';
    return sign + p.toFixed(2) + '%';
  }

  function isoDate(d) {
    return d.toISOString().slice(0, 10);
  }

  // Renders a full line chart (gridlines + area + stroke + date labels + hidden crosshair)
  // into an <svg viewBox="0 0 600 200">. Stores point/format data on the element so the
  // shared crosshair handler (attached once, see attachCrosshair) can read it on hover.
  function renderChart(svgEl, values, timeLabels, opts) {
    opts = opts || {};
    var color = opts.color || 'var(--color-success)';
    var formatValue = opts.formatValue || function (v) { return v.toFixed(2); };
    var gradId = 'fill-' + Math.random().toString(36).slice(2, 9);

    if (!values || values.length < 2) return;

    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var range = max - min || 1;
    var chartW = 540; // leaves room on the right for price labels, matches original markup
    var top = 12, bottom = 180;

    function yFor(v) {
      return top + (1 - (v - min) / range) * (bottom - top);
    }

    var n = values.length;
    var points = values.map(function (v, i) {
      return { x: (i / (n - 1)) * chartW, y: yFor(v), value: v, time: (timeLabels && timeLabels[i]) || '' };
    });

    var linePath = points.map(function (p, i) {
      return (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1);
    }).join(' ');
    var areaPath = linePath + ' L' + chartW.toFixed(1) + ',180 L0.0,180 Z';

    var midVal = min + range / 2;
    var startLabel = (timeLabels && timeLabels.start) || '';
    var endLabel = (timeLabels && timeLabels.end) || '';

    var svg = '' +
      '<defs>' +
      '<linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.28" />' +
      '<stop offset="100%" stop-color="' + color + '" stop-opacity="0" />' +
      '</linearGradient>' +
      '</defs>' +
      '<g><line x1="0" x2="540" y1="12" y2="12" stroke="currentColor" class="text-border" stroke-dasharray="3 4" stroke-width="1" vector-effect="non-scaling-stroke" />' +
      '<text x="546" y="15" class="fill-muted-foreground" font-size="9" font-family="var(--font-mono)">' + formatValue(max) + '</text></g>' +
      '<g><line x1="0" x2="540" y1="96" y2="96" stroke="currentColor" class="text-border" stroke-dasharray="3 4" stroke-width="1" vector-effect="non-scaling-stroke" />' +
      '<text x="546" y="99" class="fill-muted-foreground" font-size="9" font-family="var(--font-mono)">' + formatValue(midVal) + '</text></g>' +
      '<g><line x1="0" x2="540" y1="180" y2="180" stroke="currentColor" class="text-border" stroke-dasharray="3 4" stroke-width="1" vector-effect="non-scaling-stroke" />' +
      '<text x="546" y="183" class="fill-muted-foreground" font-size="9" font-family="var(--font-mono)">' + formatValue(min) + '</text></g>' +
      '<path d="' + areaPath + '" fill="url(#' + gradId + ')" />' +
      '<path d="' + linePath + '" fill="none" stroke="' + color + '" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round" />' +
      '<text x="4" y="194" class="fill-muted-foreground" font-size="9">' + startLabel + '</text>' +
      '<text x="536" y="194" text-anchor="end" class="fill-muted-foreground" font-size="9">' + endLabel + '</text>' +
      '<g class="chart-crosshair" style="display:none;">' +
      '<line class="crosshair-line" x1="0" y1="12" x2="0" y2="180" stroke="currentColor" class="text-muted-foreground" stroke-width="1" vector-effect="non-scaling-stroke" />' +
      '<circle class="crosshair-dot" r="4" fill="' + color + '" stroke="var(--card)" stroke-width="1.5" />' +
      '</g>';

    svgEl.innerHTML = svg;

    // Stash render data on the element for the shared hover handler to read.
    svgEl._chartPoints = points;
    svgEl._chartColor = color;
    svgEl._chartFormatValue = formatValue;
  }

  // Attaches (once) a mousemove/mouseleave crosshair handler to a chart svg.
  // opts.onHover(point|null) is called with the nearest data point (or null on leave)
  // so the caller can update its own price/time readout.
  function attachCrosshair(svgEl, onHover) {
    if (!svgEl || svgEl._crosshairAttached) return;
    svgEl._crosshairAttached = true;

    function pointFromEvent(evt) {
      var points = svgEl._chartPoints;
      if (!points || !points.length) return null;
      var rect = svgEl.getBoundingClientRect();
      if (!rect.width) return null;
      var vbX = ((evt.clientX - rect.left) / rect.width) * 600;
      vbX = Math.max(0, Math.min(540, vbX));
      var nearest = points[0];
      var nearestDist = Math.abs(points[0].x - vbX);
      for (var i = 1; i < points.length; i++) {
        var d = Math.abs(points[i].x - vbX);
        if (d < nearestDist) { nearest = points[i]; nearestDist = d; }
      }
      return nearest;
    }

    svgEl.addEventListener('mousemove', function (evt) {
      var pt = pointFromEvent(evt);
      var group = svgEl.querySelector('.chart-crosshair');
      var line = svgEl.querySelector('.crosshair-line');
      var dot = svgEl.querySelector('.crosshair-dot');
      if (!pt || !group || !line || !dot) return;
      group.style.display = '';
      line.setAttribute('x1', pt.x.toFixed(1));
      line.setAttribute('x2', pt.x.toFixed(1));
      dot.setAttribute('cx', pt.x.toFixed(1));
      dot.setAttribute('cy', pt.y.toFixed(1));
      if (onHover) onHover(pt);
    });

    svgEl.addEventListener('mouseleave', function () {
      var group = svgEl.querySelector('.chart-crosshair');
      if (group) group.style.display = 'none';
      if (onHover) onHover(null);
    });
  }

  // Fetch with a timeout so a slow/rate-limited API doesn't hang the UI indefinitely.
  function fetchWithTimeout(url, timeoutMs) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeoutMs || 10000);
    return fetch(url, { signal: controller.signal }).finally(function () { clearTimeout(timer); });
  }

  function setChartLoading(svgEl, isLoading) {
    if (!svgEl) return;
    svgEl.style.transition = 'opacity .2s ease';
    svgEl.style.opacity = isLoading ? '0.35' : '1';
  }

  // Small stylesheet for the newly-clickable overview tiles/rows (kept in JS to avoid
  // touching the page's existing style blocks).
  var clickHintStyle = document.createElement('style');
  clickHintStyle.textContent =
    '#cryptoMarketOverview [data-coin], #cryptoTopTable tr[data-coin] { transition: background-color .15s ease; } ' +
    '#cryptoMarketOverview [data-coin]:hover { background-color: var(--secondary); }';
  document.head.appendChild(clickHintStyle);

  // ============================================================
  // CRYPTO TAB (CoinGecko public API)
  // ============================================================
  (function cryptoModule() {
    var panel = document.getElementById('market-panel-crypto');
    if (!panel) return;

    var coinSelector = document.getElementById('cryptoCoinSelector');
    var timeframeSelector = document.getElementById('cryptoTimeframeSelector');
    var pairLabel = document.getElementById('cryptoPairLabel');
    var priceEl = document.getElementById('cryptoPrice');
    var changeEl = document.getElementById('cryptoChange');
    var chartSvg = document.getElementById('cryptoChartSvg');
    var overviewGrid = document.getElementById('cryptoMarketOverview');
    var topTable = document.getElementById('cryptoTopTable');
    if (!coinSelector || !chartSvg) return;

    var coinBtns = Array.prototype.slice.call(coinSelector.querySelectorAll('button'));
    var timeframeBtns = Array.prototype.slice.call(timeframeSelector.querySelectorAll('button'));
    var overviewCoins = Array.prototype.slice.call(overviewGrid.querySelectorAll('[data-coin]'));
    var tableCoins = topTable ? Array.prototype.slice.call(topTable.querySelectorAll('[data-coin]')) : [];

    var allCoinIds = overviewCoins.map(function (el) { return el.getAttribute('data-coin'); });

    var selectedCoin = 'bitcoin';
    var selectedSym = 'BTC';
    var selectedDays = '1';
    var selectedLabel = '1D';

    // Cache of the latest known price/change per coin (populated by the overview batch
    // fetch, which already covers every coin in the selector). Switching coins reads
    // from this cache instantly instead of firing a redundant extra network request —
    // this is what was causing the noticeable lag on the later coins in the list.
    var priceCache = {};
    var liveDisplay = { price: '$78,176.04', change: '+0.77% · 1D', color: 'var(--color-success)' };
    var chartRequestToken = 0;

    function updateHeaderButtonStyles() {
      coinBtns.forEach(function (b) {
        var active = b.getAttribute('data-coin') === selectedCoin;
        b.classList.toggle('bg-foreground', active);
        b.classList.toggle('text-background', active);
        b.classList.toggle('bg-secondary', !active);
        b.classList.toggle('text-muted-foreground', !active);
        b.classList.toggle('hover:text-foreground', !active);
      });
      timeframeBtns.forEach(function (b) {
        var active = b.getAttribute('data-label') === selectedLabel;
        b.classList.toggle('bg-foreground', active);
        b.classList.toggle('text-background', active);
        b.classList.toggle('bg-secondary/80', !active);
        b.classList.toggle('text-muted-foreground', !active);
        b.classList.toggle('hover:text-foreground', !active);
      });
    }

    // Renders the header (price/change/pair label) instantly from cache, no network wait.
    function renderHeaderFromCache() {
      var cached = priceCache[selectedCoin];
      if (pairLabel) pairLabel.textContent = selectedSym + '/USDT';
      if (!cached) return;
      var isDown = cached.change < 0;
      var priceText = fmtMoney(cached.price);
      var changeText = fmtPct(cached.change) + ' · ' + selectedLabel;
      var color = isDown ? 'var(--destructive)' : 'var(--color-success)';
      if (priceEl) { priceEl.textContent = priceText; priceEl.dataset.trend = isDown ? 'down' : 'up'; }
      if (changeEl) { changeEl.textContent = changeText; changeEl.style.color = color; }
      liveDisplay = { price: priceText, change: changeText, color: color };
    }

    function loadChart() {
      var myToken = ++chartRequestToken;
      var days = selectedDays;
      var url = 'https://api.coingecko.com/api/v3/coins/' + selectedCoin + '/market_chart?vs_currency=usd&days=' + days;
      setChartLoading(chartSvg, true);
      fetchWithTimeout(url, 12000)
        .then(function (r) {
          if (r.status === 429) throw new Error('rate limited (429) — CoinGecko free API allows a limited number of requests per minute');
          if (!r.ok) throw new Error('chart fetch failed: ' + r.status);
          return r.json();
        })
        .then(function (data) {
          if (myToken !== chartRequestToken) return; // a newer selection superseded this response
          var prices = data.prices || [];
          if (!prices.length) return;

          if (selectedLabel === '1H') prices = prices.slice(-13);
          else if (selectedLabel === '4H') prices = prices.slice(-49);

          var values = prices.map(function (p) { return p[1]; });
          var timestamps = prices.map(function (p) { return p[0]; });
          var useTime = selectedDays === '1';

          function fmtLabel(ts) {
            var d = new Date(ts);
            return useTime
              ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
              : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          }

          var timeLabels = timestamps.map(fmtLabel);
          timeLabels.start = fmtLabel(timestamps[0]);
          timeLabels.end = fmtLabel(timestamps[timestamps.length - 1]);

          var color = liveDisplay.color;
          renderChart(chartSvg, values, timeLabels, {
            color: color,
            formatValue: function (v) { return v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : v.toFixed(v >= 1 ? 2 : 4); }
          });
          setChartLoading(chartSvg, false);
        })
        .catch(function (err) {
          if (myToken !== chartRequestToken) return;
          setChartLoading(chartSvg, false);
          console.warn('Crypto chart update skipped:', err.message);
        });
    }

    function loadOverviewAndTable() {
      var url = 'https://api.coingecko.com/api/v3/simple/price?ids=' + allCoinIds.join(',') + '&vs_currencies=usd&include_24hr_change=true';
      fetchWithTimeout(url, 12000)
        .then(function (r) { if (!r.ok) throw new Error('overview fetch failed: ' + r.status); return r.json(); })
        .then(function (data) {
          allCoinIds.forEach(function (id) {
            var coin = data[id];
            if (coin) priceCache[id] = { price: coin.usd, change: coin.usd_24h_change || 0 };
          });

          overviewCoins.forEach(function (el) {
            var id = el.getAttribute('data-coin');
            var coin = data[id];
            if (!coin) return;
            var change = coin.usd_24h_change || 0;
            var isDown = change < 0;
            var priceSpan = el.querySelector('.mo-price');
            var pctSpan = el.querySelector('.mo-pct');
            if (priceSpan) priceSpan.textContent = fmtMoney(coin.usd);
            if (pctSpan) {
              pctSpan.textContent = fmtPct(change);
              pctSpan.style.color = isDown ? 'var(--destructive)' : 'var(--color-success)';
            }
          });
          tableCoins.forEach(function (el) {
            var id = el.getAttribute('data-coin');
            var coin = data[id];
            if (!coin) return;
            var change = coin.usd_24h_change || 0;
            var isDown = change < 0;
            var priceTd = el.querySelector('.top-price');
            var pctTd = el.querySelector('.top-pct');
            if (priceTd) priceTd.textContent = fmtMoney(coin.usd);
            if (pctTd) {
              pctTd.textContent = fmtPct(change);
              pctTd.style.color = isDown ? 'var(--destructive)' : 'var(--color-success)';
            }
          });

          renderHeaderFromCache();
        })
        .catch(function (err) { console.warn('Crypto overview update skipped:', err.message); });
    }

    var coinSymbolMap = {
      bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', binancecoin: 'BNB',
      ripple: 'XRP', dogecoin: 'DOGE', cardano: 'ADA', 'avalanche-2': 'AVAX'
    };

    function selectCoin(coinId, sym) {
      selectedCoin = coinId;
      selectedSym = sym || coinSymbolMap[coinId] || coinId.toUpperCase();
      updateHeaderButtonStyles();
      renderHeaderFromCache(); // instant, from cache — no network wait
      loadChart();
      chartSvg.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    coinBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectCoin(btn.getAttribute('data-coin'), btn.getAttribute('data-sym'));
      });
    });

    // Market Overview tiles and Top Cryptocurrencies rows also jump the chart to that coin,
    // including ADA/AVAX which don't have their own button in the top selector row.
    overviewCoins.forEach(function (el) {
      el.classList.add('cursor-pointer');
      el.addEventListener('click', function () {
        selectCoin(el.getAttribute('data-coin'));
      });
    });
    tableCoins.forEach(function (el) {
      el.addEventListener('click', function () {
        selectCoin(el.getAttribute('data-coin'));
      });
    });

    timeframeBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectedDays = btn.getAttribute('data-days');
        selectedLabel = btn.getAttribute('data-label');
        updateHeaderButtonStyles();
        renderHeaderFromCache();
        loadChart();
      });
    });

    attachCrosshair(chartSvg, function (pt) {
      if (!priceEl || !changeEl) return;
      if (!pt) {
        priceEl.textContent = liveDisplay.price;
        changeEl.textContent = liveDisplay.change;
        changeEl.style.color = liveDisplay.color;
        return;
      }
      var fmt = chartSvg._chartFormatValue || function (v) { return v.toFixed(2); };
      priceEl.textContent = '$' + fmt(pt.value);
      changeEl.textContent = pt.time;
      changeEl.style.color = 'var(--muted-foreground)';
    });

    loadOverviewAndTable();
    loadChart();
    setInterval(loadOverviewAndTable, 45000);
    setInterval(loadChart, 120000);
  })();

  // ============================================================
  // FOREX TAB (Frankfurter public API — ECB reference rates)
  // ============================================================
  (function forexModule() {
    var panel = document.getElementById('market-panel-forex');
    if (!panel) return;

    var pairSelector = document.getElementById('forexPairSelector');
    var timeframeSelector = document.getElementById('forexTimeframeSelector');
    var pairLabel = document.getElementById('forexPairLabel');
    var priceEl = document.getElementById('forexPrice');
    var changeEl = document.getElementById('forexChange');
    var chartSvg = document.getElementById('forexChartSvg');
    var majorsGrid = document.getElementById('forexMajorsOverview');
    if (!pairSelector || !chartSvg) return;

    var pairBtns = Array.prototype.slice.call(pairSelector.querySelectorAll('button'));
    var timeframeBtns = Array.prototype.slice.call(timeframeSelector.querySelectorAll('button'));
    var majorTiles = Array.prototype.slice.call(majorsGrid.querySelectorAll('[data-base]'));

    var selectedBase = 'EUR';
    var selectedQuote = 'USD';
    var selectedDays = '90';
    var selectedLabel = '3M';
    var liveDisplay = { price: '1.1643', change: '-0.01% · 3M', color: 'var(--destructive)' };
    var chartRequestToken = 0;

    function updateButtonStyles() {
      pairBtns.forEach(function (b) {
        var active = b.getAttribute('data-base') === selectedBase && b.getAttribute('data-quote') === selectedQuote;
        b.classList.toggle('bg-foreground', active);
        b.classList.toggle('text-background', active);
        b.classList.toggle('bg-secondary', !active);
        b.classList.toggle('text-muted-foreground', !active);
        b.classList.toggle('hover:text-foreground', !active);
      });
      timeframeBtns.forEach(function (b) {
        var active = b.getAttribute('data-label') === selectedLabel;
        b.classList.toggle('bg-foreground', active);
        b.classList.toggle('text-background', active);
        b.classList.toggle('bg-secondary/80', !active);
        b.classList.toggle('text-muted-foreground', !active);
        b.classList.toggle('hover:text-foreground', !active);
      });
      majorTiles.forEach(function (tile) {
        var active = tile.getAttribute('data-base') === selectedBase && tile.getAttribute('data-quote') === selectedQuote;
        tile.classList.toggle('bg-secondary', active);
        tile.classList.toggle('ring-1', active);
        tile.classList.toggle('ring-foreground/30', active);
        tile.classList.toggle('bg-secondary/40', !active);
      });
    }

    function loadChart() {
      var myToken = ++chartRequestToken;
      var end = new Date();
      var start = new Date();
      start.setDate(start.getDate() - parseInt(selectedDays, 10));
      var url = 'https://api.frankfurter.dev/v1/' + isoDate(start) + '..' + isoDate(end) +
        '?base=' + selectedBase + '&symbols=' + selectedQuote;
      setChartLoading(chartSvg, true);
      fetchWithTimeout(url, 12000)
        .then(function (r) { if (!r.ok) throw new Error('fx chart fetch failed: ' + r.status); return r.json(); })
        .then(function (data) {
          if (myToken !== chartRequestToken) return;
          var rates = data.rates || {};
          var dates = Object.keys(rates).sort();
          if (dates.length < 2) return;
          var values = dates.map(function (d) { return rates[d][selectedQuote]; });

          function fmtLabel(dateStr) {
            return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          }
          var timeLabels = dates.map(fmtLabel);
          timeLabels.start = fmtLabel(dates[0]);
          timeLabels.end = fmtLabel(dates[dates.length - 1]);

          var isDown = values[values.length - 1] < values[0];
          var color = isDown ? 'var(--destructive)' : 'var(--color-success)';
          renderChart(chartSvg, values, timeLabels, { color: color, formatValue: fmtFx });
          setChartLoading(chartSvg, false);
        })
        .catch(function (err) {
          if (myToken !== chartRequestToken) return;
          setChartLoading(chartSvg, false);
          console.warn('Forex chart update skipped:', err.message);
        });
    }

    function loadHeaderAndMajors() {
      var end = new Date();
      var start = new Date();
      start.setDate(start.getDate() - 7);
      var range = isoDate(start) + '..' + isoDate(end);

      var requests = majorTiles.map(function (tile) {
        var base = tile.getAttribute('data-base');
        var quote = tile.getAttribute('data-quote');
        var url = 'https://api.frankfurter.dev/v1/' + range + '?base=' + base + '&symbols=' + quote;
        return fetchWithTimeout(url, 12000).then(function (r) { if (!r.ok) throw new Error('fx fetch failed: ' + r.status); return r.json(); })
          .then(function (data) { return { base: base, quote: quote, data: data }; })
          .catch(function (err) { console.warn('Forex tile update skipped (' + base + '/' + quote + '):', err.message); return null; });
      });

      Promise.all(requests).then(function (results) {
        var latestSeenDate = null;
        results.forEach(function (res) {
          if (!res) return;
          var rates = res.data.rates || {};
          var dates = Object.keys(rates).sort();
          if (dates.length < 1) return;
          var latestDateStr = dates[dates.length - 1];
          if (!latestSeenDate || latestDateStr > latestSeenDate) latestSeenDate = latestDateStr;
          var latestVal = rates[latestDateStr][res.quote];
          var prevVal = dates.length > 1 ? rates[dates[dates.length - 2]][res.quote] : latestVal;
          var change = prevVal ? ((latestVal - prevVal) / prevVal) * 100 : 0;
          var isDown = change < 0;

          var tile = majorTiles.filter(function (t) {
            return t.getAttribute('data-base') === res.base && t.getAttribute('data-quote') === res.quote;
          })[0];
          if (tile) {
            var priceSpan = tile.querySelector('.mo-fx-price');
            var pctSpan = tile.querySelector('.mo-fx-pct');
            if (priceSpan) priceSpan.textContent = fmtFx(latestVal);
            if (pctSpan) {
              pctSpan.textContent = fmtPct(change);
              pctSpan.style.color = isDown ? 'var(--destructive)' : 'var(--color-success)';
            }
          }

          if (res.base === selectedBase && res.quote === selectedQuote) {
            var priceText = fmtFx(latestVal);
            var changeText = fmtPct(change) + ' · ' + selectedLabel;
            var color = isDown ? 'var(--destructive)' : 'var(--color-success)';
            if (pairLabel) pairLabel.textContent = selectedBase + '/' + selectedQuote;
            if (priceEl) priceEl.textContent = priceText;
            if (changeEl) { changeEl.textContent = changeText; changeEl.style.color = color; }
            liveDisplay = { price: priceText, change: changeText, color: color };
          }
        });
        var dateLabel = document.getElementById('forexUpdatedDate');
        if (dateLabel && latestSeenDate) dateLabel.textContent = 'daily · ' + latestSeenDate;
      });
    }

    function selectPair(base, quote) {
      selectedBase = base;
      selectedQuote = quote;
      updateButtonStyles();
      loadChart();
      loadHeaderAndMajors();
      chartSvg.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    pairBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectPair(btn.getAttribute('data-base'), btn.getAttribute('data-quote'));
      });
    });

    // Majors Overview tiles also jump the chart to that pair.
    majorTiles.forEach(function (tile) {
      tile.addEventListener('click', function () {
        selectPair(tile.getAttribute('data-base'), tile.getAttribute('data-quote'));
      });
    });

    timeframeBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectedDays = btn.getAttribute('data-days');
        selectedLabel = btn.getAttribute('data-label');
        updateButtonStyles();
        loadChart();
        loadHeaderAndMajors();
      });
    });

    attachCrosshair(chartSvg, function (pt) {
      if (!priceEl || !changeEl) return;
      if (!pt) {
        priceEl.textContent = liveDisplay.price;
        changeEl.textContent = liveDisplay.change;
        changeEl.style.color = liveDisplay.color;
        return;
      }
      var fmt = chartSvg._chartFormatValue || fmtFx;
      priceEl.textContent = fmt(pt.value);
      changeEl.textContent = pt.time;
      changeEl.style.color = 'var(--muted-foreground)';
    });

    loadChart();
    loadHeaderAndMajors();
    setInterval(loadHeaderAndMajors, 300000);
  })();
})();
