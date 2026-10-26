import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../test/testUtils';
import { niceAxis, SettingBarChart } from './SettingBarChart';

describe('niceAxis', () => {
    it('ends the axis on a round tick at or above the largest count', () => {
        expect(niceAxis(273)).toEqual({ max: 300, step: 100 });
        expect(niceAxis(367)).toEqual({ max: 400, step: 100 });
        expect(niceAxis(91)).toEqual({ max: 100, step: 25 });
        expect(niceAxis(1150)).toEqual({ max: 1500, step: 500 });
        expect(niceAxis(3)).toEqual({ max: 3, step: 1 });
        expect(niceAxis(0)).toEqual({ max: 1, step: 1 });
    });
});

describe('SettingBarChart', () => {
    const items = [
        { label: 'sdxl_vae', value: 'sdxl_vae', count: 91 },
        { label: 'ae', value: 'ae', count: 1 },
    ];

    it('draws one bar per setting, scaled against the rounded axis, with tick labels', () => {
        const onSelect = vi.fn();
        render(<SettingBarChart items={items} emptyLabel="None" onSelect={onSelect} />);

        const bar = screen.getByRole('button', { name: 'Filter by sdxl_vae (91 images)' });
        expect(bar.style.width).toBe('91%');
        expect(screen.getByText('100')).toBeTruthy();
        expect(screen.getByText('Number of images')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Filter by ae (1 images)' }));
        expect(onSelect).toHaveBeenCalledWith(items[1]);
    });

    it('shows loading and empty states', () => {
        const { rerender } = render(<SettingBarChart items={[]} isLoading emptyLabel="None recorded" onSelect={vi.fn()} />);
        expect(screen.getByRole('status', { name: 'Loading chart' })).toBeTruthy();

        rerender(<SettingBarChart items={[]} emptyLabel="None recorded" onSelect={vi.fn()} />);
        expect(screen.getByText('None recorded')).toBeTruthy();
    });
});
