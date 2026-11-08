import * as React from 'react';
import { Layers, Search, X } from 'lucide-react';
import type { AIImage, FilterState } from '../../../types';
import { useSimilarityStore, type SimilarityTab } from '../../../stores/similarityStore';
import { useSimilarityClusters, useSimilarityScope, useSimilaritySearchResults } from '../hooks/useSimilarity';
import { ClusteringCard, ClusterResults } from './ClusteringPanel';
import { LibraryIndexCard } from './LibraryIndexCard';
import { ResultGrid, ResultHeader, type ResultItem } from './ResultGrid';
import { SearchPanel } from './SearchPanel';
import { errorMessage, SECONDARY_BUTTON_CLASS, SimilarityFillContext } from './SimilarityCard';

interface SimilarityViewProps {
    filters: FilterState;
    onOpenResult: (images: AIImage[], index: number) => void;
}

const TABS: { id: SimilarityTab; label: string; icon: React.ReactNode }[] = [
    { id: 'search', label: 'Search', icon: <Search className="h-4 w-4" aria-hidden="true" /> },
    { id: 'cluster', label: 'Clustering', icon: <Layers className="h-4 w-4" aria-hidden="true" /> },
];

/** SmartSim's Search / Clustering tabs. */
const TabSwitch = () => {
    const tab = useSimilarityStore(state => state.tab);
    const setTab = useSimilarityStore(state => state.setTab);
    return (
        <div role="tablist" aria-label="Similarity tools" className="flex shrink-0 gap-1 self-center rounded-xl border border-gray-200 bg-white p-1 shadow-sm dark:border-white/10 dark:bg-zinc-900">
            {TABS.map(item => (
                <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === item.id}
                    onClick={() => setTab(item.id)}
                    className={`flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500 ${tab === item.id
                        ? 'bg-sage-500 text-white'
                        : 'text-gray-600 hover:bg-gray-100 dark:text-zinc-300 dark:hover:bg-white/10'}`}
                >
                    {item.icon} {item.label}
                </button>
            ))}
        </div>
    );
};

export const SimilarityView: React.FC<SimilarityViewProps> = ({ filters, onOpenResult }) => {
    const scrollContainerRef = React.useRef<HTMLDivElement>(null);
    const scope = useSimilarityScope(filters);
    const tab = useSimilarityStore(state => state.tab);
    const imageQuery = useSimilarityStore(state => state.imageQuery);
    const pendingImageSearch = useSimilarityStore(state => state.pendingImageSearch);
    const submittedSearch = useSimilarityStore(state => state.submittedSearch);
    const clearSearch = useSimilarityStore(state => state.clearSearch);
    const searchQuery = useSimilaritySearchResults(scope);
    const clustersQuery = useSimilarityClusters();

    // "Find similar" in the viewer lands here with the query image set.
    React.useEffect(() => {
        if (pendingImageSearch) useSimilarityStore.getState().submitImageSearch();
    }, [pendingImageSearch]);

    const searchError = searchQuery.error ? errorMessage(searchQuery.error) : null;
    const clusterError = clustersQuery.error ? errorMessage(clustersQuery.error) : null;
    // Only the search tab stretches its cards to the page height; the clustering card keeps its
    // natural height.
    const fillPage = tab === 'search' && !submittedSearch && !imageQuery;
    const resultItems = React.useMemo<ResultItem[]>(
        () => (searchQuery.data ?? []).map(item => ({ id: item.image.id, image: item.image, similarity: item.similarity })),
        [searchQuery.data]
    );

    return (
        <div ref={scrollContainerRef} className="custom-scrollbar h-full overflow-y-auto overflow-x-hidden">
            <SimilarityFillContext.Provider value={fillPage}>
                <div className={`mx-auto flex max-w-4xl flex-col gap-3 px-6 pb-4 pt-4 ${fillPage ? 'min-h-full' : ''}`}>
                    <TabSwitch />
                    <LibraryIndexCard />
                    {tab === 'cluster'
                        ? <ClusteringCard isClustering={clustersQuery.isFetching} error={clusterError} />
                        : <SearchPanel isSearching={searchQuery.isFetching} error={searchError} />}
                </div>
            </SimilarityFillContext.Provider>

            {tab === 'cluster' && clustersQuery.data && (
                <ClusterResults
                    clusters={clustersQuery.data}
                    scope={scope}
                    scrollContainerRef={scrollContainerRef}
                    onOpenResult={onOpenResult}
                />
            )}

            {tab === 'search' && submittedSearch && searchQuery.data && (
                <div className="px-3 pb-8 pt-4">
                    <ResultHeader
                        center={(
                            <h2 className="text-center text-2xl font-bold text-gray-900 dark:text-white">
                                Search Results ({resultItems.length} found)
                            </h2>
                        )}
                        subtitle={submittedSearch.label}
                        action={(
                            <button type="button" onClick={clearSearch} className={SECONDARY_BUTTON_CLASS}>
                                <X className="h-4 w-4" aria-hidden="true" /> Clear results
                            </button>
                        )}
                    />
                    <ResultGrid items={resultItems} scrollContainerRef={scrollContainerRef} onOpenResult={onOpenResult} />
                </div>
            )}
        </div>
    );
};
