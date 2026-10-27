import * as React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '../../../../test/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage } from '../../../../types';
import { CompareModal } from '../CompareModal';
import { useSettingsStore } from '../../../../stores/settingsStore';

const resizeMocks = vi.hoisted(() => ({
    observe: vi.fn(),
    disconnect: vi.fn(),
    callbacks: [] as ResizeObserverCallback[]
}));

vi.mock('../../../library/components/SmartImage', () => ({
    SmartImage: ({ src, alt, style }: { src: string; alt: string; style?: React.CSSProperties }) => (
        <img src={src} alt={alt} style={style} />
    )
}));

const computeImageFileHashMock = vi.hoisted(() => vi.fn());
vi.mock('../../../../services/db/maintenanceRepo', () => ({
    computeImageFileHash: computeImageFileHashMock,
}));

const originalResizeObserverDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');

const createImage = (id: string, overrides: Partial<AIImage> = {}): AIImage => ({
    id,
    url: `file:///${id}.png`,
    thumbnailUrl: `file:///${id}-thumb.png`,
    filename: `C:/images/${id}.png`,
    timestamp: 1,
    width: 800,
    height: 600,
    isFavorite: false,
    isPinned: false,
    metadata: {
        tool: GeneratorTool.COMFYUI,
        model: id === 'a' ? 'Model A' : 'Model B',
        seed: id === 'a' ? 1 : 2,
        steps: id === 'a' ? 20 : 30,
        cfg: id === 'a' ? 7 : 8,
        sampler: 'Euler',
        positivePrompt: id === 'a' ? 'red sunset over ocean' : 'blue sunrise above mountains',
        negativePrompt: ''
    },
    ...overrides
});

const rect = (overrides: Partial<DOMRect> = {}): DOMRect => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 1000,
    bottom: 600,
    width: 1000,
    height: 600,
    toJSON: () => ({}),
    ...overrides
});

const renderModal = (overrides: Partial<React.ComponentProps<typeof CompareModal>> = {}) => {
    const props: React.ComponentProps<typeof CompareModal> = {
        imageA: createImage('a'),
        imageB: createImage('b', { isPinned: true }),
        onClose: vi.fn(),
        onToggleFavorite: vi.fn(),
        onTogglePin: vi.fn(),
        ...overrides
    };
    return { props, ...render(<CompareModal {...props} />) };
};

