import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage, type ImageMetadata } from '../../../../../types';
import { MetadataInfoTab } from '../MetadataInfoTab';
import type { ComponentProps } from 'react';

vi.mock('../MetadataRawInspector', () => ({ MetadataRawInspector: () => <div>raw inspector</div> }));
vi.mock('../HighlightedPromptText', () => ({
    HighlightedPromptText: ({ text, terms }: { text: string; terms?: string[] }) => <span data-terms={terms?.join('|')}>{text}</span>,
}));

const metadata = (overrides: Partial<ImageMetadata> = {}): ImageMetadata => ({
    tool: GeneratorTool.UNKNOWN,
    model: 'Unknown',
    seed: 1,
    steps: 20,
    cfg: 7,
    sampler: 'Euler',
    positivePrompt: 'Original prompt',
    negativePrompt: '',
    ...overrides,
});

const image = (current: ImageMetadata, original: ImageMetadata, overrides: Partial<AIImage> = {}): AIImage => ({
    id: 'C:/library/image.png',
    url: 'asset://image.png',
    thumbnailUrl: 'asset://thumb.webp',
    filename: 'image.png',
    timestamp: 1,
    width: 100,
    height: 100,
    isFavorite: false,
    metadata: current,
    originalMetadata: original,
    ...overrides,
});

const renderTab = (value: AIImage, overrides: Partial<ComponentProps<typeof MetadataInfoTab>> = {}) => {
    const props: ComponentProps<typeof MetadataInfoTab> = {
        image: value,
        onAIAnalysis: vi.fn(),
        onGenerateVariations: vi.fn(),
        isAnalyzing: false,
        ...overrides,
    };
    return { ...render(<MetadataInfoTab {...props} />), props };
};

/** A parameter's label row (key and source badge) and value box. */
const parameterRow = (label: string): HTMLElement => screen.getByText(label).parentElement?.parentElement as HTMLElement;

