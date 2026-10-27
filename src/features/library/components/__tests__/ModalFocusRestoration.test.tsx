import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { ExportModal } from '../ExportModal';

const ExportFocusHarness = () => {
    const [isOpen, setIsOpen] = React.useState(false);

    return (
        <>
            <button type="button" onClick={() => setIsOpen(true)}>Open export</button>
            <ExportModal
                isOpen={isOpen}
                onClose={() => setIsOpen(false)}
                count={1}
                onConfirm={vi.fn()}
                isExporting={false}
            />
        </>
    );
};

describe('library modal focus restoration', () => {
    it('returns focus to the export launcher after closing', () => {
        render(<ExportFocusHarness />);
        const launcher = screen.getByRole('button', { name: 'Open export' });
        launcher.focus();

        fireEvent.click(launcher);
        const closeButton = screen.getByRole('button', { name: 'Close Export' });
        expect(document.activeElement).toBe(closeButton);

        fireEvent.click(closeButton);
        expect(document.activeElement).toBe(launcher);
    });

});
