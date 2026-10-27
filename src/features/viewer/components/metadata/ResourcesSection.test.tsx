import * as React from 'react';
import { Code, Puzzle, Target } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { ResourcesSection, type MetadataResourceGroup } from './ResourcesSection';

const renderSection = (groups: readonly MetadataResourceGroup[]) => render(<ResourcesSection groups={groups} />);

describe('ResourcesSection', () => {
    it('renders nothing when every resource group is empty', () => {
        const { container } = renderSection([
            { title: 'LoRAs', icon: Puzzle, items: [] },
            { title: 'ControlNets', icon: Target, items: undefined },
        ]);

        expect(container.firstChild).toBeNull();
    });

    it('groups only populated resources under one disclosure with aggregate and subgroup counts', () => {
        renderSection([
            { title: 'LoRAs', icon: Puzzle, items: ['one', 'two'] },
            { title: 'Embeddings', icon: Code, items: [] },
            { title: 'ControlNets', icon: Target, items: ['pose'], source: 'trusted_sidecar' },
        ]);

        const disclosure = screen.getByRole('button', { name: 'Resources' });
        expect(disclosure.closest('section')?.textContent).toContain('3');
        expect(screen.getByRole('heading', { name: 'LoRAs' }).textContent).toContain('2');
        expect(screen.queryByRole('heading', { name: 'Embeddings' })).toBeNull();
        expect(screen.getByRole('heading', { name: 'ControlNets' }).textContent).toContain('1');
        expect(screen.getByRole('button', { name: 'Source: trusted sidecar' })).toBeTruthy();

        fireEvent.click(disclosure);
        expect(disclosure.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByText('one')).toBeNull();
    });

    it('lines resource subgroups up with the other sections instead of indenting them', () => {
        renderSection([{ title: 'LoRAs', icon: Puzzle, items: ['portrait'] }]);

        const subgroup = screen.getByRole('heading', { name: 'LoRAs' }).closest('section');
        expect(subgroup?.parentElement?.className).not.toContain('pl-6');
    });

    it('shows resources as static chips with their weights', () => {
        renderSection([
            { title: 'LoRAs', icon: Puzzle, items: ['Portrait.safetensors (0.75)', 'frostbite'], weights: { frostbite: 1.0000000000000002 } },
            { title: 'ControlNets', icon: Target, items: ['pose.safetensors'] },
        ]);

        expect(screen.queryAllByRole('button').map(button => button.getAttribute('aria-expanded'))).toEqual(['true']);
        const weightOf = (name: string) => screen.getByText(name).parentElement?.querySelector('[title="Weight"]')?.textContent ?? null;
        expect(weightOf('Portrait')).toBe('0.75');
        expect(weightOf('frostbite')).toBe('1.00');
        expect(weightOf('pose')).toBeNull();
        // The weight segment stretches to the chip's full height.
        expect(screen.getByText('Portrait').parentElement?.className).toContain('items-stretch');
    });

    it('keeps unweighted dotted names and renders non-string evidence', () => {
        renderSection([{
            title: 'Other',
            icon: Code,
            items: ['adapter.SAFETENSORS', 'name.with.dots', 42],
        }]);

        expect(screen.getByText('adapter')).toBeTruthy();
        expect(screen.getByText('name.with.dots')).toBeTruthy();
        expect(screen.getByText('42')).toBeTruthy();
    });
});
