// test/setup-jsdom.mjs
import { JSDOM } from 'jsdom';

// Create a DOM
const dom = new JSDOM(`<!doctype html><html><body></body></html>`, {
  url: 'http://localhost/'
});

// Expose needed globals
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer;
globalThis.Blob = dom.window.Blob;

// File polyfill (Node lacks it). Use Blob as base so .text() works.
if (typeof globalThis.File === 'undefined') {
  globalThis.File = class File extends dom.window.Blob {
    constructor(chunks, name, opts = {}) {
      super(chunks, opts);
      this.name = name;
      this.type = opts.type || '';
      this.lastModified = opts.lastModified || Date.now();
    }
  };
}

// atob/btoa for base64 helpers
if (typeof globalThis.atob === 'undefined') {
  globalThis.atob = (b64) => Buffer.from(b64, 'base64').toString('binary');
}
if (typeof globalThis.btoa === 'undefined') {
  globalThis.btoa = (bin) => Buffer.from(bin, 'binary').toString('base64');
}