describe('MetadataInfoTab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                readText: vi.fn().mockResolvedValue(''),
                writeText: vi.fn().mockResolvedValue(undefined),
            },
        });
    });

    it('uses the compact metadata layout and preserves explicit zero values', () => {
        renderTab(image(metadata({ seed: 0, steps: 0, cfg: 0 }), metadata({ seed: 0, steps: 0, cfg: 0 })));

        expect(screen.queryByText('Generation Data')).toBeNull();
        const parameters = screen.getByLabelText('Generation parameters');
        expect(parameters.textContent).toContain('Seed0');
        expect(parameters.textContent).toContain('StepsUnknown');
        expect(parameters.textContent).toContain('CFGUnknown');
        expect(screen.getByRole('button', { name: 'Copy generation data' }).closest('section')?.contains(parameters)).toBe(true);
        const heading = screen.getByRole('heading', { name: 'Generation parameters' });
        expect(heading.closest('section')).toBe(parameters.closest('section'));
        expect(heading.parentElement?.parentElement).not.toBe(parameters.parentElement);
    });

    it('places prompts before other generation metadata', () => {
        renderTab(image(metadata(), metadata()));

        const positivePrompt = screen.getByLabelText('Positive prompt');
        const negativePrompt = screen.getByLabelText('Negative prompt');
        const generator = screen.getByRole('heading', { name: 'Generator software' });
        expect(positivePrompt.compareDocumentPosition(negativePrompt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(negativePrompt.compareDocumentPosition(generator) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.getByText('Creative Assistant').closest('.shrink-0')).toBeTruthy();
    });

    it('copies prompt text and clears feedback after two seconds', () => {
        vi.useFakeTimers();
        renderTab(image(metadata(), metadata()));
        fireEvent.click(screen.getByRole('button', { name: 'Copy Prompt' }));
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Original prompt');
        act(() => vi.advanceTimersByTime(2000));
        vi.useRealTimers();
    });

    it('renders only populated optional parameter and resource rows', () => {
        renderTab(image(metadata({
            hiresSteps: 10,
            loras: ['detail-lora'],
        }), metadata()));

        expect(parameterRow('Hires Steps').textContent).toContain('10');
        expect(screen.queryByText('Hires Upscale')).toBeNull();
        expect(screen.queryByText('ControlNet')).toBeNull();
        expect(screen.getByText('detail-lora')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /detail-lora/i })).toBeNull();
    });

    it('groups populated resources without a smart tags section', () => {
        renderTab(image(metadata({
            positivePrompt: 'portrait, dramatic lighting',
            loras: ['detail-lora'],
        }), metadata()));

        const resourcesSection = screen.getByRole('heading', { name: 'Resources' }).closest('section');
        const loraSection = screen.getByRole('heading', { name: 'LoRAs' }).closest('section');
        expect(loraSection?.parentElement?.closest('section')).toBe(resourcesSection);
        expect(screen.queryByText('Smart Tags')).toBeNull();
        expect(screen.queryByRole('button', { name: 'portrait' })).toBeNull();
        expect(screen.getByText('detail-lora').parentElement?.className).toContain('rounded-lg');
    });

    it('shows resource weights from the name or from the parser weight maps', () => {
        renderTab(image(metadata({
            loras: ['frostbite', 'a1111 style (0.8)', 'unweighted'],
            loraWeights: { frostbite: 0.7500000000000001 },
            controlNets: ['control_v11p_sd15_openpose'],
            controlNetWeights: { control_v11p_sd15_openpose: 0.3 },
            ipAdapters: ['noob_ipa'],
            ipAdapterWeights: { noob_ipa: 0.55 },
        }), metadata()));

        const weightOf = (name: string) => screen.getByText(name).parentElement?.querySelector('[title="Weight"]')?.textContent ?? null;
        expect(weightOf('frostbite')).toBe('0.75');
        expect(weightOf('a1111 style')).toBe('0.80');
        expect(weightOf('unweighted')).toBeNull();
        expect(weightOf('control_v11p_sd15_openpose')).toBe('0.30');
        expect(weightOf('noob_ipa')).toBe('0.55');
    });

    it('puts each parameter key above its own value box', () => {
        renderTab(image(metadata({ sampler: 'DDIM' }), metadata()));

        const value = screen.getByText('DDIM');
        expect(value.tagName).toBe('DD');
        expect(value.className).toContain('rounded-lg');
        expect(value.contains(screen.getByText('Sampler'))).toBe(false);
        expect(parameterRow('Sampler').contains(value)).toBe(true);
    });

    it('shows a resolved model name with its hash as supporting data', () => {
        renderTab(image(
            metadata({ model: 'Resolved Model', modelHash: 'f8bb2922e1' }),
            metadata({ model: 'Resolved Model', modelHash: 'f8bb2922e1' }),
        ));

        expect(screen.getByText('Resolved Model')).toBeTruthy();
        expect(screen.queryByText('Unresolved hash')).toBeNull();
        expect(parameterRow('Model Hash').textContent).toContain('f8bb2922e1');
    });

    it('places InvokeAI provenance first for assets and later for generated images', () => {
        const asset = image(metadata(), metadata(), {
            invokeImageName: 'control-source.png',
            invokeImageCategory: 'control',
        });
        const { rerender, props } = renderTab(asset);
        const assetSource = screen.getByRole('heading', { name: 'Source' });
        const assetGenerator = screen.getByRole('heading', { name: 'Generator software' });
        expect(assetSource.compareDocumentPosition(assetGenerator) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

        rerender(<MetadataInfoTab {...props} image={image(metadata(), metadata(), {
            invokeImageName: 'generation.png',
            invokeImageCategory: 'general',
        })} />);
        const generatedSource = screen.getByRole('heading', { name: 'Source' });
        const parameters = screen.getByLabelText('Generation parameters');
        expect(parameters.compareDocumentPosition(generatedSource) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(generatedSource.compareDocumentPosition(screen.getByText('raw inspector')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('highlights both prompts in their single formatted read surfaces', () => {
        renderTab(image(metadata({
            positivePrompt: 'portrait,\ndramatic lighting',
            negativePrompt: 'bad anatomy',
        }), metadata()), {
            searchHighlights: { positivePrompt: ['portrait'], negativePrompt: ['anatomy'] },
        });

        const positiveHighlight = document.querySelectorAll('[data-terms="portrait"]');
        const negativeHighlight = document.querySelectorAll('[data-terms="anatomy"]');
        expect(positiveHighlight).toHaveLength(1);
        expect(negativeHighlight).toHaveLength(1);
        expect(positiveHighlight[0]?.textContent).toBe('portrait,\ndramatic lighting');
        expect(negativeHighlight[0]?.textContent).toBe('bad anatomy');
        expect(screen.getByRole('textbox', { name: 'Positive prompt' }).className).toContain('whitespace-pre-wrap');
    });

    it('wires creative assistant controls and busy state', () => {
        const { props, rerender } = renderTab(image(metadata(), metadata()), { onOpenAIResult: vi.fn() });
        const assistantHeading = screen.getByText('Creative Assistant');
        expect(assistantHeading.className).toContain('text-amethyst-600');
        expect(assistantHeading.className).toContain('dark:text-amethyst-300');
        fireEvent.click(screen.getByRole('button', { name: /prompt analysis/i }));
        fireEvent.click(screen.getByRole('button', { name: /variations/i }));
        fireEvent.click(screen.getByRole('button', { name: /view last result/i }));
        expect(props.onAIAnalysis).toHaveBeenCalledTimes(1);
        expect(props.onGenerateVariations).toHaveBeenCalledTimes(1);
        expect(props.onOpenAIResult).toHaveBeenCalledTimes(1);

        rerender(<MetadataInfoTab {...props} isAnalyzing />);
        expect(screen.getByText('Analyzing...')).toBeTruthy();
        expect(screen.getByText('Creating...')).toBeTruthy();
    });
});
