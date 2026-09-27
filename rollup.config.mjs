import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import copy from 'rollup-plugin-copy';

const sidepanel = {
  input: 'sidepanel/index.js',
  output: {
    dir: 'dist/sidepanel',
    format: 'iife',
    inlineDynamicImports: true,
  },
  plugins: [
    commonjs(),
    nodeResolve(),
    copy({
      targets: [
        { src: 'manifest.json', dest: 'dist' },
        { src: 'background.js', dest: 'dist' },
        { src: 'images', dest: 'dist' },
        { src: 'scripts', dest: 'dist' },
        { src: ['sidepanel/index.html', 'sidepanel/index.css'], dest: 'dist/sidepanel' },
        { src: 'models', dest: 'dist' },
        {
          src: [
            'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs',
            'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm',
          ],
          dest: 'dist/ort',
        },
      ],
    }),
  ],
};

// The local model runs in a module worker so inference doesn't block the side panel.
const localModelWorker = {
  input: 'sidepanel/localModelWorker.js',
  output: {
    file: 'dist/sidepanel/localModelWorker.js',
    format: 'es',
    inlineDynamicImports: true,
  },
  plugins: [commonjs(), nodeResolve()],
};

export default [sidepanel, localModelWorker];
