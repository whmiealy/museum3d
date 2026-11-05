/* 搜索、筛选、排序的纯逻辑。浏览器和 node 测试共用，不碰 DOM。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.M3DSearch = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* 每件物品预先拼好小写检索串，几千件时每次按键只做子串查找 */
  function indexItem(item) {
    var parts = [item.id, item.name, item.category, item.description, item.size, item.maker, item.date];
    parts = parts.concat(item.tags || []);
    var fields = item.fields || {};
    Object.keys(fields).forEach(function (key) {
      parts.push(key, fields[key]);
    });
    item._text = parts.filter(Boolean).join("\n").toLowerCase();
    return item;
  }

  /* 空格分隔的多个词要同时命中 */
  function parseQuery(query) {
    return String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  }

  function matches(item, terms) {
    for (var i = 0; i < terms.length; i++) {
      if (item._text.indexOf(terms[i]) === -1) return false;
    }
    return true;
  }

  function inCategory(item, category) {
    return !category || item.category === category || item.category.indexOf(category + "/") === 0;
  }

  function compareId(a, b) {
    return a.id.localeCompare(b.id, "zh-Hans-CN", { numeric: true });
  }

  var SORTERS = {
    id: compareId,
    name: function (a, b) {
      return a.name.localeCompare(b.name, "zh-Hans-CN") || compareId(a, b);
    },
    newest: function (a, b) {
      return (b.added || 0) - (a.added || 0) || compareId(a, b);
    },
  };

  /* state: { query, category, methods: [], tags: [], sort } */
  function filterItems(items, state) {
    var terms = parseQuery(state.query);
    var methods = state.methods || [];
    var tags = state.tags || [];
    var result = items.filter(function (item) {
      if (!inCategory(item, state.category)) return false;
      if (methods.length && methods.indexOf(item.method) === -1) return false;
      for (var i = 0; i < tags.length; i++) {
        if ((item.tags || []).indexOf(tags[i]) === -1) return false;
      }
      return matches(item, terms);
    });
    return result.sort(SORTERS[state.sort] || SORTERS.id);
  }

  /* 把文本切成 [{text, hit}]，由调用方用文本节点渲染，避免拼 HTML */
  function highlight(text, terms) {
    text = String(text || "");
    if (!terms.length || !text) return [{ text: text, hit: false }];
    var lower = text.toLowerCase();
    var marks = new Array(text.length).fill(false);
    terms.forEach(function (term) {
      var at = lower.indexOf(term);
      while (at !== -1) {
        for (var i = at; i < at + term.length; i++) marks[i] = true;
        at = lower.indexOf(term, at + term.length);
      }
    });
    var out = [];
    var start = 0;
    for (var i = 1; i <= text.length; i++) {
      if (i === text.length || marks[i] !== marks[start]) {
        out.push({ text: text.slice(start, i), hit: marks[start] });
        start = i;
      }
    }
    return out;
  }

  /* 命中在描述或自定义字段里时，给卡片取一小段上下文 */
  function snippet(item, terms, radius) {
    radius = radius || 16;
    var pool = [item.description].concat(item.tags || []);
    var fields = item.fields || {};
    Object.keys(fields).forEach(function (key) {
      pool.push(key + "：" + fields[key]);
    });
    for (var i = 0; i < pool.length; i++) {
      var source = String(pool[i] || "");
      var lower = source.toLowerCase();
      for (var t = 0; t < terms.length; t++) {
        var at = lower.indexOf(terms[t]);
        if (at !== -1) {
          var from = Math.max(0, at - radius);
          var to = Math.min(source.length, at + terms[t].length + radius);
          return (from > 0 ? "…" : "") + source.slice(from, to) + (to < source.length ? "…" : "");
        }
      }
    }
    return "";
  }

  return {
    indexItem: indexItem,
    parseQuery: parseQuery,
    filterItems: filterItems,
    highlight: highlight,
    snippet: snippet,
    inCategory: inCategory,
  };
});
