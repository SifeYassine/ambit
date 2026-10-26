
import * as React from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Lightbulb, X, BarChart3, ChevronDown } from 'lucide-react';
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

const TIPS = [
    "Right-click an image to quickly add it to a collection.",
    "Use 'steps:>50' in the search bar to find high-step generations.",
    "Enable AI Features to search your library using natural language.",
    "Press 'Space' to quickly open the image viewer.",
    "Shift+Click images to select a range.",
    "Double click an image in the viewer to zoom 200%.",
    "Drag and drop images to import them."
];

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

    const [showTip, setShowTip] = useState(true);

    // Fix: Initialize tip once on mount so it doesn't change when filtering
    const [randomTip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]);

    React.useEffect(() => {
        setKeywordStatsEnabled(true);
        return () => setKeywordStatsEnabled(false);
    }, [setKeywordStatsEnabled]);

    return (
        <div className="h-full flex flex-col overflow-hidden">
            {/* Floating Pill Header - Matching AppHeader & Maintenance Style */}
            <div className="flex-shrink-0 pt-4 pl-6 pr-8 pb-4 z-20">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-2xl shadow-lg">
                    <div>
                        <div className="flex items-center gap-3 mb-1">
                            <div className="p-2 bg-sage-100 dark:bg-sage-900/30 rounded-lg text-sage-600 dark:text-sage-300">
                                <BarChart3 className="w-5 h-5" />
                            </div>
                            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Gallery Statistics</h2>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 pl-1">Analyze your generation habits, models, and prompts.</p>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar px-6 pb-8" style={{ scrollbarGutter: 'stable' }}>
                <div className="w-full space-y-6 pb-24">

                    {showTip && (
                        <div className="relative flex items-start gap-3 rounded-xl border border-harbor-200 bg-harbor-50 p-4 animate-in fade-in slide-in-from-top-2 dark:border-harbor-400/30 dark:bg-harbor-500/15">
                            <div className="rounded-lg bg-harbor-100 p-2 text-harbor-600 dark:bg-harbor-500/20 dark:text-harbor-300">
                                <Lightbulb className="w-5 h-5" />
                            </div>
                            <div className="flex-1 pr-8">
                                <h4 className="mb-1 text-sm font-bold text-harbor-600 dark:text-harbor-300">Tip of the Day</h4>
                                <p className="text-sm text-harbor-600 dark:text-harbor-300">{randomTip}</p>
                            </div>
                            <button type="button" aria-label="Dismiss Tip" onClick={() => setShowTip(false)} className="absolute right-2 top-2 p-1 text-harbor-600 hover:text-harbor-600 dark:text-harbor-300 dark:hover:text-harbor-300">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    )}

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
