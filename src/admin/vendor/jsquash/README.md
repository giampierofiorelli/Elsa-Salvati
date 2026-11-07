# WebP encoder (jSquash)

- Source: npm package `@jsquash/webp` 1.5.0 (https://github.com/jamsinclair/jSquash), codec from Squoosh (libwebp).
- Licence: Apache-2.0 (see LICENSE).
- Files kept: `codec/enc/webp_enc.js` and `webp_enc.wasm` (plain build, without SIMD, so it runs everywhere).
- Why: Safari cannot make WebP from a canvas (WebKit bug 226950, WONTFIX). The editor uses this encoder
  only when `canvas.toBlob('image/webp')` returns another type. Runs in a Web Worker (`webp-worker.js`).
- Needs `'wasm-unsafe-eval'` in the admin's Content-Security-Policy (only for /admin/*).
