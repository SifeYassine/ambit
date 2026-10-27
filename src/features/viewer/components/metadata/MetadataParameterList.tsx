import * as React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { MetadataSourceBadge } from './MetadataSourceBadge';
import { MetadataDisclosureSection } from './MetadataDisclosureSection';

export interface MetadataParameterRow {
    label: string;
    value: string;
    source?: string;
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

    // Key above, value in its own box, like the comparer and the prompt fields.
    const parameterList = <dl aria-label={ariaLabel} className="grid grid-cols-2 gap-x-2 gap-y-3 text-xs">
            {visibleRows.map(row => (
                // Label, badge, and value share one wrapper so each row stays a single dt/dd group.
                <div key={row.label} className="min-w-0">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                        <dt className="truncate text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500">{row.label}</dt>
                        <dd className="shrink-0">
                            <MetadataSourceBadge source={row.source} />
                        </dd>
                    </div>
                    <dd className="break-words rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 dark:border-white/10 dark:bg-zinc-800/50 dark:text-zinc-200">
                        {row.value || 'Unknown'}
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
