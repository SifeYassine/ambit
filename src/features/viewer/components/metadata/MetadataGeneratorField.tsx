import * as React from 'react';
import { AppWindow } from 'lucide-react';
import { GeneratorTool } from '../../../../types';
import { MetadataField } from './MetadataField';

interface MetadataGeneratorFieldProps {
    value: GeneratorTool;
    source?: string;
}

export const MetadataGeneratorField: React.FC<MetadataGeneratorFieldProps> = ({ value, source }) => (
    <MetadataField label="Generator software" icon={AppWindow} source={source}>
        <div className="w-full rounded-lg border border-gray-200 bg-white p-2.5 text-sm font-medium text-gray-700 dark:border-white/10 dark:bg-zinc-800/50 dark:text-zinc-200">{value}</div>
    </MetadataField>
);
