
import * as React from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { AIImage } from '../../types';
// Note: useLibraryStats hook is deprecated for large library performance. Using DB stats.
import { useLibraryContext } from '../../hooks/useLibraryContext';
import { useLibraryStore } from '../../stores/libraryStore';
import { getSettingBreakdown, type SettingBreakdownDimension, type SettingBreakdownItem } from '../../services/db/searchRepo';
import { isBrowserMockMode } from '../../services/runtime';
import { WordCloud } from './stats/WordCloud';
import { SettingBarChart } from './stats/SettingBarChart';

export type StatsFilterType = 'keyword' | SettingBreakdownDimension;

interface ChartsProps {
    images: AIImage[];
    onFilter: (type: StatsFilterType, value: string | number) => void;
}

const DIMENSIONS: { value: SettingBreakdownDimension; label: string; title: string }[] = [
    { value: 'model', label: 'Models', title: 'Top 10 Models' },
    { value: 'lora', label: 'LoRAs', title: 'Top 10 LoRAs' },
    { value: 'sampler', label: 'Samplers', title: 'Top 10 Samplers' },
    { value: 'steps', label: 'Steps', title: 'Top 10 Step Counts' },
    { value: 'cfg', label: 'CFG', title: 'Top 10 CFG Values' },
    { value: 'size', label: 'Sizes', title: 'Top 10 Image Sizes' },
];

type PromptKind = 'positive' | 'negative';

export const buildTagSearchTerm = (tag: string, kind: PromptKind): string => {
    const value = kind === 'negative' ? `neg:${tag}` : tag;
    return /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
};

// The native arrow ignores padding and sits on the border, so it is hidden and drawn inset instead.
const SELECT_CLASS = 'appearance-none cursor-pointer rounded-lg border border-gray-200 bg-white py-1.5 pl-3 pr-8 text-xs font-medium text-gray-700 outline-none focus:border-sage-500 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-200';

const StatsSelect: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = ({ children, ...props }) => (
    <div className="relative">
        <select {...props} className={SELECT_CLASS}>{children}</select>
        <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
    </div>
);
const CARD_CLASS = 'rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-900';
const CARD_TITLE_CLASS = 'text-sm font-bold uppercase tracking-wider text-gray-400';

const ClickToFilter = () => <span className="normal-case tracking-normal font-medium">(click to filter)</span>;

export const StatsDashboard: React.FC<ChartsProps> = ({ images, onFilter }) => {
    const setKeywordStatsEnabled = useLibraryStore(state => state.setKeywordStatsEnabled);
    // Use DB-backed global stats
    const {
        stats,
        isFiltering,
        isStatsSummaryLoading,
        isKeywordStatsLoading,
        statsScope
    } = useLibraryContext();
    const { keywordStats, negativeKeywordStats } = stats;
    const [dimension, setDimension] = useState<SettingBreakdownDimension>('model');
    const [promptKind, setPromptKind] = useState<PromptKind>('positive');
    const promptKeywords = promptKind === 'positive' ? keywordStats : (negativeKeywordStats ?? []);
    const shouldShowWordCloudLoading = isStatsSummaryLoading || (isKeywordStatsLoading && promptKeywords.length === 0);
    const dimensionConfig = DIMENSIONS.find(item => item.value === dimension) ?? DIMENSIONS[0];

    const breakdownQuery = useQuery({
        queryKey: ['statsBreakdown', dimension, statsScope?.cacheKey ?? null],
        queryFn: (): Promise<SettingBreakdownItem[]> => statsScope && !isBrowserMockMode()
            ? getSettingBreakdown(dimension, statsScope.where, statsScope.params, statsScope.collectionId, statsScope.loraName)
            : Promise.resolve([]),
        enabled: Boolean(statsScope) || isBrowserMockMode(),
        staleTime: 1000 * 60 * 5,
    });

    React.useEffect(() => {
        setKeywordStatsEnabled(true);
        return () => setKeywordStatsEnabled(false);
    }, [setKeywordStatsEnabled]);

    return (
        <div className="h-full flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto custom-scrollbar px-6 pb-8 pt-4" style={{ scrollbarGutter: 'stable' }}>
                <div className="w-full space-y-6 pb-24">

                    {/* Setting chart */}
                    <section className={CARD_CLASS} aria-labelledby="stats-chart-title">
                        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                            <h3 id="stats-chart-title" className={CARD_TITLE_CLASS}>{dimensionConfig.title} <ClickToFilter /></h3>
                            <StatsSelect
                                aria-label="Chart setting"
                                value={dimension}
                                onChange={event => setDimension(event.target.value as SettingBreakdownDimension)}
                            >
                                {DIMENSIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                            </StatsSelect>
                        </div>
                        <SettingBarChart
                            items={breakdownQuery.data ?? []}
                            isLoading={breakdownQuery.isPending && (Boolean(statsScope) || isBrowserMockMode())}
                            emptyLabel={`No ${dimensionConfig.label.toLowerCase()} recorded`}
                            onSelect={item => onFilter(dimension, item.value)}
                        />
                    </section>

                    {/* Prompt word cloud */}
                    <section className={CARD_CLASS} aria-labelledby="stats-cloud-title">
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                            <h3 id="stats-cloud-title" className={`${CARD_TITLE_CLASS} flex items-center gap-2`}>
                                <span>Top {promptKind === 'positive' ? 'Prompt' : 'Negative Prompt'} Tags <ClickToFilter /></span>
                                {isFiltering && <span className="h-4 w-4 animate-spin rounded-full border-2 border-sage-500/20 border-t-sage-500" />}
                            </h3>
                            <StatsSelect
                                aria-label="Prompt type"
                                value={promptKind}
                                onChange={event => setPromptKind(event.target.value as PromptKind)}
                            >
                                <option value="positive">Positive prompts</option>
                                <option value="negative">Negative prompts</option>
                            </StatsSelect>
                        </div>
                        <WordCloud
                            keywords={promptKeywords}
                            isLoading={shouldShowWordCloudLoading}
                            onWordClick={(word) => onFilter('keyword', buildTagSearchTerm(word, promptKind))}
                        />
                    </section>
                </div>
            </div>
        </div>
    );
};
