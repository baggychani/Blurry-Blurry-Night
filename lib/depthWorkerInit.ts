/// <reference lib="webworker" />

/** Next/Webpack 워커 번들에서 process.env가 비어 있을 때 Transformers 등이 Object.keys에 실패하지 않도록 */
if (typeof process !== "undefined" && !process.env) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process as any).env = {};
}
