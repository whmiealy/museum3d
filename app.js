/* 三维资源库前端：hash 路由的单页应用，原生 JS，无构建步骤。 */
(function () {
  "use strict";

  /* 版本和 m3d/vendor.py 保持一致 */
  var LIBS = {
    modelViewer: { local: "vendor/model-viewer.min.js", cdn: "https://cdn.jsdelivr.net/npm/@google/model-viewer@4.4.0/dist/model-viewer.min.js" },
    meshopt: { local: "vendor/meshopt_decoder.js", cdn: "https://cdn.jsdelivr.net/npm/meshoptimizer@0.25.0/meshopt_decoder.js" },
    draco: { local: "vendor/draco/", probe: "vendor/draco/draco_decoder.js", cdn: "https://cdn.jsdelivr.net/npm/three@0.183.0/examples/jsm/libs/draco/gltf/" },
  };

  var SOURCES = {
    photo: { label: "实拍重建", note: "此模型由实拍照片或视频重建，形状和纹理来自真实拍摄。" },
    ai: { label: "AI 生成", note: "此模型由 AI 根据少量照片推测生成，细节可能与实物不同。" },
    provided: { label: "用户提供", note: "此模型由资料提供方直接提供，未经本系统重建。" },
    spin: { label: "仅照片", note: "素材不足以生成三维模型，这里展示的是拖动切换的实拍照片。" },
    failed: { label: "建模未完成", note: "这件的三维模型正在处理中，暂时先看拖动切换的实拍照片。" },
    none: { label: "暂无素材", note: "这件物品还没有可展示的影像素材。" },
  };
  var PAGE_SIZE = 48;

  var S = window.M3DSearch;
  var app = document.getElementById("app");
  var catalog = null;
  var state = { query: "", category: "", methods: [], tags: [], sort: "id" };
  var filtered = [];
  var cleanups = [];
  var searchTimer = 0;

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      var value = attrs[key];
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key.slice(0, 2) === "on") node.addEventListener(key.slice(2), value);
      else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value === true ? "" : value);
    });
    [].concat(children || []).forEach(function (child) {
      if (child) node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
  }

  /* 站内相对地址（如 hall/）：不用新窗口，直接进入 */
  function isLocalUrl(url) {
    return !!url && !/^[a-z]+:|^\/\//i.test(url);
  }

  function assetBase(id) {
    return "items/" + encodeURIComponent(id) + "/";
  }

  /* 重建后同名文件内容会变，带上版本号避免浏览器和 GitHub Pages 的缓存继续显示旧模型 */
  function ver(item) {
    return "?v=" + (item.v || 0);
  }

  function itemHash(id) {
    return "#/item/" + encodeURIComponent(id);
  }

  function addCleanup(fn) {
    cleanups.push(fn);
  }

  function runCleanups() {
    cleanups.splice(0).forEach(function (fn) {
      fn();
    });
    document.body.classList.remove("hall-mode", "locked");
  }

  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      /* 隐私模式下不可写，主题只是当次有效 */
    }
  }

  /* ---------- 脚本加载：本地优先，失败再走 CDN ---------- */

  function loadScript(src, isModule) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      if (isModule) script.type = "module";
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function exists(url) {
    return fetch(url, { method: "HEAD" }).then(function (r) {
      return r.ok;
    }).catch(function () {
      return false;
    });
  }

  var viewerReady = null;
  function loadModelViewer() {
    if (viewerReady) return viewerReady;
    viewerReady = loadScript(LIBS.modelViewer.local, true)
      .catch(function () {
        return loadScript(LIBS.modelViewer.cdn, true);
      })
      .then(function () {
        return customElements.whenDefined("model-viewer");
      })
      .then(function () {
        return Promise.all([exists(LIBS.meshopt.local), exists(LIBS.draco.probe)]);
      })
      .then(function (found) {
        /* 必须在第一次加载模型前设置，否则会去访问海外默认地址 */
        var Viewer = customElements.get("model-viewer");
        Viewer.meshoptDecoderLocation = found[0] ? LIBS.meshopt.local : LIBS.meshopt.cdn;
        Viewer.dracoDecoderLocation = found[1] ? new URL(LIBS.draco.local, location.href).href : LIBS.draco.cdn;
      });
    return viewerReady;
  }

  /* ---------- 首页 ---------- */

  function syncHashFilter(query) {
    state.category = query.get("cat") || "";
  }

  function sourceCounts() {
    var counts = {};
    catalog.items.forEach(function (item) {
      counts[item.method] = (counts[item.method] || 0) + 1;
    });
    return counts;
  }

  function topTags() {
    var counts = {};
    catalog.items.forEach(function (item) {
      item.tags.forEach(function (tag) {
        counts[tag] = (counts[tag] || 0) + 1;
      });
    });
    return Object.keys(counts).sort(function (a, b) {
      return counts[b] - counts[a] || a.localeCompare(b, "zh-Hans-CN");
    }).slice(0, 30);
  }

  function goCategory(path) {
    closeDrawer();
    location.hash = path ? "#/?cat=" + encodeURIComponent(path) : "#/";
  }

  function categoryNode(node) {
    return el("li", {}, [
      el("button", {
        class: "cat-link" + (state.category === node.path ? " active" : ""),
        onclick: function () {
          goCategory(node.path);
        },
      }, [el("span", { text: node.name }), el("span", { class: "num", text: String(node.count) })]),
      node.children.length ? el("ul", {}, node.children.map(categoryNode)) : null,
    ]);
  }

  function toggle(list, value) {
    var at = list.indexOf(value);
    if (at === -1) list.push(value);
    else list.splice(at, 1);
  }

  function chip(label, pressed, onclick) {
    return el("button", { class: "chip", "aria-pressed": pressed ? "true" : "false", text: label, onclick: onclick });
  }

  function renderSidebar() {
    var counts = sourceCounts();
    var all = el("button", {
      class: "cat-link" + (state.category ? "" : " active"),
      onclick: function () {
        goCategory("");
      },
    }, [el("span", { text: "全部" }), el("span", { class: "num", text: String(catalog.items.length) })]);

    var sources = Object.keys(SOURCES).filter(function (key) {
      return counts[key];
    }).map(function (key) {
      return chip(SOURCES[key].label + " " + counts[key], state.methods.indexOf(key) !== -1, function () {
        toggle(state.methods, key);
        renderHome();
      });
    });
    var tags = topTags().map(function (tag) {
      return chip(tag, state.tags.indexOf(tag) !== -1, function () {
        toggle(state.tags, tag);
        renderHome();
      });
    });

    return el("aside", { class: "sidebar", id: "sidebar" }, [
      el("h2", { text: "分类" }),
      el("ul", { class: "cat-list" }, [el("li", {}, all)].concat(catalog.categories.map(categoryNode))),
      sources.length ? el("h2", { text: "来源" }) : null,
      sources.length ? el("div", { class: "chips" }, sources) : null,
      tags.length ? el("h2", { text: "标签" }) : null,
      tags.length ? el("div", { class: "chips" }, tags) : null,
    ]);
  }

  function marked(text, terms) {
    var frag = document.createDocumentFragment();
    S.highlight(text, terms).forEach(function (part) {
      frag.appendChild(part.hit ? el("mark", { text: part.text }) : document.createTextNode(part.text));
    });
    return frag;
  }

  function placeholder(text) {
    return el("div", { class: "placeholder" }, [
      el("span", { class: "dots", "aria-hidden": "true" }, [el("i"), el("i"), el("i")]),
    ].concat(text ? [] : []));
  }

  function card(item, terms) {
    var name = el("div", { class: "card-name" });
    name.appendChild(marked(item.name, terms));
    var code = el("div", { class: "card-id" });
    code.appendChild(marked(item.id, terms));
    var cat = el("div", { class: "card-cat" });
    cat.appendChild(marked(item.category, terms));
    var hit = terms.length ? S.snippet(item, terms) : "";
    var media = item.thumb
      ? el("img", { src: assetBase(item.id) + "thumb.webp" + ver(item), alt: item.name, loading: "lazy", decoding: "async", width: 480, height: 480 })
      : placeholder();
    var snippet = null;
    if (hit) {
      snippet = el("div", { class: "card-hit" });
      snippet.appendChild(marked(hit, terms));
    }
    return el("a", { class: "card", href: itemHash(item.id) }, [
      el("div", { class: "card-media" }, [media, el("span", { class: "badge " + item.method, text: SOURCES[item.method].label })]),
      el("div", { class: "card-body" }, [code, name, cat, snippet]),
    ]);
  }

  function renderGrid(container, more, terms) {
    var shown = 0;
    function addPage() {
      var frag = document.createDocumentFragment();
      filtered.slice(shown, shown + PAGE_SIZE).forEach(function (item) {
        frag.appendChild(card(item, terms));
      });
      shown += PAGE_SIZE;
      container.appendChild(frag);
      if (shown >= filtered.length && observer) observer.disconnect();
    }
    var observer = "IntersectionObserver" in window
      ? new IntersectionObserver(function (entries) {
          if (entries[0].isIntersecting) addPage();
        }, { rootMargin: "600px" })
      : null;
    addPage();
    if (observer && shown < filtered.length) {
      observer.observe(more);
      addCleanup(function () {
        observer.disconnect();
      });
    } else if (!observer) {
      while (shown < filtered.length) addPage();
    }
  }

  function renderResults(results) {
    var previous = cleanups.splice(0);
    previous.forEach(function (fn) {
      fn();
    });
    filtered = S.filterItems(catalog.items, state);
    var terms = S.parseQuery(state.query);
    var title = state.category || "全部藏品";
    var sort = el("select", {
      "aria-label": "排序",
      onchange: function (event) {
        state.sort = event.target.value;
        renderResults(results);
      },
    }, [["id", "编号"], ["name", "名称"], ["newest", "最新"]].map(function (pair) {
      return el("option", { value: pair[0], selected: state.sort === pair[0], text: pair[1] });
    }));
    var grid = el("div", { class: "grid" });
    var more = el("div", { class: "more" });
    results.replaceChildren(
      el("div", { class: "toolbar" }, [
        el("h1", {}, [title, el("span", { class: "count", text: "共 " + filtered.length + " 件" })]),
        el("label", { class: "sort" }, ["排序", sort]),
      ]),
      filtered.length ? grid : el("p", { class: "status", text: "没有找到符合条件的物品" }),
      more
    );
    if (filtered.length) renderGrid(grid, more, terms);
  }

  function renderHome() {
    runCleanups();
    var results = el("section", { class: "results" });
    var sidebar = renderSidebar();
    app.replaceChildren(el("div", { class: "layout" }, [sidebar, results]));
    renderResults(results);
  }

  function refreshResults() {
    var results = app.querySelector(".results");
    if (results) renderResults(results);
    else location.hash = "#/";
  }

  /* ---------- 抽屉 ---------- */

  var menuBtn = document.getElementById("menuBtn");
  var scrim = document.getElementById("scrim");

  function closeDrawer() {
    var sidebar = document.getElementById("sidebar");
    if (sidebar) sidebar.classList.remove("open");
    scrim.hidden = true;
    menuBtn.setAttribute("aria-expanded", "false");
  }

  /* ---------- 360 旋转 ---------- */

  function spinViewer(item, stage) {
    var count = item.spin;
    var base = assetBase(item.id) + "spin/";
    var images = [];
    var loaded = 0;
    var frame = 0;
    var position = 0;
    var velocity = 0;
    var dragging = false;
    var lastX = 0;
    var lastT = 0;
    var raf = 0;

    var canvas = el("canvas", { width: 1000, height: 1000, "aria-label": item.name + " 360 度旋转图" });
    var ctx = canvas.getContext("2d");
    var bar = el("i");
    var hint = el("div", { class: "hint", text: "左右拖动旋转" });
    var box = el("div", { class: "spin", tabindex: 0 }, canvas);
    var progress = el("div", { class: "progress" }, bar);
    stage.replaceChildren(box, progress, hint);

    function pxPerFrame() {
      /* 拖过舞台宽度约转一圈 */
      return Math.max(2, box.clientWidth / count);
    }

    function draw() {
      var index = ((Math.round(position) % count) + count) % count;
      var img = images[index];
      if (img && img.complete && img.naturalWidth) {
        var side = Math.max(canvas.width, canvas.height);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, (canvas.width - side) / 2, (canvas.height - side) / 2, side, side);
        frame = index;
      }
    }

    function fit() {
      var ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(box.clientWidth * ratio);
      canvas.height = Math.round(box.clientHeight * ratio);
      draw();
    }

    function coast() {
      if (dragging || Math.abs(velocity) < 0.02) {
        raf = 0;
        return;
      }
      position += velocity;
      velocity *= 0.95;
      draw();
      raf = requestAnimationFrame(coast);
    }

    function down(event) {
      dragging = true;
      velocity = 0;
      lastX = event.clientX;
      lastT = performance.now();
      box.classList.add("dragging");
      box.setPointerCapture(event.pointerId);
      hint.hidden = true;
    }

    function move(event) {
      if (!dragging) return;
      var now = performance.now();
      var delta = (event.clientX - lastX) / pxPerFrame();
      position -= delta;
      velocity = -delta * (16 / Math.max(now - lastT, 8));
      lastX = event.clientX;
      lastT = now;
      draw();
    }

    function up() {
      if (!dragging) return;
      dragging = false;
      box.classList.remove("dragging");
      if (performance.now() - lastT > 80) velocity = 0;
      velocity = Math.max(-1.2, Math.min(1.2, velocity));
      if (!raf) raf = requestAnimationFrame(coast);
    }

    box.addEventListener("pointerdown", down);
    box.addEventListener("pointermove", move);
    box.addEventListener("pointerup", up);
    box.addEventListener("pointercancel", up);
    box.addEventListener("keydown", function (event) {
      if (event.key === "ArrowLeft") position -= 1;
      else if (event.key === "ArrowRight") position += 1;
      else return;
      event.preventDefault();
      draw();
    });

    for (var i = 0; i < count; i++) {
      var img = new Image();
      img.decoding = "async";
      img.onload = img.onerror = function () {
        loaded += 1;
        bar.style.width = (loaded / count) * 100 + "%";
        if (loaded === count) progress.hidden = true;
        draw();
      };
      img.src = base + String(i).padStart(3, "0") + ".webp" + ver(item);
      images.push(img);
    }

    var observer = new ResizeObserver(fit);
    observer.observe(box);
    fit();

    return function () {
      observer.disconnect();
      cancelAnimationFrame(raf);
      images.forEach(function (image) {
        image.onload = image.onerror = null;
      });
      return frame;
    };
  }

  /* ---------- 三维模型 ---------- */

  function modelViewer(item, stage, onFail) {
    var bar = el("i");
    var progress = el("div", { class: "progress" }, bar);
    var note = el("div", { class: "stage-note", text: "正在加载三维查看器……" });
    stage.replaceChildren(progress, note);
    var cancelled = false;

    function enterFull() {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else if (stage.requestFullscreen) {
        stage.requestFullscreen().catch(fakeFull);
      } else {
        fakeFull();
      }
    }

    function fakeFull() {
      /* iPhone Safari 没有元素全屏，用铺满视口代替 */
      stage.classList.toggle("fake-full");
      document.body.classList.toggle("locked", stage.classList.contains("fake-full"));
    }

    loadModelViewer().then(function () {
      if (cancelled) return;
      var viewer = el("model-viewer", {
        src: assetBase(item.id) + "model.glb" + ver(item),
        alt: item.name + " 三维模型",
        "camera-controls": true,
        "auto-rotate": true,
        "auto-rotate-delay": 1500,
        "rotation-per-second": "20deg",
        "touch-action": "pan-y",
        "interaction-prompt": "none",
        "shadow-intensity": 1,
        exposure: 1,
        "environment-image": "neutral",
        loading: "eager",
        ar: true,
        "ar-modes": "webxr scene-viewer quick-look",
      });
      var auto = el("button", {
        class: "tool",
        "aria-pressed": "true",
        text: "自动旋转",
        onclick: function () {
          var on = !viewer.autoRotate;
          viewer.autoRotate = on;
          auto.setAttribute("aria-pressed", String(on));
        },
      });
      var reset = el("button", {
        class: "tool",
        text: "重置视角",
        onclick: function () {
          viewer.cameraOrbit = viewer.getAttribute("camera-orbit") || "0deg 75deg 105%";
          viewer.cameraTarget = "auto auto auto";
          viewer.fieldOfView = "auto";
          viewer.resetTurntableRotation();
          viewer.jumpCameraToGoal();
        },
      });
      var full = el("button", { class: "tool", text: "全屏", onclick: enterFull });
      var ar = el("button", { class: "tool ar-btn", slot: "ar-button", text: "AR 查看" });
      viewer.appendChild(ar);

      viewer.addEventListener("progress", function (event) {
        var value = event.detail.totalProgress;
        bar.style.width = value * 100 + "%";
        if (value >= 1) progress.hidden = true;
      });
      viewer.addEventListener("load", function () {
        note.remove();
      });
      viewer.addEventListener("error", function () {
        if (onFail) onFail();
      });

      stage.append(viewer, el("div", { class: "stage-tools" }, [auto, reset, full]));
      note.textContent = "";
    }).catch(function () {
      note.textContent = "三维查看器加载失败，请检查网络后刷新";
    });

    return function () {
      cancelled = true;
      if (document.fullscreenElement) document.exitFullscreen();
      stage.classList.remove("fake-full");
      document.body.classList.remove("locked");
    };
  }

  /* ---------- 照片 ---------- */

  function photoName(index, thumb) {
    return (thumb ? "t_" : "") + String(index).padStart(3, "0") + ".webp";
  }

  function lightbox(item, start) {
    var base = assetBase(item.id) + "photos/";
    var index = start;
    var img = el("img", { alt: item.name });
    var pos = el("div", { class: "pos" });
    var box;

    function show(next) {
      index = (next + item.photos) % item.photos;
      img.src = base + photoName(index) + ver(item);
      pos.textContent = index + 1 + " / " + item.photos;
    }

    function close() {
      document.removeEventListener("keydown", keys);
      document.body.classList.remove("locked");
      box.remove();
    }

    function keys(event) {
      if (event.key === "Escape") close();
      if (event.key === "ArrowLeft") show(index - 1);
      if (event.key === "ArrowRight") show(index + 1);
    }

    var startX = 0;
    box = el("div", {
      class: "lightbox",
      role: "dialog",
      "aria-label": "查看大图",
      onpointerdown: function (event) {
        startX = event.clientX;
      },
      onpointerup: function (event) {
        var dx = event.clientX - startX;
        if (Math.abs(dx) > 50) show(index + (dx < 0 ? 1 : -1));
      },
      onclick: function (event) {
        if (event.target === box) close();
      },
    }, [
      img,
      pos,
      el("button", { class: "icon-btn close", "aria-label": "关闭", text: "✕", onclick: close }),
      el("button", {
        class: "icon-btn prev", "aria-label": "上一张", text: "‹",
        onclick: function () {
          show(index - 1);
        },
      }),
      el("button", {
        class: "icon-btn next", "aria-label": "下一张", text: "›",
        onclick: function () {
          show(index + 1);
        },
      }),
    ]);
    document.addEventListener("keydown", keys);
    document.body.classList.add("locked");
    document.body.appendChild(box);
    addCleanup(close);
    show(start);
  }

  function photoGrid(item, holder) {
    var base = assetBase(item.id) + "photos/";
    var buttons = [];
    for (var i = 0; i < item.photos; i++) {
      (function (index) {
        buttons.push(el("button", {
          "aria-label": "查看第 " + (index + 1) + " 张",
          onclick: function () {
            lightbox(item, index);
          },
        }, el("img", { src: base + photoName(index, true) + ver(item), alt: "", loading: "lazy", decoding: "async" })));
      })(i);
    }
    holder.replaceChildren(el("div", { class: "gallery" }, buttons));
  }

  /* ---------- 详情页 ---------- */

  function tabsFor(item) {
    var tabs = [];
    if (item.model) tabs.push({ key: "model", label: "三维模型" });
    if (item.spin) tabs.push({ key: "spin", label: "360 旋转" });
    if (item.photos) tabs.push({ key: "photos", label: "照片" });
    if (item.videos.length) tabs.push({ key: "video", label: "视频" });
    return tabs;
  }

  function renderViewer(item, holder) {
    var tabs = tabsFor(item);
    if (!tabs.length) {
      holder.replaceChildren(el("div", { class: "stage" }, el("div", { class: "stage-note", text: "这件物品还没有可展示的素材" })));
      return;
    }
    var body = el("div");
    var buttons = {};
    var stop = null;

    function open(key) {
      if (stop) stop();
      stop = null;
      Object.keys(buttons).forEach(function (k) {
        buttons[k].setAttribute("aria-selected", String(k === key));
      });
      if (key === "photos") {
        photoGrid(item, body);
        return;
      }
      if (key === "video") {
        body.replaceChildren(el("div", { class: "video-wrap" }, item.videos.map(function (name) {
          return el("video", { src: assetBase(item.id) + name + ver(item), controls: true, playsinline: true, preload: "metadata" });
        })));
        return;
      }
      var stage = el("div", { class: "stage" });
      body.replaceChildren(stage);
      if (key === "model") {
        stop = modelViewer(item, stage, function () {
          stage.replaceChildren(el("div", { class: "stage-note", text: "模型加载失败" }));
          if (item.spin) open("spin");
        });
      } else {
        stop = spinViewer(item, stage);
      }
    }

    var tablist = el("div", { class: "tabs", role: "tablist" }, tabs.map(function (tab) {
      buttons[tab.key] = el("button", {
        class: "tab", role: "tab", text: tab.label,
        onclick: function () {
          open(tab.key);
        },
      });
      return buttons[tab.key];
    }));
    if (tabs.length > 1) holder.appendChild(tablist);
    holder.appendChild(body);
    addCleanup(function () {
      if (stop) stop();
    });
    open(tabs[0].key);
  }

  function copyText(text, done) {
    function fallback() {
      var area = el("textarea", { readonly: true });
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand("copy");
        done();
      } finally {
        area.remove();
      }
    }
    /* 局域网 http 下没有 navigator.clipboard */
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  }

  function renderItem(id) {
    runCleanups();
    var item = catalog.items.find(function (it) {
      return it.id === id;
    });
    if (!item) {
      app.replaceChildren(el("p", { class: "status" }, ["找不到这件物品。", el("a", { href: "#/", text: "返回首页" })]));
      return;
    }
    document.title = item.name + " · " + catalog.site.title;

    var source = SOURCES[item.method];
    var chain = item.category.split("/");
    var crumbs = [el("button", {
      text: "全部",
      onclick: function () {
        goCategory("");
      },
    })];
    chain.forEach(function (part, i) {
      crumbs.push(el("span", { text: "/" }));
      crumbs.push(el("button", {
        text: part,
        onclick: function () {
          goCategory(chain.slice(0, i + 1).join("/"));
        },
      }));
    });

    var facts = [["编号", item.id], ["尺寸", item.size], ["作者", item.maker], ["日期", item.date]];
    Object.keys(item.fields).forEach(function (key) {
      facts.push([key, item.fields[key]]);
    });
    var factNodes = [];
    facts.filter(function (pair) {
      return pair[1];
    }).forEach(function (pair) {
      factNodes.push(el("dt", { text: pair[0] }), el("dd", { text: pair[1] }));
    });

    var list = filtered.length && filtered.some(function (it) {
      return it.id === id;
    }) ? filtered : S.filterItems(catalog.items, { sort: "id" });
    var at = list.findIndex(function (it) {
      return it.id === id;
    });
    function pagerLink(target, prefix, cls) {
      return target
        ? el("a", { class: cls, href: itemHash(target.id), text: prefix + target.name })
        : el("span", { class: cls, text: prefix + "没有了" });
    }

    var copied = el("button", {
      class: "btn",
      text: "复制链接",
      onclick: function () {
        copyText(location.href, function () {
          copied.textContent = "已复制";
          setTimeout(function () {
            copied.textContent = "复制链接";
          }, 1500);
        });
      },
    });

    var inHall = item.inHall
      ? el("a", { class: "btn", href: "hall/#item=" + encodeURIComponent(item.id), text: "在展馆中查看" })
      : null;

    var viewer = el("div", { class: "viewer" });
    app.replaceChildren(el("div", { class: "detail" }, [
      el("nav", { class: "crumb", "aria-label": "分类路径" }, crumbs),
      el("div", { class: "detail-grid" }, [
        viewer,
        el("aside", { class: "info" }, [
          el("div", { class: "code", text: item.id }),
          el("h1", { text: item.name }),
          el("div", { class: "source " + item.method }, [
            el("div", {}, el("span", { class: "badge " + item.method, text: source.label })),
            el("div", { text: source.note }),
          ]),
          item.description ? el("p", { class: "desc", text: item.description }) : null,
          item.tags.length ? el("div", { class: "tags" }, item.tags.map(function (tag) {
            return el("button", {
              class: "chip",
              text: tag,
              onclick: function () {
                state.query = "";
                searchInput.value = "";
                state.tags = [tag];
                location.hash = "#/";
              },
            });
          })) : null,
          el("dl", { class: "facts" }, factNodes),
          el("div", { class: "share" }, [
            el("img", { src: "qr/" + encodeURIComponent(item.id) + ".png", alt: "本页二维码", loading: "lazy" }),
            el("div", { class: "share-text" }, [el("span", { text: "扫码在手机上查看" }), copied, inHall]),
          ]),
          el("div", { class: "pager" }, [
            pagerLink(list[at - 1], "← ", "prev-link"),
            pagerLink(list[at + 1], "→ ", "next-link"),
          ]),
        ]),
      ]),
    ]));
    renderViewer(item, viewer);
    window.scrollTo(0, 0);
  }

  /* ---------- 展馆 ---------- */

  function renderHalls() {
    runCleanups();
    document.title = "展馆 · " + catalog.site.title;
    var cards = catalog.halls.map(function (hall) {
      return el("a", { class: "hall-card", href: isLocalUrl(hall.url) ? hall.url : "#/hall/" + encodeURIComponent(hall.id) }, [
        el("div", { class: "cover" }, hall.cover ? el("img", { src: hall.cover, alt: hall.name, loading: "lazy" }) : placeholder()),
        el("div", { class: "text" }, [el("h2", { text: hall.name }), el("p", { text: hall.description })]),
      ]);
    });
    app.replaceChildren(el("div", { class: "page" }, [
      el("h1", { text: "展馆漫游" }),
      cards.length ? el("div", { class: "hall-grid" }, cards) : el("p", { class: "status", text: "还没有登记展馆" }),
    ]));
  }

  function renderHall(id) {
    runCleanups();
    var hall = catalog.halls.find(function (h) {
      return h.id === id;
    });
    if (!hall) {
      app.replaceChildren(el("p", { class: "status" }, ["找不到这个展馆。", el("a", { href: "#/halls", text: "返回展馆列表" })]));
      return;
    }
    document.title = hall.name + " · " + catalog.site.title;
    if (!hall.viewer && !hall.url) {
      app.replaceChildren(el("p", { class: "status", text: "这个展馆还没有接入场景" }));
      return;
    }
    if (!hall.viewer && isLocalUrl(hall.url)) {
      location.replace(hall.url);
      return;
    }
    if (!hall.viewer) {
      app.replaceChildren(el("div", { class: "page" }, [
        el("h1", { text: hall.name }),
        el("p", { text: hall.description }),
        el("a", { class: "btn", href: hall.url, target: "_blank", rel: "noopener", text: "打开展馆漫游" }),
      ]));
      return;
    }
    document.body.classList.add("hall-mode");
    app.replaceChildren(el("div", { class: "hall-view" }, [
      el("div", { class: "hall-bar" }, [
        el("strong", { text: hall.name }),
        el("span", { text: "拖动环视，双指缩放" }),
        el("span", { class: "spacer" }),
        el("a", { href: hall.viewer, target: "_blank", rel: "noopener", text: "全屏打开" }),
      ]),
      el("iframe", { src: hall.viewer, title: hall.name, allow: "fullscreen; xr-spatial-tracking; gyroscope; accelerometer", allowfullscreen: true }),
    ]));
  }

  /* ---------- 路由和启动 ---------- */

  function route() {
    closeDrawer();
    var hash = location.hash.replace(/^#/, "") || "/";
    var split = hash.indexOf("?");
    var path = split === -1 ? hash : hash.slice(0, split);
    var query = new URLSearchParams(split === -1 ? "" : hash.slice(split + 1));
    var parts = path.split("/").filter(Boolean).map(decodeURIComponent);

    document.querySelectorAll("[data-nav]").forEach(function (link) {
      var isHalls = parts[0] === "halls" || parts[0] === "hall";
      link.classList.toggle("active", link.dataset.nav === (isHalls ? "halls" : "home"));
    });

    if (parts[0] === "item" && parts[1]) return renderItem(parts[1]);
    if (parts[0] === "halls") return renderHalls();
    if (parts[0] === "hall" && parts[1]) return renderHall(parts[1]);
    document.title = catalog.site.title;
    syncHashFilter(query);
    renderHome();
  }

  var searchInput = document.getElementById("searchInput");
  searchInput.addEventListener("input", function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      state.query = searchInput.value;
      refreshResults();
    }, 80);
  });

  menuBtn.addEventListener("click", function () {
    var sidebar = document.getElementById("sidebar");
    if (!sidebar) {
      location.hash = "#/";
      return;
    }
    var open = sidebar.classList.toggle("open");
    scrim.hidden = !open;
    menuBtn.setAttribute("aria-expanded", String(open));
  });
  scrim.addEventListener("click", closeDrawer);

  document.getElementById("themeBtn").addEventListener("click", function () {
    var dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    var next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    storageSet("m3d-theme", next);
  });
  var savedTheme = storageGet("m3d-theme");
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;

  window.addEventListener("hashchange", route);

  function applyCatalog(data) {
    catalog = data;
    catalog.items.forEach(S.indexItem);
    document.getElementById("siteTitle").textContent = data.site.title;
    document.getElementById("siteSubtitle").textContent = data.site.subtitle;
    document.getElementById("footerText").textContent = data.site.footer;
    filtered = S.filterItems(catalog.items, state);
  }

  function fetchCatalog() {
    /* 加时间戳绕过 GitHub Pages 的 10 分钟缓存 */
    return fetch("data/catalog.json?t=" + Date.now(), { cache: "no-store" }).then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    });
  }

  /* ---------- 自动更新：新模型建好发布后，开着的页面不用手动刷新 ---------- */

  var updateBar = null;

  function showUpdateBar() {
    if (updateBar) return;
    updateBar = el("button", {
      class: "update-bar",
      text: "资源库有更新，点此刷新本页",
      onclick: function () {
        updateBar.remove();
        updateBar = null;
        route();
      },
    });
    document.body.appendChild(updateBar);
  }

  function checkForUpdate() {
    if (!catalog || document.hidden) return;
    fetchCatalog().then(function (data) {
      if (data.generated === catalog.generated) return;
      var onDetail = /^#\/(item|hall)\//.test(location.hash);
      var input = document.activeElement === searchInput;
      applyCatalog(data);
      if (onDetail) {
        showUpdateBar(); /* 正在看模型时不打断 */
      } else if (!input) {
        var y = window.scrollY;
        route();
        window.scrollTo(0, y);
      }
    }).catch(function () {
      /* 网络抖动时下次再试 */
    });
  }

  fetchCatalog()
    .then(function (data) {
      applyCatalog(data);
      route();
      setInterval(checkForUpdate, 60000);
      document.addEventListener("visibilitychange", function () {
        if (!document.hidden) checkForUpdate();
      });
    })
    .catch(function () {
      app.replaceChildren(el("p", { class: "status", text: "目录加载失败。如果是直接双击打开的文件，请改用 python3 m3d.py serve 预览。" }));
    });
})();
