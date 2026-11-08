import * as React from 'react';
import { AlertCircle } from 'lucide-react';
import type { SyncProgress } from '../../../stores/libraryStore';

export const INPUT_CLASS = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-sage-500 dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500';
export const PRIMARY_BUTTON_CLASS = 'flex items-center justify-center gap-2 rounded-lg bg-sage-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sage-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-zinc-900';
export const STOP_BUTTON_CLASS = 'flex shrink-0 items-center justify-center gap-2 rounded-lg bg-red-500 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-900';
export const SECONDARY_BUTTON_CLASS = 'flex shrink-0 items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-zinc-200 dark:hover:bg-white/10';
export const LABEL_CLASS = 'block text-sm font-medium text-gray-700 dark:text-zinc-200';

const CARD_CLASS = 'rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900';
const CARD_TITLE_CLASS = 'flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-white';

/** Lets the cards share the page height while nothing below them adds height. */
export const SimilarityFillContext = React.createContext(false);

interface SimilarityCardProps {
    icon: React.ReactNode;
    title: string;
    /** Keeps the natural height even while the page is filled (Library Index, shown on both tabs). */
    fixed?: boolean;
    children: React.ReactNode;
}

// Card padding and gaps are kept tight so the first view fits without a scrollbar. While the
// page fits, cards grow from their natural height to use the leftover space evenly.
export const SimilarityCard = ({ icon, title, fixed = false, children }: SimilarityCardProps) => {
    const fill = React.useContext(SimilarityFillContext) && !fixed;
    return (
        <section className={`${CARD_CLASS} flex flex-col ${fill ? 'flex-auto justify-center' : ''}`}>
            <h2 className={`${CARD_TITLE_CLASS} px-5 pb-1 pt-3.5`}>{icon} {title}</h2>
            <div className="px-5 pb-4 pt-2">{children}</div>
        </section>
    );
};

/** The bar and its action share a row, so the button lines up with the bar. */
export const ProgressRow = ({ progress, label, action }: { progress: SyncProgress | null; label: string; action: React.ReactNode }) => {
    const percent = progress && progress.total > 0 ? Math.min(100, (progress.current / progress.total) * 100) : 0;
    return (
        <div role="status">
            <p className="mb-1.5 text-xs text-gray-500 dark:text-zinc-400">{label}</p>
            <div className="flex items-center gap-3">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
                    <div className="h-full rounded-full bg-sage-500 transition-[width] duration-300" style={{ width: `${percent}%` }} />
                </div>
                {action}
            </div>
        </div>
    );
};

/** Inline error under a card, in the page's error style. */
export const SimilarityError = ({ message }: { message: string }) => (
    <p role="alert" className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
        <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" /> {message}
    </p>
);

export const formatMegabytes = (bytes: number): string => `${Math.round(bytes / (1024 * 1024)).toLocaleString()} MB`;

export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));
