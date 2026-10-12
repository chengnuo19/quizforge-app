// Shared vitest setup. Kept additive — only fills gaps jsdom/Node lack.

if (typeof global.DOMMatrix === 'undefined') {
  const MockDOMMatrix = class DOMMatrix {}
  global.DOMMatrix = MockDOMMatrix
  globalThis.DOMMatrix = MockDOMMatrix
}

// jsdom's File/Blob lacks arrayBuffer() (browsers have it) — polyfill via
// FileReader so component tests can read dropped files.
if (typeof File !== 'undefined' && File.prototype && !File.prototype.arrayBuffer) {
  File.prototype.arrayBuffer = function arrayBuffer() {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(this)
    })
  }
}
