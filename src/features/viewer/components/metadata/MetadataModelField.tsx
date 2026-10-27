import * as React from 'react';
import { Box } from 'lucide-react';
import { TooltipButton } from '../../../../components/ui/InfoTooltip';
import { formatModelName } from '../../../../utils/formatUtils';
import { MetadataField } from './MetadataField';
import type { ModelPresentation } from './modelPresentation';

interface MetadataModelFieldProps {
    presentation: ModelPresentation;
    source?: string;
}

export const MetadataModelField: React.FC<MetadataModelFieldProps> = ({ presentation, source }) => (
    <MetadataField label="Model" icon={Box} source={source}>
        <div className="flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-white p-2.5 dark:border-white/10 dark:bg-zinc-800/50">
            <div className={`truncate text-sm font-medium text-gray-900 dark:text-gray-100 ${presentation.isHashFallback ? 'font-mono' : 'font-sans'}`} title={presentation.value}>
                {presentation.isHashFallback ? presentation.value : formatModelName(presentation.value)}
            </div>
            {presentation.isHashFallback ? <TooltipButton
                label="About unresolved model hash"
                content="Model name unresolved. Use Settings → Connections → Resources → Resolve Online to look it up through CivitAI. Only the hash is sent."
                persistOnClick
                className="shrink-0 rounded border border-harbor-200 bg-harbor-50 px-1.5 py-0.5 text-[10px] text-harbor-600 hover:border-harbor-300 hover:text-harbor-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500/70 dark:border-harbor-800 dark:bg-harbor-900/30 dark:text-harbor-300 dark:hover:border-harbor-600 dark:hover:text-harbor-300"
            >
                Unresolved hash
            </TooltipButton> : null}
        </div>
    </MetadataField>
);
