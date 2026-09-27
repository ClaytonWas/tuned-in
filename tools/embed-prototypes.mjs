// Precomputes tag-description embeddings so the extension doesn't embed them on every panel open.
// Runs the same model file the extension ships, so vectors match what it would compute at runtime.
import { writeFile } from 'node:fs/promises';
import { AutoModel, AutoTokenizer, env } from '@huggingface/transformers';
import { MODEL_ID, TASK_PREFIX, PROTOTYPE_SETS, prototypeText } from '../sidepanel/prototypes.js';

env.allowRemoteModels = false;
env.localModelPath = new URL('../models/', import.meta.url).pathname;

const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
const model = await AutoModel.from_pretrained(MODEL_ID, { dtype: 'q4', model_file_name: 'model_no_gather' });

const texts = Object.values(PROTOTYPE_SETS).flatMap(p => Object.entries(p).map(([tag, desc]) => prototypeText(tag, desc)));
const inputs = tokenizer(texts.map(t => TASK_PREFIX + t), { padding: true, truncation: true });
const { sentence_embedding } = await model(inputs);
const vecs = sentence_embedding.normalize(2, -1).tolist();

// Four decimals keeps the file small without changing any rankings.
const vectors = Object.fromEntries(texts.map((t, i) => [t, vecs[i].map(x => Math.round(x * 1e4) / 1e4)]));
await writeFile('models/prototypes.json', JSON.stringify({ model: MODEL_ID, prefix: TASK_PREFIX, vectors }));
console.log(`embedded ${texts.length} prototypes`);
