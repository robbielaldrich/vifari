// Vifari: minimal vim-style navigation for Safari.
//   f         show link hints; type the label to click it (Esc cancels)
//   j / k     scroll down / up
//   h / l     scroll left / right
//   d / u     scroll half a page down / up
//   gg / G    jump to top / bottom
//   H / L     go back / forward in history
//   Esc       leave a focused text field
(() => {
  if (window.__vifariLoaded) return;
  window.__vifariLoaded = true;

  const HINT_CHARS = "sadfjklewcmpgh";
  const SCROLL_STEP = 60;
  const SEQUENCE_TIMEOUT_MS = 1000;

  const CLICKABLE_SELECTOR = [
    "a[href]",
    "button",
    "input:not([type=hidden])",
    "select",
    "textarea",
    "summary",
    "[onclick]",
    "[contenteditable='']",
    "[contenteditable='true']",
    "[tabindex]:not([tabindex='-1'])",
    ...[
      "button", "link", "checkbox", "radio", "switch", "tab", "option",
      "menuitem", "menuitemcheckbox", "menuitemradio", "treeitem", "combobox",
    ].map((role) => `[role='${role}']`),
  ].join(",");

  const NON_TEXT_INPUT_TYPES = new Set([
    "button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit",
  ]);

  // ---------------------------------------------------------------------------
  // DOM helpers (shadow-DOM aware)

  function composedParent(node) {
    return node.parentNode instanceof ShadowRoot ? node.parentNode.host : node.parentElement;
  }

  function composedContains(ancestor, node) {
    for (let n = node; n; n = composedParent(n)) {
      if (n === ancestor) return true;
    }
    return false;
  }

  function deepActiveElement() {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) {
      el = el.shadowRoot.activeElement;
    }
    return el;
  }

  function deepElementFromPoint(x, y) {
    let el = document.elementFromPoint(x, y);
    while (el && el.shadowRoot) {
      const inner = el.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === el) break;
      el = inner;
    }
    return el;
  }

  function isEditable(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
    if (el.tagName === "INPUT") return !NON_TEXT_INPUT_TYPES.has((el.type || "").toLowerCase());
    return false;
  }

  function collectClickables(root, out) {
    for (const el of root.querySelectorAll(CLICKABLE_SELECTOR)) out.push(el);
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) collectClickables(el.shadowRoot, out);
    }
    return out;
  }

  // Returns the on-screen position for a hint, or null if the element isn't
  // actually visible (off-screen, zero-sized, or covered by something else).
  function hintPosition(el) {
    if (el.disabled) return null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    for (const r of el.getClientRects()) {
      const left = Math.max(r.left, 0);
      const top = Math.max(r.top, 0);
      const right = Math.min(r.right, vw);
      const bottom = Math.min(r.bottom, vh);
      if (right - left < 3 || bottom - top < 3) continue;

      const points = [
        [(left + right) / 2, (top + bottom) / 2],
        [left + 2, top + 2],
        [right - 2, bottom - 2],
      ];
      for (const [x, y] of points) {
        const hit = deepElementFromPoint(x, y);
        if (hit && composedContains(el, hit)) return { left, top, x, y };
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Link hints

  let hints = null; // { host, items: [{ el, label, node, pos }], typed }

  function makeLabels(count) {
    const k = HINT_CHARS.length;
    let len = 1;
    while (k ** len < count) len++;
    const labels = [];
    for (let i = 0; i < count; i++) {
      // Vary the first character fastest so the first keystroke narrows the most.
      let label = "";
      for (let j = 0, n = i; j < len; j++, n = Math.floor(n / k)) label += HINT_CHARS[n % k];
      labels.push(label);
    }
    return labels;
  }

  function showHints() {
    stopScrolling();
    const targets = [];
    for (const el of collectClickables(document, [])) {
      const pos = hintPosition(el);
      if (!pos) continue;
      // Drop elements nested in an already-hinted element at the same spot
      // (e.g. <a><div role=button>), which would otherwise stack two hints.
      const dup = targets.some(
        (t) =>
          Math.abs(t.pos.left - pos.left) < 4 &&
          Math.abs(t.pos.top - pos.top) < 4 &&
          (composedContains(t.el, el) || composedContains(el, t.el)),
      );
      if (!dup) targets.push({ el, pos });
    }
    if (targets.length === 0) return;

    const host = document.createElement("div");
    host.setAttribute(
      "style",
      "all: initial !important; position: fixed !important; inset: 0 !important; " +
        "pointer-events: none !important; z-index: 2147483647 !important;",
    );
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      .hint {
        position: absolute;
        font: bold 11px/1.25 -apple-system, "Helvetica Neue", sans-serif;
        color: #302505;
        background: linear-gradient(to bottom, #fff785, #ffc542);
        border: 1px solid #c38a22;
        border-radius: 3px;
        padding: 0 3px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
        text-transform: uppercase;
        white-space: nowrap;
      }
      .typed { color: #d4ac3a; }
    `;
    shadow.append(style);

    const labels = makeLabels(targets.length);
    const items = targets.map(({ el, pos }, i) => {
      const node = document.createElement("div");
      node.className = "hint";
      node.style.left = `${pos.left}px`;
      node.style.top = `${pos.top}px`;
      shadow.append(node);
      return { el, pos, label: labels[i], node };
    });

    document.documentElement.append(host);
    hints = { host, items, typed: "" };
    renderHints();
    window.addEventListener("scroll", hideHints);
    window.addEventListener("resize", hideHints);
  }

  function renderHints() {
    const { items, typed } = hints;
    for (const item of items) {
      const match = item.label.startsWith(typed);
      item.node.style.display = match ? "" : "none";
      if (!match) continue;
      item.node.replaceChildren();
      if (typed) {
        const done = document.createElement("span");
        done.className = "typed";
        done.textContent = typed;
        item.node.append(done);
      }
      item.node.append(item.label.slice(typed.length));
    }
  }

  function hideHints() {
    if (!hints) return;
    hints.host.remove();
    hints = null;
    window.removeEventListener("scroll", hideHints);
    window.removeEventListener("resize", hideHints);
  }

  function handleHintKey(e) {
    if (e.key === "Escape") {
      hideHints();
      return;
    }
    if (e.key === "Backspace") {
      hints.typed = hints.typed.slice(0, -1);
      renderHints();
      return;
    }
    const ch = e.key.toLowerCase();
    if (ch.length !== 1 || !HINT_CHARS.includes(ch)) return;

    const typed = hints.typed + ch;
    const matches = hints.items.filter((item) => item.label.startsWith(typed));
    if (matches.length === 0) return;
    if (matches.length === 1 && matches[0].label === typed) {
      const { el, pos } = matches[0];
      hideHints();
      activate(el, pos);
      return;
    }
    hints.typed = typed;
    renderHints();
  }

  function activate(el, pos) {
    lastInteracted = el;
    if (isEditable(el)) {
      el.focus();
      return;
    }
    const init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      button: 0,
      clientX: pos.x,
      clientY: pos.y,
    };
    el.dispatchEvent(new PointerEvent("pointerover", init));
    el.dispatchEvent(new MouseEvent("mouseover", init));
    el.dispatchEvent(new PointerEvent("pointerdown", init));
    el.dispatchEvent(new MouseEvent("mousedown", init));
    el.dispatchEvent(new PointerEvent("pointerup", init));
    el.dispatchEvent(new MouseEvent("mouseup", init));
    el.click();
  }

  // ---------------------------------------------------------------------------
  // Scrolling

  // Element the user last clicked or activated; its nearest scrollable
  // ancestor is preferred, so j/k work inside scrolling panes.
  let lastInteracted = null;
  let fallbackScroller = null;

  function canScroll(el, axis) {
    const prop = axis === "y" ? "scrollTop" : "scrollLeft";
    const side = axis === "y" ? "top" : "left";
    const before = el[prop];
    for (const delta of [1, -1]) {
      el.scrollBy({ [side]: delta, behavior: "instant" });
      if (el[prop] !== before) {
        el.scrollTo({ [side]: before, behavior: "instant" });
        return true;
      }
    }
    return false;
  }

  function findScroller(axis) {
    const page = document.scrollingElement || document.documentElement;
    for (let el = lastInteracted; el && el.isConnected; el = composedParent(el)) {
      if (el === page || el === document.body) break;
      if (canScroll(el, axis)) return el;
    }
    if (canScroll(page, axis)) return page;

    // Pages where the document itself doesn't scroll (app-style layouts):
    // use the largest scrollable element.
    if (fallbackScroller && fallbackScroller.isConnected && canScroll(fallbackScroller, axis)) {
      return fallbackScroller;
    }
    let best = null;
    let bestArea = 0;
    for (const el of document.querySelectorAll("*")) {
      const bigger = axis === "y" ? el.scrollHeight > el.clientHeight : el.scrollWidth > el.clientWidth;
      if (!bigger) continue;
      const area = el.clientWidth * el.clientHeight;
      if (area > bestArea && canScroll(el, axis)) {
        best = el;
        bestArea = area;
      }
    }
    fallbackScroller = best;
    return best || page;
  }

  // Key repeat fires every ~30ms; rather than jumping on each event, add to a
  // pending distance and ease toward it each animation frame.
  const anim = { el: null, x: 0, y: 0, raf: 0 };

  function scrollByAnimated(el, dx, dy) {
    if (anim.el !== el) {
      anim.el = el;
      anim.x = 0;
      anim.y = 0;
    }
    anim.x += dx;
    anim.y += dy;
    if (!anim.raf) anim.raf = requestAnimationFrame(scrollTick);
  }

  function easeStep(remaining) {
    if (Math.abs(remaining) < 1) return 0;
    let step = remaining * 0.3;
    if (Math.abs(step) < 4) step = Math.sign(remaining) * Math.min(Math.abs(remaining), 4);
    return Math.round(step);
  }

  function scrollTick() {
    anim.raf = 0;
    const el = anim.el;
    const sx = easeStep(anim.x);
    const sy = easeStep(anim.y);
    if (!sx && !sy) {
      anim.x = anim.y = 0;
      return;
    }
    const bx = el.scrollLeft;
    const by = el.scrollTop;
    el.scrollBy({ left: sx, top: sy, behavior: "instant" });
    // Stop an axis once it hits the edge.
    anim.x = sx && el.scrollLeft === bx ? 0 : anim.x - sx;
    anim.y = sy && el.scrollTop === by ? 0 : anim.y - sy;
    anim.raf = requestAnimationFrame(scrollTick);
  }

  function stopScrolling() {
    if (anim.raf) cancelAnimationFrame(anim.raf);
    anim.raf = 0;
    anim.x = anim.y = 0;
  }

  function scrollVertical(amount) {
    const el = findScroller("y");
    scrollByAnimated(el, 0, amount(el));
  }

  function scrollHorizontal(dx) {
    scrollByAnimated(findScroller("x"), dx, 0);
  }

  // ---------------------------------------------------------------------------
  // Key handling

  let pendingG = 0; // timestamp of a lone "g", waiting for the second one

  const commands = {
    f: showHints,
    j: () => scrollVertical(() => SCROLL_STEP),
    k: () => scrollVertical(() => -SCROLL_STEP),
    h: () => scrollHorizontal(-SCROLL_STEP),
    l: () => scrollHorizontal(SCROLL_STEP),
    d: () => scrollVertical((el) => viewportHeight(el) / 2),
    u: () => scrollVertical((el) => -viewportHeight(el) / 2),
    G: () => scrollVertical((el) => el.scrollHeight - el.scrollTop - viewportHeight(el)),
    H: () => history.back(),
    L: () => history.forward(),
  };

  function viewportHeight(el) {
    return el === document.scrollingElement ? window.innerHeight : el.clientHeight;
  }

  // Keys we consumed on keydown; their keyups are swallowed too so page
  // shortcuts bound to keyup don't fire.
  const swallowed = new Set();

  function consume(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    swallowed.add(e.code);
  }

  function onKeyDown(e) {
    if (e.isComposing) return;

    if (hints) {
      if (e.metaKey || e.ctrlKey || e.altKey) {
        hideHints();
        return;
      }
      consume(e);
      handleHintKey(e);
      return;
    }

    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (isEditable(deepActiveElement())) {
      if (e.key === "Escape") deepActiveElement().blur();
      return;
    }

    if (e.key === "g") {
      consume(e);
      if (!e.repeat && Date.now() - pendingG < SEQUENCE_TIMEOUT_MS) {
        pendingG = 0;
        scrollVertical((el) => -el.scrollTop);
      } else {
        pendingG = Date.now();
      }
      return;
    }
    pendingG = 0;

    const command = commands[e.key];
    if (!command) return;
    consume(e);
    command();
  }

  function onKeyUp(e) {
    if (swallowed.delete(e.code)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("mousedown", (e) => (lastInteracted = e.composedPath()[0]), true);
})();
