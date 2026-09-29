# Vifari

A minimal Vimium/Vimari-style Safari extension: link hints and vi-style scrolling.

| Key       | Action                                              |
|-----------|-----------------------------------------------------|
| `f`       | Show hints on clickable elements; type a label to click it (`Esc` cancels, `Backspace` undoes a letter) |
| `j` / `k` | Scroll down / up (hold to keep scrolling)          |
| `h` / `l` | Scroll left / right                                 |
| `d` / `u` | Scroll half a page down / up                        |
| `gg` / `G`| Jump to top / bottom                                |
| `H` / `L` | Go back / forward in history                        |
| `Esc`     | Leave a focused text field so the keys work again   |

Keys are ignored while you're typing in a text field and when Cmd/Ctrl/Option is held.
Scrolling targets the scrollable pane you last clicked in, then the page, then
the largest scrollable element (for app-style pages where the body doesn't scroll).

## Layout

- `extension/`: the WebExtension (`manifest.json`, `content.js`, `images/`)
- `test/index.html`: a page that covers the edge cases (nested clickables, covered links, scroll panes)
- `tools/make-icons.py`: draws `extension/images/`. The converter builds the
  Xcode app icon out of these, so they have to be there and they have to be the
  sizes the manifest claims. Run it after changing the mark:

  ```sh
  python3 tools/make-icons.py
  ```

## Try it without Xcode (temporary install)

1. Safari → Settings → Advanced → turn on **Show features for web developers**.
2. Safari → Settings → Developer → turn on **Allow unsigned extensions**.
3. Develop → **Add Temporary Extension…** → choose the `extension/` folder.
4. Allow it on all websites when Safari asks.

Safari removes temporary extensions after 24 hours or when it quits.

To test locally: `python3 -m http.server 8765`, then open http://localhost:8765/test/.

## Permanent install (requires Xcode)

```sh
xcrun safari-web-extension-converter extension --app-name Vifari --macos-only --no-open --project-location xcode
```

Open the generated project, build and run the app once, then enable Vifari in
Safari → Settings → Extensions.
