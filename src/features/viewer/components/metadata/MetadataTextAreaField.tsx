import * as React from 'react';
import { FileText } from 'lucide-react';
import { MetadataSourceBadge } from './MetadataSourceBadge';
import { MetadataSectionHeader } from './MetadataSectionHeader';

type MetadataTextAreaKind = 'positivePrompt' | 'negativePrompt';

interface MetadataTextAreaFieldProps {
    kind: MetadataTextAreaKind;
    value: string;
    source?: string;
    headerAction?: React.ReactNode;
    className?: string;
    /** Formatted content (e.g. search highlights); defaults to the plain value. */
    readContent?: React.ReactNode;
}

const FIELD_PRESENTATION = {
    positivePrompt: {
        label: 'Positive prompt',
        placeholder: 'No positive prompt',
        icon: FileText,
        iconClassName: 'text-sage-500',
        heightClassName: 'min-h-32',
    },
    negativePrompt: {
        label: 'Negative prompt',
        placeholder: 'No negative prompt',
        icon: FileText,
        iconClassName: 'text-red-400',
        heightClassName: 'min-h-24',
    },
} as const;

// Fields grow with their text (from the kind's minimum height) and scroll past this cap.
const FIT_CONTENT_CLASS_NAME = 'max-h-[60vh]';

/** A read-only prompt surface: metadata is shown as parsed from the file. */
export const MetadataTextAreaField: React.FC<MetadataTextAreaFieldProps> = ({
    kind,
    value,
    source,
    headerAction,
    className = '',
    readContent,
}) => {
    const field = FIELD_PRESENTATION[kind];
    const headingId = React.useId();

    return (
        <div className={className}>
            <MetadataSectionHeader
                title={field.label}
                icon={field.icon}
                iconClassName={field.iconClassName}
                headingId={headingId}
                trailing={headerAction || source
                    ? <>{headerAction}<MetadataSourceBadge source={source} /></>
                    : undefined}
                className="mb-2"
            />
            <div
                role="textbox"
                tabIndex={0}
                aria-readonly="true"
                aria-multiline="true"
                aria-labelledby={headingId}
                className={`w-full overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-gray-200 bg-white p-3 font-sans text-sm text-gray-800 outline-none focus-visible:ring-2 focus-visible:ring-sage-500/50 dark:border-white/10 dark:bg-zinc-800/50 dark:text-zinc-200 ${FIT_CONTENT_CLASS_NAME} ${field.heightClassName}`}
            >
                {value ? (readContent ?? value) : <span className="text-gray-400">{field.placeholder}</span>}
            </div>
        </div>
    );
};
