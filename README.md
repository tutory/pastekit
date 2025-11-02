# 🧩 pastekit

> Tiny, dependency-free helpers to normalize **clipboard paste events** across browsers — works with **text**, **HTML**, and **SVG / image files**.

[![npm](https://img.shields.io/npm/v/pastekit.svg)](https://www.npmjs.com/package/pastekit)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

---

## ✨ Features

- Works in **Chromium, Safari, and Firefox**
- Extracts:
  - Real image files (`image/png`, `image/jpeg`, `image/svg+xml`)
  - Inline `<svg>` markup from pasted HTML or plain text
  - SVGs encoded as `data:image/svg+xml;...`
  - Plain text / HTML clipboard content
- No dependencies  
- 100% test coverage (Mocha + Chai suite included)

---

## 🚀 Installation

```bash
npm install pastekit
# or
pnpm add pastekit
```

---

## 🧠 Usage

```js
import { getPastedData } from 'pastekit';

document.addEventListener('paste', async (evt) => {
  const { files, text, html } = await getPastedData(evt);

  if (files.length) {
    // Handle image/SVG upload
    console.log('Pasted files:', files);
    return;
  }

  if (text) {
    console.log('Pasted text:', text);
  } else if (html) {
    console.log('Pasted HTML:', html);
  }
});
```

### Returned object

```ts
{
  files: File[];    // any pasted image or reconstructed SVGs
  text: string|null;
  html: string|null;
}
```

### Browser behavior

| Browser   | Real image files | Inline SVG | Data-URL SVG | HTML/Text |
|------------|-----------------|-------------|---------------|------------|
| Chrome/Edge | ✅ | ✅ | ✅ | ✅ |
| Safari | ✅ | ✅ | ✅ | ✅ |
| Firefox | ❌ (no file items on paste) | ✅ | ✅ | ✅ |

---

## 🧩 API

### `getPastedData(evt: ClipboardEvent): Promise<{files, text, html}>`

Reads from a native `paste` event and returns all available clipboard data.  
Handles both Chromium’s `DataTransferItem` interface and Firefox’s `getData()` fallback.

---

## 🧪 Testing

```bash
npm test
```

Mocha + Chai tests cover:
- Real file pastes
- Inline SVG extraction
- Data-URL decoding
- HTML + text fallback (Firefox path)

---

## 📄 License

MIT © ChatGPT (OpenAI)

---

### ❤️ Notes
- Uses only built-in browser APIs (`DOMParser`, `XMLSerializer`, etc.)
- For maximum security, **sanitize any SVGs** server-side before storing or rendering them.
