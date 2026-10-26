import * as React from 'react';
import type { SettingBreakdownItem } from '../../../services/db/searchRepo';

interface SettingBarChartProps {
    items: SettingBreakdownItem[];
    isLoading?: boolean;
    emptyLabel: string;
    onSelect: (item: SettingBreakdownItem) => void;
}

const TARGET_TICKS = 4;

/**
 * Picks a tick step of 1, 2, 2.5, or 5 times a power of ten (at least 1, since counts are whole)
 * giving at most four intervals, and ends the axis on the first tick at or above the value.
 */
export const niceAxis = (value: number): { max: number; step: number } => {
    if (value <= 0) return { max: 1, step: 1 };
    const rough = value / TARGET_TICKS;
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    const step = Math.max(1, [1, 2, 2.5, 5, 10].map(multiplier => multiplier * magnitude).find(candidate => candidate >= rough) ?? 10 * magnitude);
    return { max: Math.ceil(value / step) * step, step };
};

const SKELETON_WIDTHS = ['92%', '74%', '61%', '48%', '33%'];

/**
 * Horizontal bar chart: settings on the y-axis, image counts on the x-axis. Rows have a fixed
 * height and the list is capped upstream (top 10 / top 5), so the chart never scrolls.
 */
export const SettingBarChart: React.FC<SettingBarChartProps> = ({ items, isLoading, emptyLabel, onSelect }) => {
    if (isLoading) {
        return (
            <div role="status" aria-label="Loading chart" className="space-y-3 py-2">
                {SKELETON_WIDTHS.map(width => (
                    <div key={width} className="grid grid-cols-[minmax(6rem,11rem)_1fr] items-center gap-3">
                        <div className="h-3 rounded-full bg-gray-200/80 dark:bg-white/10" />
                        <div className="h-6 animate-pulse rounded-md bg-sage-200/70 dark:bg-sage-500/20" style={{ width }} />
                    </div>
                ))}
            </div>
        );
    }

    if (items.length === 0) {
        return <div className="flex h-40 items-center justify-center text-xs uppercase tracking-wider text-gray-400">{emptyLabel}</div>;
    }

    const { max: axisMax, step } = niceAxis(Math.max(...items.map(item => item.count)));
    const ticks = Array.from({ length: Math.round(axisMax / step) + 1 }, (_, index) => step * index);
    const percent = (value: number) => `${(value / axisMax) * 100}%`;

    return (
        <div className="grid grid-cols-[minmax(6rem,11rem)_1fr] gap-x-3">
            {/* Y-axis labels */}
            <ul className="contents" aria-label="Chart rows">
                {items.map((item, index) => (
                    <li key={`${item.value}-${index}`} className="contents">
                        <span className="flex h-9 min-w-0 items-center justify-end">
                            <span className="truncate text-right text-xs font-medium text-gray-700 dark:text-zinc-200" title={item.label}>{item.label}</span>
                        </span>
                        <span className="relative flex h-9 items-center">
                            {/* Grid lines */}
                            {ticks.slice(1).map(tick => (
                                <span key={tick} aria-hidden="true" className="absolute inset-y-0 w-px bg-gray-100 dark:bg-white/5" style={{ left: percent(tick) }} />
                            ))}
                            <button
                                type="button"
                                onClick={() => onSelect(item)}
                                aria-label={`Filter by ${item.label} (${item.count.toLocaleString()} images)`}
                                title={`${item.label}: ${item.count.toLocaleString()} images`}
                                className="relative h-6 min-w-[0.5rem] rounded-r-md rounded-l-sm bg-sage-500 transition-colors hover:bg-sage-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-300 dark:bg-sage-500/80 dark:hover:bg-sage-400"
                                style={{ width: percent(item.count) }}
                            />
                            <span className="relative ml-2 text-xs font-mono text-gray-500 dark:text-zinc-400">{item.count.toLocaleString()}</span>
                        </span>
                    </li>
                ))}
            </ul>

            {/* X-axis */}
            <span aria-hidden="true" />
            <div className="relative mt-1 h-5 border-t border-gray-200 dark:border-white/10" aria-hidden="true">
                {ticks.map(tick => (
                    <span
                        key={tick}
                        className="absolute top-1 -translate-x-1/2 text-[10px] font-mono text-gray-400 dark:text-zinc-500"
                        style={{ left: percent(tick) }}
                    >
                        {tick.toLocaleString()}
                    </span>
                ))}
            </div>
            <span aria-hidden="true" />
            <p className="mt-1 text-center text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500">Number of images</p>
        </div>
    );
};
