import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    applyLayoutEdits,
    buildAutoLayoutDocument,
    buildWidgets,
    findBroadcastLinks,
    formatWidgetValue,
    locateCanvasNode,
    parseWorkflowCanvasDocument,
    resolveGraphAtPath,
    SUBGRAPH_INPUT_NODE_ID,
    SUBGRAPH_OUTPUT_NODE_ID,
    toDisplayNodeId
} from '../workflowCanvasModel';

const fixtureDir = resolve(process.cwd(), 'src-tauri/src/metadata/comfyui/tests/fixtures/official_catalog');
const readWorkflowChunk = (name: string) =>
    (JSON.parse(readFileSync(resolve(fixtureDir, name), 'utf8')) as { workflow: string }).workflow;

describe('parseWorkflowCanvasDocument', () => {
    it('keeps saved positions, links, groups and names KSampler widgets', () => {
        const document = parseWorkflowCanvasDocument(readWorkflowChunk('default.chunks.json'));

        expect(document).not.toBeNull();
        expect(document!.hasSavedLayout).toBe(true);
        expect(document!.root.nodes).toHaveLength(11);
        expect(document!.root.links).toHaveLength(9);
        expect(document!.root.groups).toHaveLength(3);

        const sampler = document!.root.nodeById.get('3')!;
        expect(sampler.type).toBe('KSampler');
        expect(sampler.inputs.map((input) => input.name)).toEqual(['model', 'positive', 'negative', 'latent_image']);
        expect(sampler.widgets.map((widget) => widget.name)).toEqual([
            'seed', 'control_after_generate', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise'
        ]);
        expect(sampler.widgets[1].value).toBe('randomize');

        for (const link of document!.root.links) {
            expect(document!.root.nodeById.has(link.originId)).toBe(true);
            expect(document!.root.nodeById.has(link.targetId)).toBe(true);
        }
    });

    it('builds subgraph definitions with their IO nodes and addresses inner nodes by display id', () => {
        const document = parseWorkflowCanvasDocument(readWorkflowChunk('02_qwen_Image_edit_subgraphed.chunks.json'));
        expect(document).not.toBeNull();

        const instance = document!.root.nodeById.get('141')!;
        expect(instance.subgraphId).toBe('6b4b0518-e42a-4e8b-a377-f0da6dacfcac');
        expect(instance.title).toBe('New Subgraph');
        // Promoted widget inputs anchor to their widget rows instead of slot rows.
        expect(instance.inputs.find((input) => input.name === 'positive_prompt')?.widgetName).toBe('prompt');

        const subgraph = document!.subgraphs.get(instance.subgraphId!)!;
        expect(subgraph.nodeById.has(SUBGRAPH_INPUT_NODE_ID)).toBe(true);
        expect(subgraph.nodeById.has(SUBGRAPH_OUTPUT_NODE_ID)).toBe(true);
        expect(subgraph.nodeById.get(SUBGRAPH_INPUT_NODE_ID)!.outputs.map((slot) => slot.name)).toContain('positive_prompt');
        expect(subgraph.links).toHaveLength(29);

        expect(locateCanvasNode(document!, '141:126')).toEqual({ path: ['141'], nodeId: '126' });
        expect(locateCanvasNode(document!, '141')).toEqual({ path: [], nodeId: '141' });
        expect(locateCanvasNode(document!, '999:126')).toBeNull();
        expect(resolveGraphAtPath(document!, ['141']).graph).toBe(subgraph);
        expect(resolveGraphAtPath(document!, ['78']).path).toEqual([]);
        expect(toDisplayNodeId(['141'], '126')).toBe('141:126');
    });

    it('rejects API prompts and invalid JSON, which carry no layout', () => {
        expect(parseWorkflowCanvasDocument('{"3":{"class_type":"KSampler","inputs":{}}}')).toBeNull();
        expect(parseWorkflowCanvasDocument('not json')).toBeNull();
        expect(parseWorkflowCanvasDocument(undefined)).toBeNull();
    });

    it('reads object-form links and legacy object positions', () => {
        const document = parseWorkflowCanvasDocument(JSON.stringify({
            nodes: [
                { id: 1, type: 'A', pos: { 0: 10, 1: 20 }, size: [100, 50], outputs: [{ name: 'out', type: 'IMAGE', links: [7] }] },
                { id: 2, type: 'B', pos: [200, 20], size: [100, 50], inputs: [{ name: 'in', type: 'IMAGE', link: 7 }] }
            ],
            links: [{ id: 7, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0, type: 'IMAGE' }]
        }));

        expect(document!.root.nodeById.get('1')).toMatchObject({ x: 10, y: 20 });
        expect(document!.root.links).toEqual([
            { id: '7', originId: '1', originSlot: 0, targetId: '2', targetSlot: 0, type: 'IMAGE' }
        ]);
    });
});

