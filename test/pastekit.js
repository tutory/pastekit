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

// helper to simulate async getAsString with a delay
function chromiumAsyncTextItem(mime, str, delayMs) {
  return {
    kind: 'string',
    type: mime,
    getAsString: (cb) => setTimeout(() => cb(str), delayMs),
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

  it('preserves item.type when getAsString resolves out-of-order', async () => {
    // html resolves slower than plain
    const slowHtml = chromiumAsyncTextItem(
      'text/html',
      '<div><p>hi</p></div>',
      25
    )
    const fastPlain = chromiumAsyncTextItem('text/plain', 'Plain text', 0)

    const evt = {
      clipboardData: {
        items: [slowHtml, fastPlain],
        // these are unused on the items path, but included for completeness
        types: (function* () {
          yield 'text/html'
          yield 'text/plain'
        })(),
        getData: () => '',
      },
    }

    const { files, text, html } = await getPastedData(evt)

    expect(files).to.have.length(0)
    expect(text).to.equal('Plain text') // must map to text/plain
    expect(html).to.equal('<div><p>hi</p></div>') // must map to text/html
  })

  it('falls back to text/plain when text/html is present but empty', async () => {
    const evt = {
      clipboardData: {
        items: [
          { kind: 'string', type: 'text/html', getAsString: (cb) => cb('') },
          {
            kind: 'string',
            type: 'text/plain',
            getAsString: (cb) => cb('Plain text!'),
          },
        ],
        getData: () => '',
        types: ['text/html', 'text/plain'],
      },
    }

    const { files, text, html } = await getPastedData(evt)
    expect(files).to.have.length(0)
    expect(html).to.equal(null) // html empty → null
    expect(text).to.equal('Plain text!')
  })

  it('survives CF_HTML-wrapped HTML', async () => {
    const cfHtml = [
      'Version:0.9',
      'StartHTML:00000097',
      'EndHTML:00000197',
      'StartFragment:00000131',
      'EndFragment:00000161',
      '<html><body><!--StartFragment--><p>Hello <b>world</b></p><!--EndFragment--></body></html>',
    ].join('\r\n')

    const evt = {
      clipboardData: {
        items: [
          {
            kind: 'string',
            type: 'text/html',
            getAsString: (cb) => cb(cfHtml),
          },
        ],
        getData: (t) => (t === 'text/html' ? cfHtml : ''),
        types: ['text/html'],
      },
    }

    const { files, text, html } = await getPastedData(evt)
    expect(files).to.have.length(0)
    expect(html).to.include('StartFragment')
    // downstream code can parse CF_HTML; we just pass HTML through.
    expect(text === null || typeof text === 'string').to.equal(true)
  })

  it('extracts the first <svg> when multiple are present in HTML', async () => {
    const html = `
    <div>
      <svg xmlns="http://www.w3.org/2000/svg" id="first"><rect width="1"/></svg>
      <svg xmlns="http://www.w3.org/2000/svg" id="second"><circle r="2"/></svg>
    </div>
  `
    const evt = {
      clipboardData: {
        items: [
          { kind: 'string', type: 'text/html', getAsString: (cb) => cb(html) },
        ],
        getData: () => '',
        types: ['text/html'],
      },
    }

    const { files } = await getPastedData(evt)
    expect(files).to.have.length(1)
    const txt = await files[0].text()
    expect(txt).to.include('id="first"')
    expect(txt).to.not.include('id="second"')
  })

  it('decodes data:image/svg+xml with extra/ordered params', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>'
    const utf8 = `data:image/svg+xml;charset=utf-8;param=x,${encodeURIComponent(
      svg
    )}`
    const html = `<img src="${utf8}">`

    const evt = {
      clipboardData: {
        items: [
          { kind: 'string', type: 'text/html', getAsString: (cb) => cb(html) },
        ],
        getData: () => '',
        types: ['text/html'],
      },
    }

    const { files } = await getPastedData(evt)
    expect(files).to.have.length(1)
    expect(await files[0].text()).to.equal(svg)
  })

  it('handles uppercase MIME and single quotes in HTML data URLs', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>'
    const enc = encodeURIComponent(svg)
    const html = `<img src='DATA:IMAGE/SVG+XML;UTF8,${enc}'>`

    const evt = {
      clipboardData: {
        items: [
          { kind: 'string', type: 'text/html', getAsString: (cb) => cb(html) },
        ],
        getData: () => '',
        types: ['text/html'],
      },
    }

    const { files } = await getPastedData(evt)
    expect(files).to.have.length(1)
    expect(await files[0].text()).to.equal(svg)
  })

  it('parses HTML with entities/unicode without crashing', async () => {
    const html = '<div>Price &amp; Qualität — “OK”</div>'
    const evt = {
      clipboardData: {
        items: [
          { kind: 'string', type: 'text/html', getAsString: (cb) => cb(html) },
        ],
        getData: () => '',
        types: ['text/html'],
      },
    }

    const { files, html: outHtml } = await getPastedData(evt)
    expect(files).to.have.length(0)
    expect(outHtml).to.include('&amp;')
    expect(outHtml).to.include('Qualität')
  })

  it('firefox path: uses getData(html) when items missing and plain empty', async () => {
    const html =
      '<div><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg></div>'
    const evt = {
      clipboardData: {
        // no items; only getData
        types: ['text/html'],
        getData: (t) => (t === 'text/html' ? html : ''),
      },
    }

    const { files, text, html: outHtml } = await getPastedData(evt)
    expect(outHtml).to.equal(html)
    expect(text).to.equal(null)
    expect(files).to.have.length(1)
  })

  it('extracts svg from <object type=image/svg+xml data=...> base64', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="3"/></svg>'
    const b64 = Buffer.from(svg, 'utf8').toString('base64')
    const html = `<object type="image/svg+xml" data="data:image/svg+xml;base64,${b64}"></object>`
    const evt = {
      clipboardData: {
        items: [
          { kind: 'string', type: 'text/html', getAsString: (cb) => cb(html) },
        ],
        getData: () => '',
        types: ['text/html'],
      },
    }

    const { files } = await getPastedData(evt)
    expect(files).to.have.length(1)
    expect(await files[0].text()).to.equal(svg)
  })
})
