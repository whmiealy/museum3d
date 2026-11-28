/* =============================================================
 * 网站一键打印（2026-11-28，用户原话：“我直接点一个按钮就能跳转到连接到打印机的地方，就直接打印”）
 *
 * 资源库（museum3d/web）和三维展厅（项目40/public）共用这一个文件，内容完全一样，自己判断在哪个页面：
 *   · 三维展厅（有 window.__app）：截当前三维画面；正在看某件展品时，用这件展品的封面图 + 名字 + 编号
 *   · 资源库单件文物页 #/item/编号：这件文物的封面图 + 名字 + 编号
 *   · 资源库首页 / 分类 / 搜索结果：当前列表前 6 件的封面拼一张
 *   · 展馆列表：展馆封面
 * 点「🖨 打印」→ 马上排好纪念卡 → 调 window.print()，不多一步。浏览器一定会弹一次系统打印窗口（网页做不到不弹）。
 * 按钮旁的「▾」可以写名字、换纸张（A4 竖版 / 6 寸横版），不动就是 A4、名字空着（打出来可以手写）。
 * 不联网、不装东西；字体用电脑自带楷体，没有就用宋体。
 * 布老虎课件不在这里（课件不许公开上传，线上没有）。
 * ============================================================= */
(function () {
  'use strict';
  if (window.__oneClickPrint) return;
  window.__oneClickPrint = true;

  var FORMATS = {
    a4: { name: 'A4', page: '210mm 297mm', w: 210, h: 297 },
    six: { name: '6 寸', page: '152mm 102mm', w: 152, h: 102 },
  };
  var KEY_FORMAT = 'oneclick-print-format';
  var KEY_NAME = 'oneclick-print-name';
  var store = {
    get: function (s, k) { try { return s.getItem(k) || ''; } catch (e) { return ''; } },
    set: function (s, k, v) { try { s.setItem(k, v); } catch (e) { /* 无痕模式存不了，不要紧 */ } },
  };
  var format = FORMATS[store.get(localStorage, KEY_FORMAT)] ? store.get(localStorage, KEY_FORMAT) : 'a4';
  var visitor = store.get(sessionStorage, KEY_NAME);
  var isHall = function () { return !!(window.__app && window.__app.renderer); };
  // 资源上的相对路径：展厅在 hall/ 下，资源库在根目录
  var root = function () { return isHall() ? '../' : './'; };

  /* ---------------- 样式 ---------------- */
  var css = [
    '#ocp-bar{position:fixed;z-index:2147483000;top:max(10px,env(safe-area-inset-top));right:max(10px,env(safe-area-inset-right));',
    'display:flex;flex-direction:column;align-items:flex-end;gap:3px;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}',
    '#ocp-bar .ocp-row{display:flex;box-shadow:0 3px 12px rgba(0,0,0,.28);border-radius:22px}',
    '#ocp-go{border:0;margin:0;padding:9px 16px 9px 14px;border-radius:22px 0 0 22px;background:#b8231c;color:#fff6d8;font-size:16px;font-weight:700;',
    'cursor:pointer;line-height:1.2;letter-spacing:.05em;font-family:inherit}',
    '#ocp-go:hover{background:#9c1c16}#ocp-go:disabled{opacity:.7;cursor:wait}',
    '#ocp-more{border:0;margin:0;padding:9px 11px;border-radius:0 22px 22px 0;background:#8f1a14;color:#fff6d8;font-size:12px;cursor:pointer;font-family:inherit;line-height:1.2}',
    '#ocp-more .ocp-fmt{font-weight:700;margin-right:3px}',
    '#ocp-tip{font-size:11px;color:#fff;background:rgba(30,22,15,.62);padding:1px 8px;border-radius:8px;white-space:nowrap;pointer-events:none}',
    '#ocp-pop{display:none;width:236px;margin-top:4px;padding:12px 14px;border-radius:12px;background:#fffaf0;color:#2a1e14;box-shadow:0 8px 28px rgba(0,0,0,.3);font-size:14px}',
    '#ocp-bar.open #ocp-pop{display:block}',
    '#ocp-pop label{display:block;margin-bottom:10px}#ocp-pop small{color:#8a7560}',
    '#ocp-pop input{display:block;box-sizing:border-box;width:100%;margin-top:4px;padding:7px 9px;border:1px solid #c9b896;border-radius:8px;font-size:15px;background:#fff;color:#2a1e14}',
    '#ocp-pop .ocp-fmts{display:flex;gap:6px;margin-top:4px}',
    '#ocp-pop .ocp-fmts button{flex:1;padding:6px 0;border:1px solid #c9b896;border-radius:8px;background:#fff;color:#2a1e14;font-size:14px;cursor:pointer;font-family:inherit}',
    '#ocp-pop .ocp-fmts button.on{background:#2a1e14;color:#fff6d8;border-color:#2a1e14}',
    '#ocp-pop p{margin:10px 0 0;font-size:12px;color:#6b5844;line-height:1.5}',
    /* 资源库：放进顶栏最右边（换色按钮左边），不压住下面的排序和卡片 */
    '#ocp-bar.ocp-inline{position:relative;top:auto;right:auto;z-index:30;flex:none;align-items:center;gap:2px}',
    '#ocp-bar.ocp-inline .ocp-row{box-shadow:none}',
    '#ocp-bar.ocp-inline #ocp-go{padding:7px 12px 7px 11px;font-size:15px}#ocp-bar.ocp-inline #ocp-more{padding:7px 9px}',
    '#ocp-bar.ocp-inline #ocp-tip{background:none;color:inherit;opacity:.7;font-size:10.5px;padding:0;line-height:1.1}',
    '#ocp-bar.ocp-inline #ocp-pop{position:absolute;top:100%;right:0}',
    /* 手机/窄屏：顶栏第一行放不下，按钮挪到第二行搜索框右边 */
    '@media (max-width:820px){header.topbar .search{flex:1 1 calc(100% - 120px)!important;min-width:0}#ocp-bar.ocp-inline{order:11}}',
    '@media (max-width:560px){#ocp-bar.ocp-inline .ocp-fmt{display:none}#ocp-bar.ocp-inline #ocp-go{padding:6px 9px 6px 9px;font-size:14px}#ocp-bar.ocp-inline #ocp-more{padding:6px 7px}#ocp-bar.ocp-inline #ocp-tip{font-size:9.5px}}',
    /* 展厅：右上角原来是空的；手机上提示条两行，按钮在它下面不挡字 */
    'body.ocp-hall.touch #ocp-bar{top:calc(max(14px,env(safe-area-inset-top)) + 62px)}',
    '@media (max-width:560px){#ocp-go{font-size:15px;padding:8px 13px 8px 12px}#ocp-more{padding:8px 9px}}',

    /* 卡片：尺寸用毫米。平时藏在屏幕外，打印时才显示 */
    '#ocp-sheet{display:none}',
    '.ocp-sheet{position:relative;box-sizing:border-box;background:#fff;color:#2a1e14;overflow:hidden;',
    'font-family:"KaiTi","STKaiti","Kaiti SC","楷体","SimSun","Songti SC",serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}',
    '.ocp-sheet *{box-sizing:border-box;margin:0;padding:0}',
    '.ocp-frame{position:absolute;display:grid;border:.9mm solid #2a1e14;outline:.3mm solid #2a1e14;outline-offset:.8mm;background-color:#f6eedb;',
    'background-image:radial-gradient(ellipse at 30% 18%,rgba(255,255,255,.75),rgba(255,255,255,0) 55%),',
    'repeating-linear-gradient(97deg,rgba(140,105,60,.05) 0 .5mm,rgba(255,255,255,0) .5mm 1.9mm),',
    'repeating-linear-gradient(8deg,rgba(140,105,60,.03) 0 .4mm,rgba(255,255,255,0) .4mm 3.1mm)}',
    '.ocp-corner{position:absolute;width:7mm;height:7mm;border:.7mm solid #a8231c}',
    '.ocp-corner.tl{left:1.6mm;top:1.6mm;border-right:0;border-bottom:0}.ocp-corner.tr{right:1.6mm;top:1.6mm;border-left:0;border-bottom:0}',
    '.ocp-corner.bl{left:1.6mm;bottom:1.6mm;border-right:0;border-top:0}.ocp-corner.br{right:1.6mm;bottom:1.6mm;border-left:0;border-top:0}',
    '.ocp-head{grid-area:head;display:flex;align-items:center;min-width:0}',
    '.ocp-seal{flex:none;display:grid;grid-template-columns:1fr 1fr;place-items:center;background:#a8231c;color:#fff4d0;border-radius:1.2mm;',
    'box-shadow:inset 0 0 0 .6mm #a8231c,inset 0 0 0 .9mm #fff4d0;font-weight:bold}',
    '.ocp-seal span{line-height:1}',
    '.ocp-titles{min-width:0}.ocp-titles h1{font-weight:bold;letter-spacing:.1em;line-height:1.15;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.ocp-titles p{color:#4a3826;letter-spacing:.08em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.ocp-photo{grid-area:photo;position:relative;background:#fbf8f0;border:.4mm solid #2a1e14;padding:1.2mm;display:flex;align-items:center;justify-content:center;overflow:hidden;min-height:0;min-width:0}',
    '.ocp-photo>img,.ocp-photo>.ocp-grid{position:absolute;left:1.2mm;top:1.2mm;width:calc(100% - 2.4mm);height:calc(100% - 2.4mm)}',
    '.ocp-photo>img{object-fit:contain;display:block}',
    '.ocp-photo.cover>img{object-fit:cover}',
    '.ocp-grid{display:grid;gap:1.5mm}',
    '.ocp-grid figure{position:relative;min-height:0;min-width:0;background:#fff;border:.25mm solid #b8a888;display:flex;flex-direction:column}',
    '.ocp-grid img{flex:1;min-height:0;width:100%;object-fit:contain;display:block}',
    '.ocp-grid figcaption{flex:none;text-align:center;font-size:3mm;line-height:1.3;padding:.6mm 1mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-top:.25mm solid #e2d6bc}',
    '.ocp-info{grid-area:info;display:flex;flex-direction:column;justify-content:center;min-width:0}',
    '.ocp-line{display:flex;align-items:flex-end;gap:2mm;min-width:0}',
    '.ocp-line span{flex:none;color:#4a3826}',
    '.ocp-line b{flex:1;min-width:0;border-bottom:.35mm solid #2a1e14;text-align:center;font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.25;min-height:1.25em}',
    '.ocp-bless{color:#a8231c;font-weight:bold;letter-spacing:.3em}',
    '.ocp-foot{grid-area:foot;display:flex;flex-direction:column;justify-content:flex-end;color:#5b4936;font-family:"SimSun","Songti SC",serif}',
    /* A4 竖版 */
    '.ocp-sheet.a4 .ocp-frame{inset:12mm;padding:11mm 12mm 8mm;gap:7mm;grid-template:"head" auto "photo" 1fr "info" auto "foot" auto / 1fr}',
    '.ocp-sheet.a4 .ocp-seal{width:20mm;height:20mm;font-size:8.5mm;margin-right:6mm}',
    '.ocp-sheet.a4 .ocp-titles h1{font-size:13mm}.ocp-sheet.a4 .ocp-titles p{font-size:5.5mm;margin-top:2mm}',
    '.ocp-sheet.a4 .ocp-info{gap:5mm;padding:0 6mm}.ocp-sheet.a4 .ocp-line{font-size:6.5mm}.ocp-sheet.a4 .ocp-line b{font-size:8mm}',
    '.ocp-sheet.a4 .ocp-bless{font-size:7mm;text-align:center;margin-top:1mm}',
    '.ocp-sheet.a4 .ocp-foot{font-size:3.4mm;line-height:1.6;align-items:center;border-top:.25mm solid #b8a888;padding-top:3mm}',
    '.ocp-sheet.a4 .ocp-grid figcaption{font-size:3.6mm}',
    /* 6 寸横版（152×102）：左图，右字 */
    '.ocp-sheet.six .ocp-frame{inset:6mm;padding:6mm 6mm 4.5mm;gap:2.5mm 5mm;border-width:.6mm;outline-offset:.6mm;',
    'grid-template:"photo head" auto "photo info" 1fr "photo foot" auto / 1.45fr 1fr}',
    '.ocp-sheet.six .ocp-corner{width:4.5mm;height:4.5mm;border-width:.5mm}',
    '.ocp-sheet.six .ocp-corner.tl{left:1.2mm;top:1.2mm}.ocp-sheet.six .ocp-corner.tr{right:1.2mm;top:1.2mm}',
    '.ocp-sheet.six .ocp-corner.bl{left:1.2mm;bottom:1.2mm}.ocp-sheet.six .ocp-corner.br{right:1.2mm;bottom:1.2mm}',
    '.ocp-sheet.six .ocp-head{flex-direction:column;align-items:flex-start;gap:1.5mm}',
    '.ocp-sheet.six .ocp-seal{width:10mm;height:10mm;font-size:4.2mm}',
    '.ocp-sheet.six .ocp-titles{width:100%}.ocp-sheet.six .ocp-titles h1{font-size:6mm;letter-spacing:.06em;white-space:normal;',
    'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
    '.ocp-sheet.six .ocp-titles p{font-size:2.9mm;margin-top:.8mm;white-space:normal}',
    '.ocp-sheet.six .ocp-info{gap:2.6mm}.ocp-sheet.six .ocp-line{font-size:3.2mm;flex-direction:column;align-items:stretch;gap:.5mm}',
    '.ocp-sheet.six .ocp-line b{font-size:4.6mm;text-align:left;padding-left:1mm}',
    '.ocp-sheet.six .ocp-bless{font-size:3.4mm;letter-spacing:.12em}',
    '.ocp-sheet.six .ocp-foot{font-size:2.2mm;line-height:1.5}',
    '.ocp-sheet.six .ocp-grid{gap:1mm}.ocp-sheet.six .ocp-grid figcaption{font-size:2mm}',

    /* 真正打印：只留卡片 */
    '@media print{',
    'html.ocp-printing,html.ocp-printing body{margin:0!important;padding:0!important;background:#fff!important;width:auto!important;height:auto!important;',
    'min-height:0!important;overflow:visible!important}',
    'html.ocp-printing body>*:not(#ocp-sheet){display:none!important}',
    'html.ocp-printing #ocp-sheet{display:block!important;position:static!important}',
    'html.ocp-printing .ocp-sheet{max-width:100vw;max-height:100vh;page-break-after:avoid;break-after:avoid;page-break-inside:avoid;break-inside:avoid}',
    '}',
  ].join('');

  /* ---------------- 工具 ---------------- */
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'class') e.className = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  function today() {
    var d = new Date();
    return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
  }
  var catalogP = null;
  function catalog() {
    if (!catalogP) {
      catalogP = fetch(root() + 'data/catalog.json', { cache: 'no-cache' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }
    return catalogP;
  }
  function thumb(item) {
    return root() + 'items/' + encodeURIComponent(item.id) + '/thumb.webp' + (item.v ? '?v=' + item.v : '');
  }
  function libSite(cat) {
    var s = (cat && cat.site) || {};
    return { title: s.title || '三维资源库', sub: s.subtitle || '泥咕咕数字化存档' };
  }

  /* ---------------- 三维展厅截图 ---------------- */
  // 渲染器没开 preserveDrawingBuffer：同一段代码里先画一帧再马上取图，取到的就是这一帧
  function snapCanvas(renderer, scene, camera) {
    try {
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/jpeg', 0.92);
    } catch (e) {
      return null;
    }
  }

  /* ---------------- 这一页要打什么 ---------------- */
  // 返回 Promise<{title, sub, photo|grid, label?, value?, photoCover?}>
  function collect() {
    if (isHall()) {
      var app = window.__app;
      var v = app.viewer;
      if (v && v.isOpen) {
        var id = (document.querySelector('.viewer-id') || {}).textContent || '';
        var name = (document.querySelector('.viewer-name') || {}).textContent || '';
        var more = document.querySelector('.viewer-more');
        var itemId = more && !more.hidden ? decodeURIComponent((more.getAttribute('href') || '').split('/item/')[1] || '') : '';
        var fallback = v.renderer && v.scene && v.camera ? snapCanvas(v.renderer, v.scene, v.camera) : null;
        return catalog().then(function (cat) {
          var item = itemId && cat && (cat.items || []).find(function (it) { return it.id === itemId; });
          return {
            title: (item && item.name) || name || '展品',
            sub: '编号 ' + ((item && item.id) || id) + (item && item.category ? ' · ' + item.category.replace(/\//g, ' / ') : ''),
            photo: item && item.thumb ? thumb(item) : fallback,

            foot1: '泥玩世家——王蓝田祖孙三代展 · 三维展厅',
          };
        });
      }
      return Promise.resolve({
        title: '泥玩世家展厅',
        sub: '王蓝田祖孙三代展 · 三维展厅留影',
        photo: snapCanvas(app.renderer, app.scene, app.camera),
        foot1: '泥玩世家——王蓝田祖孙三代展 · 三维展厅',
      });
    }

    var hash = location.hash.replace(/^#/, '') || '/';
    var path = hash.split('?')[0];
    var parts = path.split('/').filter(Boolean).map(function (p) { try { return decodeURIComponent(p); } catch (e) { return p; } });
    return catalog().then(function (cat) {
      var site = libSite(cat);
      var items = (cat && cat.items) || [];
      if (parts[0] === 'item' && parts[1]) {
        var item = items.find(function (it) { return it.id === parts[1]; });
        if (item) {
          var img = item.thumb ? thumb(item) : (document.querySelector('main img') || {}).src;
          return {
            title: item.name,
            sub: '编号 ' + item.id + (item.category ? ' · ' + item.category.replace(/\//g, ' / ') : ''),
            photo: img,
            foot1: site.sub + ' · ' + site.title,
          };
        }
      }
      if (parts[0] === 'halls' || parts[0] === 'hall') {
        var hall = ((cat && cat.halls) || [])[0];
        if (hall) {
          return { title: hall.name, sub: site.sub + ' · 展馆漫游', photo: hall.cover ? root() + hall.cover : null,
            foot1: site.sub + ' · ' + site.title };
        }
      }
      // 首页 / 分类 / 搜索：用屏幕上正在显示的前 6 件（跟着筛选走）
      var shown = [];
      document.querySelectorAll('main a[href^="#/item/"]').forEach(function (a) {
        var id = decodeURIComponent(a.getAttribute('href').slice(7));
        if (shown.indexOf(id) === -1) shown.push(id);
      });
      var pick = shown.map(function (id) { return items.find(function (it) { return it.id === id; }); })
        .filter(function (it) { return it && it.thumb; });
      if (!pick.length) pick = items.filter(function (it) { return it.thumb; });
      pick = pick.slice(0, 6);
      var heading = (document.querySelector('main h1') || {}).textContent || '';
      return {
        title: site.sub,
        sub: site.title + ' · ' + (heading && heading.length < 20 ? heading : '藏品选'),
        grid: pick.map(function (it) { return { src: thumb(it), cap: it.id + ' ' + it.name }; }),
        foot1: site.sub + ' · ' + site.title,
      };
    });
  }

  /* ---------------- 排版 ---------------- */
  var sheetHost, pageStyle;
  function build(d) {
    var F = FORMATS[format];
    var photo;
    if (d.grid && d.grid.length) {
      var n = d.grid.length;
      var cols = format === 'six' ? (n <= 1 ? 1 : n <= 4 ? 2 : 3) : (n <= 1 ? 1 : n <= 4 ? 2 : 3);
      var rows = Math.ceil(n / cols);
      if (format === 'a4' && n > 4) { cols = 2; rows = 3; }
      var grid = h('div', { class: 'ocp-grid', style: 'grid-template-columns:repeat(' + cols + ',1fr);grid-template-rows:repeat(' + rows + ',1fr)' },
        d.grid.map(function (g) { return h('figure', null, [h('img', { src: g.src, alt: g.cap }), h('figcaption', { text: g.cap })]); }));
      photo = h('div', { class: 'ocp-photo' }, [grid]);
    } else {
      photo = h('div', { class: 'ocp-photo' + (d.photoCover ? ' cover' : '') }, d.photo ? [h('img', { src: d.photo, alt: d.title })] : []);
    }
    var lines = [
      h('div', { class: 'ocp-line' }, [h('span', { text: '参观者' }), h('b', { text: visitor })]),
      h('div', { class: 'ocp-line' }, [h('span', { text: '参观日期' }), h('b', { text: today() })]),
    ];
    lines.push(h('p', { class: 'ocp-bless', text: '泥土有灵　手艺传家' }));
    var sheet = h('div', { class: 'ocp-sheet ' + format, style: 'width:' + F.w + 'mm;height:calc(' + F.h + 'mm - .5mm)' }, [
      h('div', { class: 'ocp-frame' }, [
        h('i', { class: 'ocp-corner tl' }), h('i', { class: 'ocp-corner tr' }), h('i', { class: 'ocp-corner bl' }), h('i', { class: 'ocp-corner br' }),
        h('header', { class: 'ocp-head' }, [
          h('div', { class: 'ocp-seal' }, ['泥', '玩', '世', '家'].map(function (c) { return h('span', { text: c }); })),
          h('div', { class: 'ocp-titles' }, [h('h1', { text: d.title }), h('p', { text: d.sub })]),
        ]),
        photo,
        h('div', { class: 'ocp-info' }, lines),
        h('footer', { class: 'ocp-foot' }, [h('span', { text: d.foot1 }), h('span', { text: 'shmiealy.top　在手机上也能逛三维展厅' })]),
      ]),
    ]);
    sheetHost.replaceChildren(sheet);
    // 高度少 0.5 毫米：正好一页时有的打印机会多出一张白纸
    pageStyle.textContent = '@page{size:' + F.page + ';margin:0}';
    return Array.prototype.slice.call(sheet.querySelectorAll('img'));
  }

  function waitImages(imgs) {
    return Promise.all(imgs.map(function (img) {
      if (img.complete && img.naturalWidth) return img.decode ? img.decode().catch(function () {}) : null;
      return new Promise(function (res) {
        img.addEventListener('load', res, { once: true });
        img.addEventListener('error', res, { once: true });
        setTimeout(res, 5000);
      }).then(function () { return img.decode ? img.decode().catch(function () {}) : null; });
    }));
  }

  /* ---------------- 按钮 ---------------- */
  var bar, go, fmtLabel, busy = false;
  function cleanup() {
    document.documentElement.classList.remove('ocp-printing');
    busy = false;
    if (go) { go.disabled = false; go.textContent = '🖨 打印'; }
  }
  function printNow() {
    if (busy) return;
    busy = true;
    bar.classList.remove('open');
    go.disabled = true;
    go.textContent = '准备中…';
    collect().then(function (d) {
      return waitImages(build(d));
    }).then(function () {
      document.documentElement.classList.add('ocp-printing');
      go.textContent = '🖨 打印';
      window.print();
      // 有的浏览器 print() 马上返回、afterprint 不一定触发，这里兜底
      setTimeout(cleanup, 1500);
    }).catch(function (e) {
      console.warn('一键打印出错：', e);
      cleanup();
    });
  }
  function setFormat(f) {
    format = f;
    store.set(localStorage, KEY_FORMAT, f);
    if (fmtLabel) fmtLabel.textContent = FORMATS[f].name;
    if (bar) bar.querySelectorAll('.ocp-fmts button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-f') === f); });
  }

  function mount() {
    var style = h('style', { id: 'ocp-style' });
    style.textContent = css;
    document.head.appendChild(style);
    pageStyle = document.head.appendChild(h('style', { id: 'ocp-page' }));
    sheetHost = h('div', { id: 'ocp-sheet', 'aria-hidden': 'true' });
    document.body.appendChild(sheetHost);
    document.body.classList.add(isHall() || location.pathname.indexOf('/hall/') !== -1 ? 'ocp-hall' : 'ocp-lib');

    go = h('button', { id: 'ocp-go', type: 'button', title: '打印纪念卡（弹出系统打印窗口后按「打印」）', text: '🖨 打印' });
    fmtLabel = h('span', { class: 'ocp-fmt', text: FORMATS[format].name });
    var more = h('button', { id: 'ocp-more', type: 'button', 'aria-label': '写名字、换纸张', 'aria-expanded': 'false' }, [fmtLabel, document.createTextNode('▾')]);
    var nameInput = h('input', { maxlength: '12', placeholder: '例如：王小明', autocomplete: 'off' });
    nameInput.value = visitor;
    var pop = h('div', { id: 'ocp-pop' }, [
      h('label', null, [document.createTextNode('写上名字'), h('small', { text: '（不写也行，可以手写）' }), nameInput]),
      h('div', null, [document.createTextNode('纸张'), h('div', { class: 'ocp-fmts' }, [
        h('button', { type: 'button', 'data-f': 'a4', text: 'A4 竖版' }),
        h('button', { type: 'button', 'data-f': 'six', text: '6 寸照片纸' }),
      ])]),
      h('p', { text: '点「🖨 打印」会弹出系统打印窗口，按「打印」就行。打印机设成默认，以后每次直接按。' }),
    ]);
    bar = h('div', { id: 'ocp-bar' }, [
      h('div', { class: 'ocp-row' }, [go, more]),
      h('div', { id: 'ocp-tip', text: '弹出后按「打印」' }),
      pop,
    ]);
    var topbar = document.querySelector('header.topbar');
    var theme = document.getElementById('themeBtn');
    if (!isHall() && topbar) {
      bar.classList.add('ocp-inline');
      topbar.insertBefore(bar, theme && theme.parentNode === topbar ? theme : null);
    } else {
      document.body.appendChild(bar);
    }

    go.addEventListener('click', printNow);
    more.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = !bar.classList.contains('open');
      bar.classList.toggle('open', open);
      more.setAttribute('aria-expanded', String(open));
    });
    pop.querySelectorAll('.ocp-fmts button').forEach(function (b) {
      b.addEventListener('click', function () { setFormat(b.getAttribute('data-f')); });
    });
    nameInput.addEventListener('input', function () {
      visitor = nameInput.value.trim();
      store.set(sessionStorage, KEY_NAME, visitor);
    });
    // 展厅里键盘事件别传给展厅（WASD 走路），点按钮也别当成点地面走路
    ['keydown', 'keyup', 'keypress'].forEach(function (t) { nameInput.addEventListener(t, function (e) { e.stopPropagation(); }); });
    ['pointerdown', 'mousedown', 'touchstart', 'click', 'wheel'].forEach(function (t) {
      bar.addEventListener(t, function (e) { e.stopPropagation(); }, { passive: true });
    });
    document.addEventListener('click', function (e) { if (!bar.contains(e.target)) bar.classList.remove('open'); });
    addEventListener('afterprint', cleanup);
    setFormat(format);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