describe('CompareModal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resizeMocks.callbacks.length = 0;
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => rect());
        Reflect.deleteProperty(globalThis, 'ResizeObserver');
        useSettingsStore.setState({
            privacyEnabled: true,
            privacyMaskIndexStatus: 'ready',
        });
    });

    it('closes without rendering images when privacy protection is stale', async () => {
        useSettingsStore.setState({ privacyMaskIndexStatus: 'pending' });
        const onClose = vi.fn();

        renderModal({ onClose });

        await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
        expect(document.querySelector('img')).toBeNull();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        if (originalResizeObserverDescriptor) {
            Object.defineProperty(globalThis, 'ResizeObserver', originalResizeObserverDescriptor);
        } else {
            Reflect.deleteProperty(globalThis, 'ResizeObserver');
        }
    });

    it('renders metadata and prompt differences and forwards image actions', () => {
        const onToggleFavorite = vi.fn();
        const onTogglePin = vi.fn();
        renderModal({ onToggleFavorite, onTogglePin });

        expect(screen.getByText('Comparison')).toBeTruthy();
        expect(screen.getByText('a.png')).toBeTruthy();
        expect(screen.getByText('b.png')).toBeTruthy();
        expect(screen.getByText('Model A')).toBeTruthy();
        expect(screen.getByText('Model B')).toBeTruthy();
        expect(screen.getByText('Removed')).toBeTruthy();
        expect(screen.getByText('Added')).toBeTruthy();

        const favorites = screen.getAllByRole('button', { name: 'Add to Favorites' });
        fireEvent.mouseDown(favorites[0]);
        fireEvent.click(favorites[0]);
        fireEvent.click(favorites[1]);
        expect(onToggleFavorite).toHaveBeenNthCalledWith(1, 'a');
        expect(onToggleFavorite).toHaveBeenNthCalledWith(2, 'b');

        const pinButton = screen.getAllByRole('button', { name: 'Pin to Top' })[0];
        fireEvent.mouseDown(pinButton);
        fireEvent.click(pinButton);
        fireEvent.click(screen.getByRole('button', { name: 'Unpin' }));
        expect(onTogglePin).toHaveBeenNthCalledWith(1, 'a', true);
        expect(onTogglePin).toHaveBeenNthCalledWith(2, 'b', false);
    });

    it('zooms, pans, resets, and drives swipe and overlay pointer modes', async () => {
        const { container } = renderModal();
        const root = container.firstElementChild as HTMLElement;
        const canvas = container.querySelector('.select-none') as HTMLElement;
        expect(canvas).toBeTruthy();

        fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });

        fireEvent.wheel(canvas, { clientX: 250, clientY: 200, deltaY: -500 });
        await waitFor(() => expect(screen.getByText('150%')).toBeTruthy());
        fireEvent.mouseDown(canvas, { clientX: 300, clientY: 250 });
        fireEvent.mouseMove(root, { clientX: 360, clientY: 290 });
        fireEvent.mouseUp(root);

        fireEvent.doubleClick(canvas, { clientX: 300, clientY: 250 });
        await waitFor(() => expect(screen.getByText('100%')).toBeTruthy());
        fireEvent.doubleClick(canvas, { clientX: 750, clientY: 250 });
        await waitFor(() => expect(screen.getByText('200%')).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: 'Reset Zoom' }));
        expect(screen.getByText('100%')).toBeTruthy();
        const zoomControls = screen.getByRole('button', { name: 'Reset Zoom' }).parentElement;
        if (!zoomControls) throw new Error('Zoom controls were not rendered');
        const zoomButtons = zoomControls.querySelectorAll('button');
        fireEvent.click(zoomButtons[0]);
        fireEvent.click(zoomButtons[1]);

        fireEvent.click(screen.getByText('Swipe'));
        fireEvent.wheel(canvas, { clientX: 500, clientY: 300, deltaY: -100 });
        const sliderHandle = container.querySelector('.group.cursor-ew-resize') as HTMLElement;
        expect(sliderHandle).toBeTruthy();
        fireEvent.mouseDown(sliderHandle, { clientX: 500, clientY: 300 });
        fireEvent.mouseMove(root, { clientX: 850, clientY: 300 });
        fireEvent.mouseUp(root);

        fireEvent.click(screen.getByText('Overlay'));
        fireEvent.mouseMove(root, { clientX: 500, clientY: 300 });
        expect(screen.queryByText('Hover to reveal comparison')).toBeNull();
        fireEvent.mouseLeave(root);
        fireEvent.click(screen.getByText('Split'));
    });

    it('switches prompt modes, toggles and resizes the sidebar, and handles identical prompts', () => {
        const identical = createImage('b', {
            metadata: {
                ...createImage('b').metadata,
                positivePrompt: 'red sunset over ocean'
            }
        });
        const { container } = renderModal({ imageB: identical });

        expect(screen.getByText('Prompts are identical')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Show Raw View' }));
        fireEvent.click(screen.getByRole('button', { name: 'Show Diff View' }));

        const panelToggle = screen.getByRole('button', { name: 'Hide Diff Sidebar' });
        fireEvent.click(panelToggle);
        fireEvent.click(panelToggle);

        const resizeHandle = container.querySelector('.cursor-ew-resize:not(.group)') as HTMLElement;
        expect(resizeHandle).toBeTruthy();
        fireEvent.mouseDown(resizeHandle, { clientX: 600 });
        fireEvent.mouseMove(window, { clientX: 300 });
        fireEvent.mouseUp(window);
    });

    it('shows raw prompt text and keeps canvas clicks from closing the modal', () => {
        const onClose = vi.fn();
        const { container } = renderModal({ onClose, onTogglePin: undefined });
        fireEvent.click(screen.getByRole('button', { name: 'Show Raw View' }));

        expect(screen.getByText('red sunset over ocean')).toBeTruthy();
        expect(screen.getByText('blue sunrise above mountains')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Pin to Top' })).toBeNull();

        const canvas = container.querySelector('.select-none') as HTMLElement;
        fireEvent.click(canvas);
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.click(container.firstElementChild as HTMLElement);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('uses ResizeObserver when available and disconnects it on unmount', async () => {
        class MockResizeObserver {
            constructor(callback: ResizeObserverCallback) {
                resizeMocks.callbacks.push(callback);
            }

            observe = resizeMocks.observe;
            disconnect = resizeMocks.disconnect;
            unobserve = vi.fn();
        }
        Object.defineProperty(globalThis, 'ResizeObserver', {
            configurable: true,
            writable: true,
            value: MockResizeObserver
        });

        const view = renderModal({
            imageA: createImage('a', { width: 0, height: 0 }),
            imageB: createImage('b', { width: 0, height: 0 })
        });
        expect(resizeMocks.observe).toHaveBeenCalled();

        await act(async () => {
            resizeMocks.callbacks[0]?.([], {} as ResizeObserver);
        });
        view.unmount();
        expect(resizeMocks.disconnect).toHaveBeenCalled();
    });

    it('renders favorite, unknown-seed, shared-word, and zero-size slider variants', () => {
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => rect({ width: 0, right: 0 }));
        const imageA = createImage('a', {
            isFavorite: true,
            width: 0,
            height: 0,
            metadata: {
                ...createImage('a').metadata,
                seed: undefined,
                positivePrompt: 'shared red',
            },
        });
        const imageB = createImage('b', {
            isFavorite: true,
            width: 0,
            height: 0,
            metadata: {
                ...createImage('b').metadata,
                seed: undefined,
                positivePrompt: 'shared blue',
            },
        });
        const { container } = renderModal({ imageA, imageB });

        expect(screen.getAllByRole('button', { name: 'Remove from Favorites' })).toHaveLength(2);
        expect(screen.getAllByText('Unknown')).toHaveLength(2);
        expect(screen.getAllByText('shared')).toHaveLength(2);

        fireEvent.click(screen.getByText('Swipe'));
        const root = container.firstElementChild as HTMLElement;
        const sliderHandle = container.querySelector('.group.cursor-ew-resize') as HTMLElement;
        fireEvent.mouseDown(sliderHandle, { clientX: 0, clientY: 0 });
        fireEvent.mouseMove(root, { clientX: 0, clientY: 0 });
        fireEvent.mouseUp(root);
    });

    it('diffs positive and negative prompts by tag before the generation settings', () => {
        const base = createImage('a');
        renderModal({
            imageA: { ...base, metadata: { ...base.metadata, positivePrompt: '1girl, (smile:0.7), blue eyes, castle, moonlight', negativePrompt: 'lowres, blurry' } },
            imageB: { ...base, id: 'b', filename: 'C:/images/b.png', metadata: { ...base.metadata, positivePrompt: 'moonlight, 1girl, (smile:0.9), yellow eyes, castle', negativePrompt: 'lowres, watermark' } },
        });
        const spanWithText = (text: string) => Array.from(document.querySelectorAll('span')).find((span) => span.textContent === text);

        expect(spanWithText('↑ moonlight')?.className).toContain('bg-blue-500');
        expect(spanWithText('↓ moonlight')?.className).toContain('bg-blue-500');
        expect(spanWithText('(smile:0.7)')?.className).toContain('bg-orange-500');
        expect(spanWithText('blue')?.className).toContain('bg-red-500');
        expect(spanWithText('yellow')?.className).toContain('bg-sage-500');
        expect(spanWithText('blurry')?.className).toContain('bg-red-500');
        expect(spanWithText('watermark')?.className).toContain('bg-sage-500');

        const sectionOrder = ['Positive prompt', 'Negative prompt', 'Model'].map((label) => screen.getByText(label));
        expect(sectionOrder[0].compareDocumentPosition(sectionOrder[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(sectionOrder[1].compareDocumentPosition(sectionOrder[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('compares the sampler and diffs resources with their weights', () => {
        const imageA = createImage('a', {});
        const imageB = createImage('b', {});
        imageA.metadata = { ...imageA.metadata, sampler: 'euler', loras: ['frostbite', 'moriimee'], loraWeights: { frostbite: 1, moriimee: 0.5 } };
        imageB.metadata = { ...imageB.metadata, sampler: 'dpmpp_2m', loras: ['frostbite', 'gothic'], loraWeights: { frostbite: 0.75, gothic: 1 } };
        renderModal({ imageA, imageB });

        expect(screen.getByText('Sampler')).toBeTruthy();
        expect(screen.getByText('dpmpp_2m')).toBeTruthy();
        const loras = screen.getByRole('region', { name: 'LoRAs comparison' });
        const entry = (name: string, index = 0) => within(loras).getAllByText(name)[index].closest('span') as HTMLElement;
        expect(entry('moriimee').className).toContain('bg-red-500/50');
        expect(entry('gothic').className).toContain('bg-sage-500/50');
        expect(entry('frostbite', 0).className).toContain('bg-orange-500/40');
        expect(entry('frostbite', 0).textContent).toBe('frostbite1.00');
        expect(entry('frostbite', 1).textContent).toBe('frostbite0.75');
        expect(screen.getByText('Size').compareDocumentPosition(loras) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('lists each file SHA-256 below the generation settings in neutral boxes', async () => {
        const hashA = 'a'.repeat(64);
        const hashB = 'b'.repeat(64);
        computeImageFileHashMock.mockImplementation(async (id: string) => (id === 'a' ? hashA : hashB));
        renderModal();

        const valueA = await screen.findByText(hashA);
        expect(screen.getByText(hashB)).toBeTruthy();
        expect(valueA.className).toContain('bg-zinc-900');
        expect(valueA.className).not.toContain('ember');
        expect(screen.getByText('Size').compareDocumentPosition(screen.getByText('SHA-256')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});
