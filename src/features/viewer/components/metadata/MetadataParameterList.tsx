import * as React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { MetadataSourceBadge } from './MetadataSourceBadge';
import { MetadataDisclosureSection } from './MetadataDisclosureSection';

export interface MetadataParameterRow {
    label: string;
    value: string;
    source?: string;
    modified?: boolean;
    optional?: boolean;
}

interface MetadataParameterListProps {
    rows: readonly MetadataParameterRow[];
    ariaLabel?: string;
    headerAction?: React.ReactNode;
    expanded?: boolean;
    onExpandedChange?: (expanded: boolean) => void;
}

export const MetadataParameterList: React.FC<MetadataParameterListProps> = ({
    rows,
    ariaLabel = 'Generation parameters',
    headerAction,
    expanded,
    onExpandedChange,
}) => {
    const visibleRows = rows.filter(row => !row.optional || (row.value && row.value !== 'Unknown'));
    if (visibleRows.length === 0) return null;

    // One box per parameter, on the same surface as the prompt fields.
    const parameterList = <dl aria-label={ariaLabel} className="grid grid-cols-2 gap-2 text-xs">
            {visibleRows.map(row => (
                // Label, value, and badge share one box element so each row stays a single dt/dd group.
                <div
                    key={row.label}
                    className={`relative min-w-0 rounded-lg border px-2.5 py-2 ${row.modified
                        ? 'border-ember-300 bg-ember-50/70 dark:border-ember-500/30 dark:bg-ember-500/10'
                        : 'border-gray-200 bg-white dark:border-white/10 dark:bg-zinc-800/50'}`}
                >
                    <dt className={`mb-1 pr-8 text-[10px] font-bold uppercase tracking-wider ${row.modified ? 'text-ember-600 dark:text-ember-300' : 'text-gray-400 dark:text-zinc-500'}`}>{row.label}</dt>
                    <dd className="break-words text-sm text-gray-700 dark:text-zinc-200">{row.value || 'Unknown'}</dd>
                    <dd className="absolute right-2 top-1.5">
                        <MetadataSourceBadge source={row.modified ? 'user_override' : row.source} />
                    </dd>
                </div>
            ))}
        </dl>;

    return (
        <MetadataDisclosureSection
            title={ariaLabel}
            icon={SlidersHorizontal}
            trailing={headerAction}
            expanded={expanded}
            onExpandedChange={onExpandedChange}
        >
            {parameterList}
        </MetadataDisclosureSection>
    );
};
