// pastekit.js
// Tiny helpers to normalize paste across browsers.
//
// API:
//   await getPastedData(evt) -> { files: File[], text: string|null, html: string|null }
//
// Notes:
// - Handles Chromium "items" path and Firefox "getData" fallback.
// - Extracts SVGs from <svg> in HTML/plain, and from data:image/svg+xml URLs.
// - Still returns any real image files (PNG/JPEG/SVG) when available.

export async function getPastedData(evt) {
  const dt = evt.clipboardData || evt.originalEvent?.clipboardData || null
  if (!dt) return { files: [], text: null, html: null }

  // Chromium path (items + getAsString)
  const items = Array.from(dt.items || [])
  const canUseItems =
    items.length && typeof (items[0]?.getAsString === 'function' || typeof items[0]?.getAsFile === 'function')
  if (canUseItems) {
    const { files, text, html } = await extractFromItems(items)
    if (files.length || text || html) return { files, text, html }
    // Fall back to getData if items yielded nothing (covers odd payloads)
  }

  // Firefox / generic fallback
  const html = getDataSafe(dt, 'text/html')
  const plain = getDataSafe(dt, 'text/plain') || getDataSafe(dt, 'text')

  const files = []
  const svgFromHtml = html ? extractFirstSvgFromHtml(html) : null
  if (svgFromHtml) files.push(fileFromSvgText(svgFromHtml))

  if (plain && !svgFromHtml) {
    const svgInline = matchInlineSvg(plain)
    if (svgInline) files.push(fileFromSvgText(svgInline))
    else if (isSvgDataUrl(plain.trim())) {
      const decoded = decodeSvgDataUrl(plain.trim())
      if (decoded) files.push(fileFromSvgText(decoded))
    }
  }

  return { files, text: plain || null, html: html || null }
}

/* ----------------- Internals ----------------- */

async function extractFromItems(items) {
  const files = []
  let html = null
  let text = null

  // Collect text via getAsString calls
  const textPromises = []

  for (const item of items) {
    // Real files (works in Chromium; not in Firefox paste)
    if (item.kind === 'file' && item.type?.startsWith('image/')) {
      const f = item.getAsFile?.()
      if (f) files.push(f)
      continue
    }

    // Text items
    if (item.type === 'text/html' || item.type === 'text/plain') {
      textPromises.push(
        new Promise((resolve) => item.getAsString?.(resolve)).then((str) => ({
          type: item.type,
          str,
        }))
      )
    }
  }

  const texts = await Promise.all(textPromises)
  const htmlEntry = texts.find((t) => t.type === 'text/html' && t.str)
  const plainEntry = texts.find((t) => t.type === 'text/plain' && t.str)

  html = htmlEntry?.str || null
  text = plainEntry?.str || null

  // Prefer extracting SVG from HTML first
  if (html) {
    const svg = extractFirstSvgFromHtml(html)
    if (svg) files.push(fileFromSvgText(svg))
  }

  // Then plain text inline <svg> or data URL
  if (text) {
    const inlineSvg = matchInlineSvg(text)
    if (inlineSvg) files.push(fileFromSvgText(inlineSvg))
    else if (isSvgDataUrl(text.trim())) {
      const decoded = decodeSvgDataUrl(text.trim())
      if (decoded) files.push(fileFromSvgText(decoded))
    }
  }

  return { files, text, html }
}

function getDataSafe(dt, type) {
  try {
    return dt.getData?.(type) || ''
  } catch {
    return ''
  }
}

function matchInlineSvg(s) {
  const m = s.match(/<svg[\s\S]*?<\/svg>/i)
  return m ? m[0] : null
}

export function extractFirstSvgFromHtml(html) {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    // A) Literal <svg> element
    const svgEl = doc.querySelector('svg')
    if (svgEl) {
      return new XMLSerializer().serializeToString(svgEl)
    }
    // B) <img src="data:image/svg+xml,...">
    const img = doc.querySelector('img[src^="data:image/svg+xml"]')
    if (img) {
      const decoded = decodeSvgDataUrl(img.getAttribute('src'))
      if (decoded) return decoded
    }
    // C) <object type="image/svg+xml" data="data:image/svg+xml,...">
    const obj = doc.querySelector(
      'object[type="image/svg+xml"][data^="data:image/svg+xml"]'
    )
    if (obj) {
      const decoded = decodeSvgDataUrl(obj.getAttribute('data'))
      if (decoded) return decoded
    }
  } catch {}
  return null
}

export function isSvgDataUrl(s) {
  return /^data:image\/svg\+xml[,;]/i.test(s)
}

export function decodeSvgDataUrl(dataUrl) {
  try {
    const match = dataUrl.match(/^data:image\/svg\+xml(;[^,]*)?,(.*)$/i)
    if (!match) return null
    const meta = match[1] || ''
    const payload = match[2] || ''
    if (/;base64/i.test(meta)) {
      // atob may not exist in Node; caller/tests polyfill it
      return typeof atob === 'function'
        ? atob(payload)
        : Buffer.from(payload, 'base64').toString('utf8')
    }
    return decodeURIComponent(payload)
  } catch {
    return null
  }
}

export function fileFromSvgText(text, name = `pasted-${Date.now()}.svg`) {
  return new File([text], name, { type: 'image/svg+xml' })
}