describe('buildWidgets', () => {
    it('prefers API prompt names for the same node class and flags long text as multiline', () => {
        const widgets = buildWidgets(
            'CustomSampler',
            [42, 'fixed', 'a long prompt '.repeat(10)],
            [],
            { class_type: 'CustomSampler', inputs: { noise_seed: 42, model: ['4', 0], text: 'x' } }
        );

        expect(widgets.map((widget) => [widget.name, widget.multiline])).toEqual([
            ['noise_seed', false],
            ['control_after_generate', false],
            ['text', true]
        ]);
    });

    it('keeps a linked widget in place when the prompt holds a link for it', () => {
        // Older frontends list only converted widgets in `inputs`; seed is fed by a primitive here.
        const widgets = buildWidgets(
            'KSampler',
            [7, 'randomize', 30, 5.5, 'euler', 'normal', 1],
            [{ name: 'model', link: 1 }, { name: 'seed', link: 9, widget: { name: 'seed' } }],
            {
                class_type: 'KSampler',
                inputs: { seed: ['12', 0], steps: 30, cfg: 5.5, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0] }
            }
        );
        expect(widgets.map((widget) => widget.name)).toEqual(['seed', 'control_after_generate', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise']);
    });

    it('does not shift names when inputs list only some widgets and there is no prompt', () => {
        const widgets = buildWidgets('IPAdapterAdvanced', [0.8, 'linear', 'concat', 0, 1, 'V only'], [
            { name: 'model', link: 1 },
            { name: 'weight', link: 4, widget: { name: 'weight' } }
        ]);
        expect(widgets.map((widget) => widget.name)).toEqual(['weight', 'weight_type', 'combine_embeds', 'start_at', 'end_at', 'embeds_scaling']);
    });

    it('names popular custom nodes from the built-in table', () => {
        expect(buildWidgets('AIO_Preprocessor', ['DepthAnythingV2Preprocessor', 1024], []).map((widget) => widget.name))
            .toEqual(['preprocessor', 'resolution']);
        expect(buildWidgets('LoadImage', ['cat.png', 'image'], []).map((widget) => widget.name)).toEqual(['image', 'upload']);
        expect(buildWidgets('SomethingUnknown', [1, 2], []).map((widget) => widget.name)).toEqual(['', '']);
    });

    it('prefers core names when a Registry pack reuses a core class name', () => {
        // An unrelated Registry pack also ships a "StringConcatenate" (frame_a, frame_b, ...).
        expect(buildWidgets('StringConcatenate', ['a', 'b', ', '], []).map((widget) => widget.name))
            .toEqual(['string_a', 'string_b', 'delimiter']);
    });

    it('names an older custom node version the Registry no longer lists', () => {
        expect(buildWidgets('SeedVR2', ['seedvr2_ema_3b_fp16.safetensors', 918769129, 'randomize', 1072, 1, false], []).map((widget) => widget.name))
            .toEqual(['model', 'seed', 'control_after_generate', 'new_resolution', 'batch_size', 'preserve_vram']);
    });

    it('leaves out extension state saved after the real widgets', () => {
        expect(buildWidgets('CLIPTextEncode', ['a cat', [false, true]], [])).toEqual([{ name: 'text', value: 'a cat', multiline: false }]);
        expect(buildWidgets('BNK_CLIPTextEncodeAdvanced', ['a cat', 'mean', 'A1111', [false, true]], []).map((widget) => widget.name))
            .toEqual(['text', 'token_normalization', 'weight_interpretation']);
    });

    it('uses object widget values as named entries and skips nested objects', () => {
        expect(buildWidgets('VHS_VideoCombine', { frame_rate: 8, videopreview: { hidden: false } }, []))
            .toEqual([{ name: 'frame_rate', value: '8', multiline: false }]);
    });
});

describe('formatWidgetValue', () => {
    it('formats numbers, booleans and Power Lora rows', () => {
        expect(formatWidgetValue(0.30000000000000004)).toBe('0.3');
        expect(formatWidgetValue(false)).toBe('false');
        expect(formatWidgetValue(null)).toBeNull();
        expect(formatWidgetValue({ on: true, lora: 'detail.safetensors', strength: 0.8 })).toBe('● detail.safetensors 0.8');
    });
});

describe('buildAutoLayoutDocument', () => {
    it('places downstream nodes in later columns and maps edges to slots', () => {
        const document = buildAutoLayoutDocument(
            [
                { id: '9', title: 'Save', type: 'SaveImage', inputs: { filename_prefix: 'out', images: ['8', 0] } },
                { id: '4', title: 'Load', type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'model.safetensors' } },
                { id: '8', title: 'Decode', type: 'VAEDecode', inputs: {} }
            ],
            [
                { sourceNodeId: '4', sourceOutputSlot: 2, targetNodeId: '8', targetInputName: 'vae' },
                { sourceNodeId: '8', sourceOutputSlot: 0, targetNodeId: '9', targetInputName: 'images' }
            ]
        )!;

        const x = (id: string) => document.root.nodeById.get(id)!.x;
        expect(document.hasSavedLayout).toBe(false);
        expect(x('4')).toBeLessThan(x('8'));
        expect(x('8')).toBeLessThan(x('9'));
        expect(document.root.nodeById.get('4')!.outputs).toHaveLength(3);
        expect(document.root.nodeById.get('9')!.widgets).toEqual([{ name: 'filename_prefix', value: 'out', multiline: false }]);
        expect(document.root.links.map((link) => [link.originId, link.originSlot, link.targetId, link.targetSlot]))
            .toEqual([['4', 2, '8', 0], ['8', 0, '9', 0]]);
    });

    it('returns null for an empty graph', () => {
        expect(buildAutoLayoutDocument([], [])).toBeNull();
    });
});

