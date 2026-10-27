import * as React from 'react';

interface MetadataChipProps {
    children: React.ReactNode;
    className?: string;
}

// Stretch, not center: segments with different font sizes (name, weight) fill the full chip height.
const CHIP_CLASS_NAME = 'flex max-w-full items-stretch overflow-hidden rounded-lg border border-gray-200 bg-gray-100 dark:border-white/10 dark:bg-white/5';

export const MetadataChip: React.FC<MetadataChipProps> = ({ children, className = '' }) => (
    <span className={`${CHIP_CLASS_NAME} ${className}`}>{children}</span>
);
