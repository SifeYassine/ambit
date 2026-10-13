import assert from 'node:assert/strict';
import test from 'node:test';

import { buildWidgetTable, deriveWidgets } from './generate-comfy-registry-widgets.mjs';

test('derives widgets the way the ComfyUI frontend builds them', () => {
  const widgets = deriveWidgets({
    required: {
      model: ['MODEL'],
      seed: ['INT', { default: 0, control_after_generate: true }],
      steps: ['INT', { default: 20 }],
      cfg: ['FLOAT', { default: 8 }],
      sampler_name: [['euler', 'dpmpp_2m']],
      scheduler: ['COMBO', { options: ['normal', 'karras'] }],
      text: ['STRING', { multiline: true, forceInput: true }],
    },
    optional: {
      image: [['a.png'], { image_upload: true }],
      enabled: ['BOOLEAN', { default: true }],
    },
    hidden: { prompt: 'PROMPT' },
  });

  assert.deepEqual(widgets, [
    { name: 'seed', kind: 'I' },
    { name: 'steps', kind: 'i' },
    { name: 'cfg', kind: 'f' },
    { name: 'sampler_name', kind: 'c' },
    { name: 'scheduler', kind: 'c' },
    { name: 'image', kind: 'c' },
    { name: 'upload', kind: 'u' },
    { name: 'enabled', kind: 'b' },
  ]);
});

test('honors input_order and treats legacy seed names as seed widgets', () => {
  assert.deepEqual(deriveWidgets({
    required: { b: ['FLOAT'], noise_seed: ['INT'] },
    input_order: { required: ['noise_seed', 'b'] },
  }), [{ name: 'noise_seed', kind: 'I' }, { name: 'b', kind: 'f' }]);
});

test('keeps each distinct widget list per node as a version variant, most common first', () => {
  const entry = (inputTypes) => ({ comfy_node_name: 'Upscale', input_types: JSON.stringify(inputTypes) });
  const older = { required: { scale: ['FLOAT'] } };
  const newer = { required: { scale: ['FLOAT'], method: [['lanczos']] } };
  const table = buildWidgetTable([
    entry(newer),
    entry(older),
    entry(newer),
    { comfy_node_name: 'Broken', input_types: '{not json' },
    { comfy_node_name: 'NoWidgets', input_types: JSON.stringify({ required: { image: ['IMAGE'] } }) },
  ]);

  assert.deepEqual(table.names, ['scale', 'method']);
  assert.deepEqual(table.nodes, { Upscale: [['fc', 0, 1], ['f', 0]] });
  assert.equal(table.skipped, 1);
});