describe('applyLayoutEdits', () => {
    it('applies moves, resizes, collapse, group edits and draw order without mutating the saved graph', () => {
        const document = parseWorkflowCanvasDocument(JSON.stringify({
            nodes: [
                { id: 1, type: 'A', pos: [0, 0], size: [100, 50] },
                { id: 2, type: 'B', pos: [200, 0], size: [100, 50] }
            ],
            links: [],
            groups: [{ title: 'G', bounding: [-10, -50, 400, 200] }]
        }))!;
        const saved = document.root;

        expect(applyLayoutEdits(saved, undefined)).toBe(saved);
        const edited = applyLayoutEdits(saved, {
            nodes: new Map([['1', { x: 40, y: 60, width: 180, collapsed: true }]]),
            groups: new Map([['0', { x: 0, y: 0, width: 500, height: 300 }]]),
            order: ['1']
        });

        expect(edited.nodeById.get('1')).toMatchObject({ x: 40, y: 60, width: 180, height: 50, collapsed: true });
        expect(edited.nodeById.get('2')).toBe(saved.nodeById.get('2'));
        expect(edited.nodes.map((node) => node.id)).toEqual(['2', '1']);
        expect(edited.groups[0]).toMatchObject({ id: '0', title: 'G', x: 0, y: 0, width: 500, height: 300 });
        expect(saved.nodeById.get('1')).toMatchObject({ x: 0, y: 0, width: 100, collapsed: false });
        expect(saved.groups[0]).toMatchObject({ x: -10, width: 400 });
    });
});

