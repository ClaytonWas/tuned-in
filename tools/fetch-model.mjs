// Downloads the local fallback model into models/ so it can be bundled with the extension.
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname } from 'node:path';

const MODEL = 'onnx-community/embeddinggemma-300m-ONNX';
const FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'onnx/model_no_gather_q4.onnx',
  'onnx/model_no_gather_q4.onnx_data',
];

for (const file of FILES) {
  const dest = `models/${MODEL}/${file}`;
  try {
    await access(dest);
    continue;
  } catch {}
  const url = `https://huggingface.co/${MODEL}/resolve/main/${file}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`fetched ${dest}`);
}
