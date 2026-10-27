import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '../../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type VideoAsset } from '../../../../types';
import { VideoViewer } from '../VideoViewer';

const mocks = vi.hoisted(() => ({
    updateVideoPlaybackStatus: vi.fn().mockResolvedValue(undefined),
    openFileInDefaultApp: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
    prepareVideoPlayback: vi.fn().mockResolvedValue({ status: 'ok', data: 'C:/videos/clip.mp4' }),
    exportAssetOriginal: vi.fn(),
    open: vi.fn(),
    convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
    getImageWithFullMetadata: vi.fn(),
    addToast: vi.fn(),
    settings: { viewerPreferredTab: 'metadata' as 'metadata' | 'workflow' },
    setViewerTab: vi.fn(),
    settingsListeners: new Set<() => void>(),
}));

vi.mock('../../../../services/db/imageRepo', () => ({
    getImageWithFullMetadata: mocks.getImageWithFullMetadata,
    updateVideoPlaybackStatus: mocks.updateVideoPlaybackStatus
}));
vi.mock('../../../../services/osOpen', () => ({
    openFileInDefaultApp: mocks.openFileInDefaultApp
}));
vi.mock('../../../../hooks/useToast', () => ({
    useToast: () => ({ addToast: mocks.addToast })
}));
vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: mocks.convertFileSrc
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({
    open: mocks.open
}));
vi.mock('../../../../stores/settingsStore', () => ({
    useSettingsStore: (selector: (state: {
        settings: typeof mocks.settings;
        isLoaded: boolean;
        setSettings: typeof mocks.setViewerTab;
    }) => unknown) => {
        const state = {
            settings: mocks.settings,
            isLoaded: true,
            setSettings: mocks.setViewerTab,
        };
        return React.useSyncExternalStore(
            (listener) => {
                mocks.settingsListeners.add(listener);
                return () => mocks.settingsListeners.delete(listener);
            },
            () => selector(state),
            () => selector(state),
        );
    },
}));
vi.mock('../../../../bindings', () => ({
    commands: {
        exportAssetOriginal: mocks.exportAssetOriginal,
        prepareVideoPlayback: mocks.prepareVideoPlayback
    }
}));

const video: VideoAsset = {
    id: 'C:/videos/clip.mp4',
    url: 'asset://localhost/C:/videos/clip.mp4',
    thumbnailUrl: 'poster.webp',
    thumbnailSource: 'ambit-video-v1',
    filename: 'clip.mp4',
    timestamp: 1,
    width: 1920,
    height: 1080,
    isFavorite: false,
    isPinned: false,
    mediaType: 'video',
    mediaContainer: 'MPEG-4',
    durationMs: 2_500,
    videoCodec: 'AVC',
    audioPresent: true,
    audioCodec: 'AAC',
    rotationDegrees: 0,
    probeStatus: 'ready',
    playbackStatus: 'unknown',
    metadata: {
        tool: GeneratorTool.UNKNOWN,
        model: 'Unknown',
        steps: 0,
        cfg: 0,
        sampler: 'Unknown',
        positivePrompt: '',
        negativePrompt: '',
        generationMode: 'text_to_video',
        fieldSources: {
            generationMode: 'trusted_sidecar',
            model: 'trusted_sidecar',
            positivePrompt: 'trusted_sidecar',
            negativePrompt: 'trusted_sidecar'
        }
    }
};

const setup = (isMasked = false, videoOverrides: Partial<VideoAsset> = {}, initiallyRevealed = false) => {
    const props: React.ComponentProps<typeof VideoViewer> = {
        video: { ...video, ...videoOverrides },
        isMasked,
        initiallyRevealed,
        onClose: vi.fn(),
        onNext: vi.fn(),
        onPrev: vi.fn(),
        onToggleFavorite: vi.fn(),
        onTogglePin: vi.fn(),
        onDelete: vi.fn(),
    };
    return { ...render(<VideoViewer {...props} />), props };
};

