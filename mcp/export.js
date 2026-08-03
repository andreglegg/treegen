// Headless GLB/OBJ export. three's GLTFExporter uses the browser FileReader API
// for binary output, so we shim a minimal FileReader (backed by Blob.arrayBuffer)
// before the exporter runs in Node.
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer()
        .then((buf) => { this.result = buf; this.onloadend?.(); })
        .catch((err) => this.onerror?.(err));
    }
    readAsDataURL(blob) {
      blob.arrayBuffer()
        .then((buf) => {
          this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buf).toString('base64')}`;
          this.onloadend?.();
        })
        .catch((err) => this.onerror?.(err));
    }
  };
}

const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
const { OBJExporter } = await import('three/examples/jsm/exporters/OBJExporter.js');

export async function exportGlb(group) {
  const exporter = new GLTFExporter();
  const result = await new Promise((resolve, reject) => {
    exporter.parse(group, resolve, (err) => reject(err), { binary: true, onlyVisible: true, trs: false });
  });
  return Buffer.from(result); // binary export yields an ArrayBuffer
}

export function exportObj(group) {
  return new OBJExporter().parse(group);
}
