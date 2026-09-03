(function () {
  'use strict';

  // IntersectionObserver-based reveal helper
  function observe(selector, onEnter, rootMargin) {
    var targets = document.querySelectorAll(selector);
    if (!targets.length || !('IntersectionObserver' in window)) {
      targets.forEach(function (el) { if (el.classList.contains('reveal-armed')) el.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          onEnter(entry.target);
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.2, rootMargin: rootMargin || '0px 0px -5% 0px' });
    targets.forEach(function (el) { io.observe(el); });
  }

  // Generic "reveal" elements: start hidden on load, animate in when scrolled into view
  var reveals = document.querySelectorAll('.reveal');
  reveals.forEach(function (el) { el.classList.add('reveal-armed'); });
  observe('.reveal', function (el) { el.classList.add('in'); });

  // Plan cards: start translateY(50px) hidden, reveal on scroll
  var planCards = document.querySelectorAll('.plan-card-anim');
  planCards.forEach(function (el) {
    el.classList.add('hidden-start');
    var inner = el.querySelector('.plan-card');
    if (inner) inner.style.opacity = '0';
    inner.style.transition = 'opacity .8s cubic-bezier(.22,1,.36,1), transform .8s cubic-bezier(.22,1,.36,1)';
  });
  observe('.plan-card-anim', function (el) {
    el.classList.add('visible');
    el.classList.remove('hidden-start');
    var inner = el.querySelector('.plan-card');
    if (inner) inner.style.opacity = '1';
  }, '0px 0px -10% 0px');

  // Service cards reveal
  observe('.service-card-anim', function (el) { el.classList.add('visible'); }, '0px 0px -10% 0px');

  // ---- Live pool stats: count-up numbers + sparkline draw-in ----
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function parseStatNum(text) {
    var m = text.trim().match(/^([^\d]*)([\d,]+(?:\.\d+)?)(.*)$/);
    if (!m) return null;
    var decimals = (m[2].split('.')[1] || '').length;
    return {
      prefix: m[1],
      suffix: m[3],
      value: parseFloat(m[2].replace(/,/g, '')),
      decimals: decimals
    };
  }

  function formatStatNum(value, decimals) {
    return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  function animateCountUp(el) {
    var parsed = parseStatNum(el.textContent);
    if (!parsed) return;
    if (reduceMotion) return; // leave final value as-is
    var duration = 1500;
    var startTime = null;
    var target = parsed.value;
    function step(ts) {
      if (!startTime) startTime = ts;
      var progress = Math.min(1, (ts - startTime) / duration);
      var eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
      el.textContent = parsed.prefix + formatStatNum(target * eased, parsed.decimals) + parsed.suffix;
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        el.textContent = parsed.prefix + formatStatNum(target, parsed.decimals) + parsed.suffix;
      }
    }
    requestAnimationFrame(step);
  }

  function prepSparkline(card) {
    if (reduceMotion) return;
    var poly = card.querySelector('.stat-chart polyline');
    var dot = card.querySelector('.stat-chart circle');
    if (poly && poly.getTotalLength) {
      var len = poly.getTotalLength();
      poly.style.strokeDasharray = len;
      poly.style.strokeDashoffset = len;
    }
    if (dot) dot.style.opacity = '0';
  }

  function drawSparkline(card) {
    var poly = card.querySelector('.stat-chart polyline');
    var dot = card.querySelector('.stat-chart circle');
    if (poly) poly.style.strokeDashoffset = '0';
    if (dot) {
      setTimeout(function () { dot.style.opacity = '1'; }, 900);
    }
  }

  var statCards = document.querySelectorAll('.stat-card');
  if (statCards.length) {
    statCards.forEach(function (el) {
      if (!reduceMotion) el.classList.add('stat-card-armed');
      prepSparkline(el);
    });
    observe('.stat-card', function (el) {
      var idx = Array.prototype.indexOf.call(statCards, el);
      var delay = reduceMotion ? 0 : idx * 90;
      setTimeout(function () {
        el.classList.add('in');
        var numEl = el.querySelector('.stat-value .num');
        if (numEl) animateCountUp(numEl);
        drawSparkline(el);
      }, delay);
    }, '0px 0px -10% 0px');
  }

  // Timeline: fill line + step reveal based on scroll position
  function initTimeline(containerId, fillId, stepSelector) {
    var container = document.getElementById(containerId);
    if (!container) return;
    var fill = document.getElementById(fillId);
    var steps = container.querySelectorAll(stepSelector);

    function onScroll() {
      var rect = container.getBoundingClientRect();
      var vh = window.innerHeight;
      var h = rect.height;
      if (fill) {
        var pct = Math.min(100, Math.max(0, (vh - rect.top) / h * 100));
        fill.style.height = pct + '%';
      }
      steps.forEach(function (el, i) {
        // add visible after it enters 85% of viewport, staggered
        var top = container.getBoundingClientRect().top;
        var delay = Math.max(0, (i * 150) - Math.max(0, top - (0.3 * vh)));
        setTimeout(function () { el.classList.add('visible'); }, delay);
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  initTimeline('tlMobile', 'tlFillMobile', '.step-row');
  initTimeline('tlDesktop', 'tlFillDesktop', '.tl-step');

  // Hero text staggered fade-up
  var heroTexts = document.querySelectorAll('.hero-text');
  if (heroTexts.length) {
    heroTexts.forEach(function (el, i) {
      el.style.opacity = '0';
      el.style.transform = 'translateY(30px)';
      el.style.transition = 'opacity .8s cubic-bezier(.22,1,.36,1), transform .8s cubic-bezier(.22,1,.36,1)';
      setTimeout(function () {
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
      }, 150 * i);
    });
  }

  // Floating telegram button appears after scrolling past hero
  var floatBtn = document.getElementById('floatTelegram');
  if (floatBtn) {
    var hero = document.querySelector('.hero');
    function onFloatScroll() {
      var show = window.scrollY > (hero ? hero.offsetHeight * 0.7 : 400);
      floatBtn.classList.toggle('show', show);
    }
    window.addEventListener('scroll', onFloatScroll, { passive: true });
    onFloatScroll();
  }

  // Ticker: duplicate track content for seamless scroll
  var track = document.getElementById('tickerTrack');
  if (track) {
    track.innerHTML = track.innerHTML + track.innerHTML;
  }

  // ---- Live ticker prices (CoinGecko public API, no key required) ----
  (function () {
    var coinIds = ['bitcoin', 'ethereum', 'solana', 'binancecoin', 'ripple', 'cardano', 'dogecoin', 'avalanche-2'];
    var items = document.querySelectorAll('.ticker-item[data-coin]');
    if (!items.length) return;

    function formatPrice(p) {
      if (p >= 1000) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 0 });
      if (p >= 1) return '$' + p.toFixed(2);
      if (p >= 0.01) return '$' + p.toFixed(4);
      return '$' + p.toFixed(6);
    }

    function formatPct(pct) {
      var sign = pct >= 0 ? '+' : '';
      return sign + pct.toFixed(2) + '%';
    }

    function updateTicker(data) {
      items.forEach(function (el) {
        var id = el.getAttribute('data-coin');
        var coin = data[id];
        if (!coin || typeof coin.usd !== 'number') return;
        var priceEl = el.querySelector('.ticker-price');
        var pctEl = el.querySelector('.ticker-pct');
        var dotEl = el.querySelector('.ticker-dot');
        var change = typeof coin.usd_24h_change === 'number' ? coin.usd_24h_change : 0;
        var isDown = change < 0;
        if (priceEl) priceEl.textContent = formatPrice(coin.usd);
        if (pctEl) {
          pctEl.textContent = formatPct(change);
          pctEl.classList.toggle('down', isDown);
        }
        if (dotEl) dotEl.classList.toggle('down', isDown);
      });
    }

    function fetchPrices() {
      var url = 'https://api.coingecko.com/api/v3/simple/price?ids=' +
        coinIds.join(',') + '&vs_currencies=usd&include_24hr_change=true';
      fetch(url)
        .then(function (res) {
          if (!res.ok) throw new Error('ticker fetch failed: ' + res.status);
          return res.json();
        })
        .then(updateTicker)
        .catch(function (err) {
          // Silently keep existing values if the API is unreachable
          // (e.g. offline, blocked, or rate-limited) so the ticker never breaks.
          console.warn('Live price update skipped:', err.message);
        });
    }

    fetchPrices();
    setInterval(fetchPrices, 45000); // refresh every 45s, well within CoinGecko's free rate limit
  })();
})();