describe('VideoViewer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getImageWithFullMetadata.mockResolvedValue(video);
        mocks.prepareVideoPlayback.mockResolvedValue({ status: 'ok', data: 'C:/videos/clip.mp4' });
        mocks.settings.viewerPreferredTab = 'metadata';
        mocks.settingsListeners.clear();
        mocks.setViewerTab.mockReset();
        mocks.setViewerTab.mockImplementation((update: { viewerPreferredTab: 'metadata' | 'workflow' }) => {
            mocks.settings.viewerPreferredTab = update.viewerPreferredTab;
            mocks.settingsListeners.forEach(listener => listener());
        });
    });

    it('opens new video viewers on Metadata without a Details tab and persists an explicit tab selection', async () => {
        const view = setup();

        expect(screen.getByRole('tab', { name: 'Metadata' }).getAttribute('aria-selected')).toBe('true');
        expect(screen.queryByRole('tab', { name: 'Details' })).toBeNull();
        expect(screen.queryByRole('heading', { name: 'Video' })).toBeNull();

        fireEvent.click(screen.getByRole('tab', { name: 'Workflow' }));
        expect(mocks.setViewerTab).toHaveBeenCalledWith({ viewerPreferredTab: 'workflow' });
        view.rerender(<VideoViewer {...view.props} video={{ ...view.props.video, id: 'C:/videos/next.mp4' }} />);
        await waitFor(() => expect(mocks.getImageWithFullMetadata).toHaveBeenCalledWith('C:/videos/next.mp4'));
        expect(screen.getByRole('tab', { name: 'Workflow' }).getAttribute('aria-selected')).toBe('true');
    });

    it('does not create or scope a player before a masked video is revealed', async () => {
        setup(true);

        const dialog = screen.getByRole('dialog', { name: 'Hidden video' });
        expect(screen.queryByText(video.filename)).toBeNull();
        expect(screen.queryByLabelText(new RegExp(video.filename))).toBeNull();
        expect(screen.queryByRole('application')).toBeNull();
        expect(document.querySelector('video')).toBeNull();
        expect(mocks.prepareVideoPlayback).not.toHaveBeenCalled();
        expect(mocks.convertFileSrc).not.toHaveBeenCalled();
        expect(mocks.getImageWithFullMetadata).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Reveal video' }));
        expect(document.querySelector('video')).toBeNull();
        await waitFor(() => expect(document.querySelector('video')?.getAttribute('src')).toContain('clip.mp4'));
        expect(screen.getByRole('dialog', { name: `Video viewer: ${video.filename}` })).toBe(dialog);
        expect(screen.getByText(video.filename)).toBeTruthy();
        expect(mocks.prepareVideoPlayback).toHaveBeenCalledWith(video.id);
        expect(mocks.convertFileSrc).toHaveBeenCalledWith('C:/videos/clip.mp4');
        expect(mocks.getImageWithFullMetadata).toHaveBeenCalledWith(video.id);
    });

    it('keeps a locally revealed masked video visible across metadata updates', async () => {
        const view = setup(true);
        fireEvent.click(screen.getByRole('button', { name: 'Reveal video' }));
        await waitFor(() => expect(document.querySelector('video')).not.toBeNull());

        view.rerender(<VideoViewer
            {...view.props}
            video={{
                ...view.props.video,
                metadata: { ...view.props.video.metadata, generationMode: 'guided_video' },
            }}
        />);

        expect(screen.queryByRole('button', { name: 'Reveal video' })).toBeNull();
        expect(document.querySelector('video')).not.toBeNull();
    });

    it('loads full video evidence on demand for lightweight gallery rows', async () => {
        const lightVideo: VideoAsset = {
            ...video,
            metadata: {
                ...video.metadata,
                generationMode: undefined,
                fieldSources: undefined,
                loras: [],
            },
        };
        mocks.getImageWithFullMetadata.mockResolvedValueOnce({
            ...video,
            metadata: { ...video.metadata, loras: ['full-evidence-lora'] },
        });
        setup(false, lightVideo);

        fireEvent.click(screen.getByRole('tab', { name: 'Metadata' }));

        await waitFor(() => expect(screen.getByLabelText('Generation mode').textContent).toBe('Text to video'));
        expect(screen.getAllByRole('button', { name: 'Source: trusted sidecar' }).length).toBeGreaterThan(0);
        expect(screen.getByText('full-evidence-lora')).toBeTruthy();
    });

    it('hides empty resource sections instead of rendering empty-state cards', () => {
        setup();
        fireEvent.click(screen.getByRole('tab', { name: 'Metadata' }));

        expect(screen.queryByText('LoRAs')).toBeNull();
        expect(screen.queryByText('ControlNets')).toBeNull();
        expect(screen.queryByText('IP adapters')).toBeNull();
        expect(screen.queryByText('Resources')).toBeNull();
        expect(screen.queryByText('None detected')).toBeNull();
    });

    it('keeps disclosure choices while navigating within one viewer session', () => {
        const view = setup();
        fireEvent.click(screen.getByRole('tab', { name: 'Metadata' }));
        const disclosure = screen.getByRole('button', { name: 'Generation parameters' });
        fireEvent.click(disclosure);
        expect(disclosure.getAttribute('aria-expanded')).toBe('false');

        view.rerender(<VideoViewer
            {...view.props}
            video={{ ...view.props.video, id: 'C:/videos/next.mp4', filename: 'next.mp4' }}
        />);

        expect(screen.getByRole('button', { name: 'Generation parameters' }).getAttribute('aria-expanded')).toBe('false');
    });

    it('does not reuse workflow inspector state while navigating between videos', () => {
        const firstWorkflow = JSON.stringify({ nodes: [{ id: 'first', type: 'FirstVideoNode', inputs: {} }] });
        const secondWorkflow = JSON.stringify({ nodes: [{ id: 'second', type: 'SecondVideoNode', inputs: {} }] });
        const view = setup(false, { metadata: { ...video.metadata, workflowJson: firstWorkflow } });
        fireEvent.click(screen.getByRole('tab', { name: 'Workflow' }));
        expect(screen.getAllByText('FirstVideoNode')).toHaveLength(2);

        view.rerender(<VideoViewer
            {...view.props}
            video={{
                ...view.props.video,
                id: 'C:/videos/next.mp4',
                metadata: { ...view.props.video.metadata, workflowJson: secondWorkflow },
            }}
        />);

        expect(screen.queryAllByText('FirstVideoNode')).toHaveLength(0);
        expect(screen.getAllByText('SecondVideoNode')).toHaveLength(2);
    });

    it('does not reuse playback or editable drafts while navigating to another video', async () => {
        const view = setup(false, {
            notes: 'first notes',
            metadata: { ...video.metadata, positivePrompt: 'first prompt' },
        });
        await waitFor(() => expect(document.querySelector('video')?.getAttribute('src')).toContain('clip.mp4'));

        let resolveNextPlayback: ((value: { status: 'ok'; data: string }) => void) | undefined;
        mocks.prepareVideoPlayback.mockImplementationOnce(() => new Promise(resolve => {
            resolveNextPlayback = resolve;
        }));
        const nextVideo: VideoAsset = {
            ...view.props.video,
            id: 'C:/videos/next.mp4',
            filename: 'next.mp4',
            notes: 'next notes',
            metadata: { ...view.props.video.metadata, positivePrompt: 'next prompt' },
        };
        view.rerender(<VideoViewer {...view.props} video={nextVideo} />);

        expect(document.querySelector('video')).toBeNull();
        expect(screen.getByText(/Preparing secure playback/)).toBeTruthy();
        fireEvent.click(screen.getByRole('tab', { name: 'Metadata' }));
        expect(screen.getByRole('textbox', { name: 'Positive prompt' }).textContent).toBe('next prompt');

        resolveNextPlayback?.({ status: 'ok', data: 'C:/videos/next.mp4' });
        await waitFor(() => expect(document.querySelector('video')?.getAttribute('src')).toContain('next.mp4'));
    });

    it.each([
        ['loras', 'motion-detail.safetensors (0.75)', 'motion-detail'],
        ['controlNets', 'canny-video.safetensors', 'canny-video'],
        ['ipAdapters', 'reference-face.pt', 'reference-face'],
    ] as const)('shows populated %s chips as static labels', (field, value, chipName) => {
        setup(false, {
            metadata: {
                ...video.metadata,
                [field]: [value],
            },
        });
        fireEvent.click(screen.getByRole('tab', { name: 'Metadata' }));
        expect(screen.getByText(chipName)).toBeTruthy();
        expect(screen.queryByRole('button', { name: new RegExp(chipName) })).toBeNull();
    });

    it('uses a card reveal grant without showing a second viewer gate', async () => {
        setup(true, {}, true);

        expect(screen.queryByRole('button', { name: 'Reveal video' })).toBeNull();
        await waitFor(() => expect(document.querySelector('video')?.getAttribute('src')).toContain('clip.mp4'));
        expect(mocks.prepareVideoPlayback).toHaveBeenCalledOnce();
    });

    it('records decode success and renders an external fallback after a playback error', async () => {
        setup();
        const player = await waitFor(() => {
            const element = document.querySelector('video') as HTMLVideoElement | null;
            expect(element).not.toBeNull();
            return element as HTMLVideoElement;
        });

        fireEvent.canPlay(player);
        expect(mocks.updateVideoPlaybackStatus).toHaveBeenCalledWith(video.id, 'playable');

        fireEvent.error(player);
        expect(await screen.findByText('Playback unavailable here')).toBeTruthy();
        expect(mocks.updateVideoPlaybackStatus).toHaveBeenCalledWith(video.id, 'external_required');
    });

    it('uses the shared subdued toolbar controls and text-only viewer tabs', () => {
        setup(false, { isFavorite: true, isPinned: true });

        const favorite = screen.getByRole('button', { name: 'Remove from Favorites' });
        expect(favorite.getAttribute('aria-pressed')).toBe('true');
        expect(favorite.className).toContain('text-white/50');

        const pin = screen.getByRole('button', { name: 'Unpin' });
        expect(pin.getAttribute('aria-pressed')).toBe('true');
        expect(pin.className).toContain('text-sage-400');

        const open = screen.getByRole('button', { name: 'Open in Default App' });
        fireEvent.focus(open);
        expect(screen.getByRole('tooltip').textContent).toBe('Open in Default App');

        expect(screen.getByRole('tablist', { name: 'Video viewer sections' })).toBeTruthy();
        expect(screen.getByRole('tab', { name: 'Workflow' }).querySelector('svg')).toBeNull();
    });

    it('explains a missing source without preparing playback or offering file actions', () => {
        setup(false, { isMissing: true, playbackStatus: 'playable' });

        expect(screen.getByText('Source file missing')).toBeTruthy();
        expect(screen.getByText(/Restore the file at its original location/)).toBeTruthy();
        expect(mocks.prepareVideoPlayback).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: 'Open in Default App' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Export Original' })).toBeNull();
        expect(screen.queryByText('Open externally')).toBeNull();
    });

    it('exports the original and hides the Windows verbatim prefix in the toast', async () => {
        mocks.open.mockResolvedValueOnce('C:/exports');
        mocks.exportAssetOriginal.mockResolvedValueOnce({
            status: 'ok',
            data: {
                assetId: video.id,
                outputPath: '//?/C:/exports/clip.mp4',
                bytesCopied: 2_500
            }
        });
        setup();

        fireEvent.click(screen.getByRole('button', { name: 'Export Original' }));

        await waitFor(() => expect(mocks.exportAssetOriginal).toHaveBeenCalledWith(video.id, 'C:/exports'));
        expect(mocks.addToast).toHaveBeenCalledWith('Exported C:/exports/clip.mp4', 'success');
    });

    it('seeks with visible controls and clamps at video boundaries', async () => {
        setup();
        const player = await waitFor(() => {
            const element = document.querySelector('video') as HTMLVideoElement | null;
            expect(element).not.toBeNull();
            return element as HTMLVideoElement;
        });
        Object.defineProperty(player, 'duration', { configurable: true, value: 30 });
        player.currentTime = 5;

        fireEvent.click(screen.getByRole('button', { name: 'Back 10 seconds' }));
        expect(player.currentTime).toBe(0);

        player.currentTime = 25;
        fireEvent.click(screen.getByRole('button', { name: 'Forward 10 seconds' }));
        expect(player.currentTime).toBe(30);
    });

    it('uses J and L for seeking while preserving arrow gallery navigation', async () => {
        const { props } = setup();
        const player = await waitFor(() => {
            const element = document.querySelector('video') as HTMLVideoElement | null;
            expect(element).not.toBeNull();
            return element as HTMLVideoElement;
        });
        Object.defineProperty(player, 'duration', { configurable: true, value: 60 });
        player.currentTime = 30;

        fireEvent.keyDown(window, { key: 'j' });
        expect(player.currentTime).toBe(20);
        fireEvent.keyDown(window, { key: 'L' });
        expect(player.currentTime).toBe(30);

        fireEvent.keyDown(window, { key: 'ArrowLeft' });
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(props.onPrev).toHaveBeenCalledOnce();
        expect(props.onNext).toHaveBeenCalledOnce();
    });

    it('uses Space for playback and keeps close on Escape', async () => {
        const { props } = setup();
        const player = await waitFor(() => {
            const element = document.querySelector('video') as HTMLVideoElement | null;
            expect(element).not.toBeNull();
            return element as HTMLVideoElement;
        });
        const play = vi.spyOn(player, 'play').mockResolvedValue(undefined);
        const pause = vi.spyOn(player, 'pause').mockImplementation(() => undefined);

        Object.defineProperty(player, 'paused', { configurable: true, value: true });
        const playEvent = new KeyboardEvent('keydown', { key: ' ', cancelable: true });
        window.dispatchEvent(playEvent);
        expect(playEvent.defaultPrevented).toBe(true);
        expect(play).toHaveBeenCalledOnce();

        Object.defineProperty(player, 'paused', { configurable: true, value: false });
        window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', cancelable: true }));
        expect(pause).toHaveBeenCalledOnce();

        const closeButton = screen.getByRole('button', { name: 'Close Viewer (Esc)' });
        closeButton.focus();
        fireEvent.keyDown(closeButton, { key: ' ' });
        expect(play).toHaveBeenCalledOnce();
        expect(pause).toHaveBeenCalledOnce();

        fireEvent.keyDown(closeButton, { key: 'Escape' });
        expect(props.onClose).toHaveBeenCalledOnce();
    });

    it('closes from bare playback background but not from the player', async () => {
        const { props } = setup();
        const player = await waitFor(() => {
            const element = document.querySelector('video') as HTMLVideoElement | null;
            expect(element).not.toBeNull();
            return element as HTMLVideoElement;
        });

        fireEvent.click(player);
        expect(props.onClose).not.toHaveBeenCalled();

        fireEvent.click(player.parentElement as HTMLElement);
        expect(props.onClose).toHaveBeenCalledOnce();
    });

    it('does not seek from editable controls or without finite media duration', async () => {
        setup();
        const player = await waitFor(() => {
            const element = document.querySelector('video') as HTMLVideoElement | null;
            expect(element).not.toBeNull();
            return element as HTMLVideoElement;
        });
        Object.defineProperty(player, 'duration', { configurable: true, value: Number.NaN });
        player.currentTime = 4;
        fireEvent.keyDown(window, { key: 'l' });
        expect(player.currentTime).toBe(4);

        Object.defineProperty(player, 'duration', { configurable: true, value: 60 });
        const speed = screen.getByRole('combobox', { name: 'Playback speed' });
        fireEvent.keyDown(speed, { key: 'j' });
        expect(player.currentTime).toBe(4);
    });

    it('uses source-neutral wording when no trusted workflow is available', () => {
        setup();
        fireEvent.click(screen.getByRole('tab', { name: 'Workflow' }));

        expect(screen.getByText('No trusted workflow evidence was found for this video.')).toBeTruthy();
        expect(screen.queryByText(/ComfyUI workflow evidence/)).toBeNull();
    });
});
