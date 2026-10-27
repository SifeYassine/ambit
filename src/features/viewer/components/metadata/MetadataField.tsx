import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { MetadataSourceBadge } from './MetadataSourceBadge';
import { MetadataSectionHeader } from './MetadataSectionHeader';

interface MetadataFieldProps {
    label: string;
    icon: LucideIcon;
    source?: string;
    children: React.ReactNode;
    className?: string;
}

export const MetadataField: React.FC<MetadataFieldProps> = ({
    label,
    icon,
    source,
    children,
    className = '',
}) => (
    <section className={className}>
        <MetadataSectionHeader
            title={label}
            icon={icon}
            trailing={source ? <MetadataSourceBadge source={source} /> : undefined}
            className="mb-2"
        />
        {children}
    </section>
);
