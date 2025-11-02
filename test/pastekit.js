// pastekit.spec.js
import { expect } from 'chai'
import {
  getPastedData,
  extractFirstSvgFromHtml,
  isSvgDataUrl,
  decodeSvgDataUrl,
  fileFromSvgText,
} from '../pastekit.js'

// Polyfill File for Node if missing
if (typeof global.File === 'undefined') {
  global.File = class File extends Blob {
    constructor(chunks, name, opts = {}) {
      super(chunks, opts)
      this.name = name
      this.type = opts.type || ''
      this.lastModified = opts.lastModified || Date.now()
    }
  }
}

// Polyfill atob for base64 (Node 18+ has Buffer)
if (typeof global.atob === 'undefined') {
  global.atob = (b64) => Buffer.from(b64, 'base64').toString('binary')
}

function buildPasteEvent({ items, html, plain } = {}) {
  const clipboardData = {
    items: items || [],
    types: toDomStringList([
      ...(html ? ['text/html'] : []),
      ...(plain ? ['text/plain'] : []),
    ]),
    getData(type) {
      if (type === 'text/html') return html || ''
      if (type === 'text/plain' || type === 'text') return plain || ''
      return ''
    },
  }
  return { clipboardData }
}

function toDomStringList(arr) {
  // Minimal DOMStringList-like shim for includes()
  return {
    length: arr.length,
    contains: (s) => arr.includes(s),
    item: (i) => arr[i],
    // Some browsers expose Array-ish object; our code will Array.from it.
    [Symbol.iterator]: function* () {
      for (const v of arr) yield v
    },
  }
}

function chromiumTextItem(mime, str) {
  return {
    kind: 'string',
    type: mime,
    getAsString: (cb) => cb(str),
  }
}

function chromiumFileItem(mime, file) {
  return {
    kind: 'file',
    type: mime,
    getAsFile: () => file,
  }
}

describe('pastekit', () => {
  it('extracts real SVG file from items', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'
    const file = new File([svg], 'x.svg', { type: 'image/svg+xml' })
    const evt = buildPasteEvent({
      items: [chromiumFileItem('image/svg+xml', file)],
    })

    const { files, text, html } = await getPastedData(evt)
    expect(files).to.have.length(1)
    expect(files[0].type).to.equal('image/svg+xml')
    expect(text).to.equal(null)
    expect(html).to.equal(null)
  })

  it('extracts inline <svg> from text/html (wrapped)', async () => {
    const html =
      '<div><p>before</p><svg xmlns="http://www.w3.org/2000/svg"><circle/></svg><p>after</p></div>'
    const evt = buildPasteEvent({
      items: [chromiumTextItem('text/html', html)],
    })

    const { files } = await getPastedData(evt)
    expect(files).to.have.length(1)
    const txt = await files[0].text()
    expect(txt).to.include('<svg')
    expect(txt).to.include('</svg>')
  })

  it('extracts inline <svg> from text/plain', async () => {
    const plain =
      'header\n<svg xmlns="http://www.w3.org/2000/svg"><line/></svg>\nfooter'
    const evt = buildPasteEvent({
      items: [chromiumTextItem('text/plain', plain)],
    })

    const { files } = await getPastedData(evt)
    expect(files).to.have.length(1)
    const txt = await files[0].text()
    expect(txt).to.include('<line')
  })

  it('extracts svg from <img src="data:image/svg+xml;utf8,..."> in HTML', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>'
    const enc = encodeURIComponent(svg)
    const html = `<img src="data:image/svg+xml;utf8,${enc}">`
    const evt = buildPasteEvent({
      items: [chromiumTextItem('text/html', html)],
    })

    const { files } = await getPastedData(evt)
    expect(files).to.have.length(1)
    const txt = await files[0].text()
    expect(txt).to.equal(svg)
  })

  it('extracts svg from data:image/svg+xml;base64,... in HTML object', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10"/></svg>'
    const b64 = Buffer.from(svg, 'utf8').toString('base64')
    const html = `<object type="image/svg+xml" data="data:image/svg+xml;base64,${b64}"></object>`
    const evt = buildPasteEvent({
      items: [chromiumTextItem('text/html', html)],
    })

    const { files } = await getPastedData(evt)
    expect(files).to.have.length(1)
    const txt = await files[0].text()
    expect(txt).to.equal(svg)
  })

  it('extracts svg from plain text data URL', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><ellipse/></svg>'
    const enc = encodeURIComponent(svg)
    const plain = `data:image/svg+xml;utf8,${enc}`
    const evt = buildPasteEvent({
      items: [chromiumTextItem('text/plain', plain)],
    })

    const { files } = await getPastedData(evt)
    expect(files).to.have.length(1)
    const txt = await files[0].text()
    expect(txt).to.equal(svg)
  })

  it('Firefox fallback: uses getData when items are absent', async () => {
    const html = '<div><svg xmlns="http://www.w3.org/2000/svg"><g/></svg></div>'
    const evt = buildPasteEvent({ html })

    const { files, html: outHtml, text } = await getPastedData(evt)
    expect(outHtml).to.equal(html)
    expect(text).to.equal(null)
    expect(files).to.have.length(1)
  })

  it('returns plain text when no svg found', async () => {
    const plain = 'Just some text'
    const evt = buildPasteEvent({ plain })

    const { files, text, html } = await getPastedData(evt)
    expect(files).to.have.length(0)
    expect(text).to.equal(plain)
    expect(html).to.equal(null)
  })

  it('helpers: isSvgDataUrl + decodeSvgDataUrl', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    const u = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
    expect(isSvgDataUrl(u)).to.equal(true)
    expect(decodeSvgDataUrl(u)).to.equal(svg)

    const b64 =
      'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
    expect(isSvgDataUrl(b64)).to.equal(true)
    expect(decodeSvgDataUrl(b64)).to.equal(svg)
  })

  it('helpers: extractFirstSvgFromHtml returns null when none present', () => {
    const html = '<p>No svg here</p>'
    expect(extractFirstSvgFromHtml(html)).to.equal(null)
  })

  it('fileFromSvgText produces a File with correct type', async () => {
    const f = fileFromSvgText('<svg/>', 'x.svg')
    expect(f).to.be.instanceOf(File)
    expect(f.type).to.equal('image/svg+xml')
    expect(await f.text()).to.equal('<svg/>')
  })
})