describe('findBroadcastLinks', () => {
    const graphFor = (emitter: Record<string, unknown>, links: unknown[] = [[1, 1, 0, 9, 0, 'MODEL']]) => parseWorkflowCanvasDocument(JSON.stringify({
        nodes: [
            { id: 1, type: 'CheckpointLoaderSimple', pos: [0, 0], size: [200, 100], outputs: [{ name: 'MODEL', type: 'MODEL', links: [1] }] },
            { id: 2, type: 'CLIPTextEncode', pos: [0, 200], size: [200, 100], outputs: [{ name: 'CONDITIONING', type: 'CONDITIONING', links: [3] }] },
            { id: 3, type: 'CLIPTextEncode', pos: [0, 400], size: [200, 100], outputs: [{ name: 'CONDITIONING', type: 'CONDITIONING', links: [4] }] },
            { id: 9, pos: [300, 0], size: [200, 100], ...emitter },
            {
                id: 5, type: 'KSampler', pos: [600, 0], size: [300, 300],
                inputs: [
                    { name: 'model', type: 'MODEL', link: null },
                    { name: 'positive', type: 'CONDITIONING', link: null },
                    { name: 'negative', type: 'CONDITIONING', link: null },
                    { name: 'latent_image', type: 'LATENT', link: 7 },
                    { name: 'seed', type: 'INT', link: null, widget: { name: 'seed' } }
                ],
                widgets_values: [1, 'fixed', 20, 7, 'euler', 'normal', 1]
            },
            { id: 6, type: 'LoraLoader', title: 'Detail LoRA', pos: [600, 400], size: [300, 100], inputs: [{ name: 'model', type: 'MODEL', link: null }] }
        ],
        links,
        groups: [{ title: 'Sampling', bounding: [550, -50, 400, 400] }]
    }))!.root;
    const targets = (links: ReturnType<typeof findBroadcastLinks>) => links.map((link) => `${link.targetId}:${link.targetSlot}:${link.type}`);

    it('feeds every unconnected input of the same type from Anything Everywhere', () => {
        const graph = graphFor({ type: 'Anything Everywhere', inputs: [{ name: 'anything', type: '*', link: 1 }] });
        expect(targets(findBroadcastLinks(graph, '9'))).toEqual(['5:0:MODEL', '6:0:MODEL']);
        expect(findBroadcastLinks(graph, '5')).toEqual([]);
    });

    it('narrows Anything Everywhere? by title and group regexes', () => {
        const byTitle = graphFor({ type: 'Anything Everywhere?', inputs: [{ name: 'anything', type: '*', link: 1 }], widgets_values: ['LoRA', '.*', '.*'] });
        expect(targets(findBroadcastLinks(byTitle, '9'))).toEqual(['6:0:MODEL']);
        const byGroup = graphFor({ type: 'Anything Everywhere?', inputs: [{ name: 'anything', type: '*', link: 1 }], widgets_values: ['.*', '.*', '^Sampling$'] });
        expect(targets(findBroadcastLinks(byGroup, '9'))).toEqual(['5:0:MODEL']);
    });

    it('routes Prompts Everywhere by positive/negative names and Seed Everywhere to seed widgets', () => {
        const prompts = graphFor({
            type: 'Prompts Everywhere',
            inputs: [{ name: '+ve', type: 'CONDITIONING', link: 3 }, { name: '-ve', type: 'CONDITIONING', link: 4 }]
        }, [[3, 2, 0, 9, 0, 'CONDITIONING'], [4, 3, 0, 9, 1, 'CONDITIONING']]);
        expect(findBroadcastLinks(prompts, '9').map((link) => [link.emitterSlot, link.targetSlot])).toEqual([[0, 1], [1, 2]]);

        const seed = graphFor({ type: 'Seed Everywhere', widgets_values: [42, 'fixed'] });
        expect(targets(findBroadcastLinks(seed, '9'))).toEqual(['5:4:INT']);
    });

    it('uses the links Use Everywhere recorded and ignores the link ids it removed on save', () => {
        // Shape saved by recent cg-use-everywhere: targets keep ids of links listed in
        // `extra.links_added_by_ue` that are no longer in `links`, and `extra.ue_links` holds the truth.
        const document = parseWorkflowCanvasDocument(JSON.stringify({
            nodes: [
                { id: 1, type: 'CheckpointLoaderSimple', pos: [0, 0], size: [200, 100], outputs: [{ name: 'MODEL', type: 'MODEL', links: [1] }, { name: 'VAE', type: 'VAE', links: [2] }] },
                {
                    id: 9, type: 'Anything Everywhere3', pos: [300, 0], size: [200, 100],
                    inputs: [{ name: 'anything', label: 'MODEL', type: '*', link: 1 }, { name: 'anything2', label: 'VAE', type: '*', link: 2 }]
                },
                { id: 5, type: 'KSampler', pos: [600, 0], size: [300, 300], inputs: [{ name: 'model', type: 'MODEL', link: 50 }] },
                { id: 6, type: 'VAEDecode', pos: [600, 400], size: [200, 100], inputs: [{ name: 'samples', type: 'LATENT', link: 3 }, { name: 'vae', type: 'VAE', link: 51 }] },
                { id: 7, type: 'LoraLoader', pos: [600, 600], size: [200, 100], inputs: [{ name: 'model', type: 'MODEL', link: null }] }
            ],
            links: [[1, 1, 0, 9, 0, 'MODEL'], [2, 1, 1, 9, 1, 'VAE'], [3, 5, 0, 6, 0, 'LATENT']],
            extra: {
                links_added_by_ue: [50, 51],
                ue_links: [
                    { downstream: 5, downstream_slot: 0, upstream: '1', upstream_slot: 0, controller: 9, type: 'MODEL' },
                    { downstream: 6, downstream_slot: 1, upstream: '1', upstream_slot: 1, controller: 9, type: 'VAE' }
                ]
            }
        }))!;
        const graph = document.root;

        expect(graph.nodeById.get('5')!.inputs[0].linked).toBe(false);
        expect(graph.nodeById.get('6')!.inputs.map((input) => input.linked)).toEqual([true, false]);
        // Recorded links win over matching, which would also have picked the unconnected LoRA input.
        expect(findBroadcastLinks(graph, '9')).toEqual([
            { emitterId: '9', emitterSlot: 0, targetId: '5', targetSlot: 0, type: 'MODEL' },
            { emitterId: '9', emitterSlot: 1, targetId: '6', targetSlot: 1, type: 'VAE' }
        ]);
    });

    it('ignores bypassed emitters', () => {
        const graph = graphFor({ type: 'Anything Everywhere', mode: 4, inputs: [{ name: 'anything', type: '*', link: 1 }] });
        expect(findBroadcastLinks(graph, '9')).toEqual([]);
    });
});
