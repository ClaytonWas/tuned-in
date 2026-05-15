import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import copy from 'rollup-plugin-copy';

export default {
  input: 'sidepanel/index.js',
  output: {
    dir: 'dist/sidepanel',
    format: 'iife',
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
      ],
    }),
  ],
};
