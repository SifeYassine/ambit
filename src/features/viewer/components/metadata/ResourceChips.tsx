import * as React from 'react';
import { MetadataChip } from './MetadataChip';
import { parseResourceEntry } from '../../utils/resourceGroups';

interface ResourceChipsProps {
    items: readonly unknown[];
    /** Weights for names that carry none, keyed by the exact item (ComfyUI LoRAs, ControlNets, IP-Adapters). */
    weights?: Partial<Record<string, number>>;
}

export const ResourceChips: React.FC<ResourceChipsProps> = ({ items, weights }) => (
    <div className="flex flex-wrap gap-2">
        {items.map((item, index) => {
            if (typeof item !== 'string') {
                return <MetadataChip key={index}><span className="truncate px-2 py-1.5 font-mono text-xs leading-5 text-gray-700 dark:text-gray-300">{String(item)}</span></MetadataChip>;
            }

            const { name, weight } = parseResourceEntry(item, weights);
            return (
                <MetadataChip key={index}>
                    {/* leading-5 gives the chip the same height as the parameter value boxes. */}
                    <span className="truncate px-2 py-1.5 font-mono text-xs leading-5 text-gray-700 dark:text-gray-300" title={name}>{name}</span>
                    {weight && <span title="Weight" className="flex items-center border-l border-gray-200 bg-gray-200 px-1.5 text-[10px] font-bold text-gray-500 dark:border-white/10 dark:bg-white/10 dark:text-zinc-400">{weight}</span>}
                </MetadataChip>
            );
        })}
    </div>
);
