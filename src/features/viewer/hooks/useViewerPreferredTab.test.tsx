import { act, renderHook } from '../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useViewerPreferredTab } from './useViewerPreferredTab';

const settingsState = vi.hoisted(() => ({
    settings: { viewerPreferredTab: undefined as 'metadata' | 'workflow' | undefined },
    isLoaded: true,
    setSettings: vi.fn(),
}));

vi.mock('../../../stores/settingsStore', () => ({
    useSettingsStore: (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
}));

describe('useViewerPreferredTab', () => {
    beforeEach(() => {
        settingsState.settings.viewerPreferredTab = undefined;
        settingsState.isLoaded = true;
        settingsState.setSettings.mockReset();
        settingsState.setSettings.mockImplementation((update: { viewerPreferredTab: typeof settingsState.settings.viewerPreferredTab }) => {
            settingsState.settings.viewerPreferredTab = update.viewerPreferredTab;
        });
    });

    it('defaults to Metadata without persisting the default', () => {
        const { result } = renderHook(() => useViewerPreferredTab(['metadata', 'workflow']));

        expect(result.current.activeTab).toBe('metadata');
        expect(settingsState.setSettings).not.toHaveBeenCalled();
    });

    it('uses a saved workflow preference when available and persists explicit selections', () => {
        settingsState.settings.viewerPreferredTab = 'workflow';
        const { result } = renderHook(() => useViewerPreferredTab(['metadata', 'workflow']));

        expect(result.current.activeTab).toBe('workflow');
        act(() => result.current.onExplicitTabChange('metadata'));
        expect(settingsState.setSettings).toHaveBeenCalledWith({ viewerPreferredTab: 'metadata' });
    });

    it('falls back to Metadata without overwriting an unavailable preference', () => {
        settingsState.settings.viewerPreferredTab = 'workflow';
        const { result } = renderHook(() => useViewerPreferredTab(['metadata']));

        expect(result.current.activeTab).toBe('metadata');
        expect(settingsState.setSettings).not.toHaveBeenCalled();
    });

    it('recovers the saved preference when its tab becomes available again', () => {
        settingsState.settings.viewerPreferredTab = 'workflow';
        const { result, rerender } = renderHook(
            ({ tabs }: { tabs: ('metadata' | 'workflow')[] }) => useViewerPreferredTab(tabs),
            { initialProps: { tabs: ['metadata'] } },
        );

        expect(result.current.activeTab).toBe('metadata');
        rerender({ tabs: ['metadata', 'workflow'] });
        expect(result.current.activeTab).toBe('workflow');
    });

    it('does not persist pre-hydration choices or mask the saved preference on hydration', () => {
        settingsState.isLoaded = false;
        const { result, rerender } = renderHook(() => useViewerPreferredTab(['metadata', 'workflow']));

        expect(result.current.activeTab).toBe('metadata');
        act(() => result.current.onExplicitTabChange('workflow'));
        expect(result.current.activeTab).toBe('workflow');
        expect(settingsState.setSettings).not.toHaveBeenCalled();

        settingsState.settings.viewerPreferredTab = 'metadata';
        settingsState.isLoaded = true;
        rerender();
        expect(result.current.activeTab).toBe('metadata');
    });

    it('derives global changes for every mounted viewer', () => {
        const first = renderHook(() => useViewerPreferredTab(['metadata', 'workflow']));
        const second = renderHook(() => useViewerPreferredTab(['metadata', 'workflow']));

        act(() => first.result.current.onExplicitTabChange('workflow'));
        first.rerender();
        second.rerender();
        expect(first.result.current.activeTab).toBe('workflow');
        expect(second.result.current.activeTab).toBe('workflow');

        settingsState.settings.viewerPreferredTab = 'metadata';
        first.rerender();
        second.rerender();
        expect(first.result.current.activeTab).toBe('metadata');
        expect(second.result.current.activeTab).toBe('metadata');
    });
});
