import * as React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '../../../../test/testUtils';
import { MetadataTextAreaField } from './MetadataTextAreaField';

describe('MetadataTextAreaField', () => {
    it.each([
        ['positivePrompt', 'Positive prompt'],
        ['negativePrompt', 'Negative prompt'],
    ] as const)('shows the %s as a read-only surface labelled by its heading', (kind, label) => {
        render(<MetadataTextAreaField kind={kind} value="a castle at dusk" />);

        const surface = screen.getByRole('textbox', { name: label });
        expect(surface.getAttribute('aria-readonly')).toBe('true');
        expect(surface.textContent).toBe('a castle at dusk');
        expect(screen.queryByRole('button', { name: `Edit ${label}` })).toBeNull();
        expect(document.querySelector('textarea')).toBeNull();
    });

    it('prefers formatted read content and shows a placeholder when empty', () => {
        const { rerender } = render(<MetadataTextAreaField kind="positivePrompt" value="castle" readContent={<mark>castle</mark>} />);
        expect(screen.getByText('castle').tagName).toBe('MARK');

        rerender(<MetadataTextAreaField kind="positivePrompt" value="" />);
        expect(screen.getByText('No positive prompt')).toBeTruthy();
    });

    it('renders the header action and source badge', () => {
        render(<MetadataTextAreaField kind="negativePrompt" value="lowres" source="trusted_sidecar" headerAction={<button type="button">Copy</button>} />);

        expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Source: trusted sidecar' })).toBeTruthy();
    });
});
