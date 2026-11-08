import * as React from 'react';
import { ChevronLeft, ChevronRight, Layers, Loader2, X } from 'lucide-react';
import type { SearchScope } from '../../../services/similarityService';
import { useSimilarityStore, type ClusterInputs } from '../../../stores/similarityStore';
import { useClusterImages, useSimilarityStatus } from '../hooks/useSimilarity';
import { ResultGrid, ResultHeader, type ResultGridProps, type ResultItem } from './ResultGrid';
import { INPUT_CLASS, LABEL_CLASS, PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS, SimilarityCard, SimilarityError } from './SimilarityCard';

const CLUSTER_FIELDS: { field: keyof ClusterInputs; label: string; placeholder: string; step?: number; max?: number }[] = [
    { field: 'maxClusters', label: 'Max Number of Clusters', placeholder: 'e.g., 10' },
    { field: 'threshold', label: 'Similarity Threshold', placeholder: 'e.g., 0.7', step: 0.01, max: 1 },
    { field: 'minImages', label: 'Min Images per Cluster', placeholder: 'e.g., 2' },
    { field: 'maxImages', label: 'Max Images per Cluster', placeholder: 'e.g., 20' },
];

const NAV_BUTTON_CLASS = 'flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-zinc-200 dark:hover:bg-white/10';

/** SmartSim's clustering form: every field is optional. */
export const ClusteringCard = ({ isClustering, error }: { isClustering: boolean; error: string | null }) => {
    const { data: status } = useSimilarityStatus();
    const inputs = useSimilarityStore(state => state.clusterInputs);
    const setClusterInput = useSimilarityStore(state => state.setClusterInput);
    const submitClustering = useSimilarityStore(state => state.submitClustering);
    const canCluster = (status?.indexedCount ?? 0) > 1;
    return (
        <>
            <SimilarityCard icon={<Layers className="h-5 w-5" aria-hidden="true" />} title="Image Clustering">
                <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                        {CLUSTER_FIELDS.map(({ field, label, placeholder, step, max }) => (
                            <label key={field} className={LABEL_CLASS}>
                                <span className="mb-1 block">{label}</span>
                                <input
                                    type="number"
                                    min={field === 'threshold' ? 0 : 1}
                                    max={max}
                                    step={step}
                                    placeholder={placeholder}
                                    value={inputs[field]}
                                    onChange={event => setClusterInput(field, event.target.value)}
                                    className={INPUT_CLASS}
                                />
                            </label>
                        ))}
                    </div>
                    <ul className="space-y-0.5 text-xs text-gray-500 dark:text-zinc-400">
                        <li>• Leave fields empty to use default clustering behavior</li>
                        <li>• Use either &quot;Max Clusters&quot; OR &quot;Similarity Threshold&quot;, not both</li>
                        <li>• Min/Max images per cluster are optional filters</li>
                    </ul>
                    <button
                        type="button"
                        onClick={submitClustering}
                        disabled={!canCluster || isClustering}
                        className={PRIMARY_BUTTON_CLASS}
                    >
                        {isClustering ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Layers className="h-4 w-4" aria-hidden="true" />}
                        {isClustering ? 'Clustering...' : 'Cluster'}
                    </button>
                </div>
            </SimilarityCard>
            {error && <SimilarityError message={error} />}
        </>
    );
};

interface ClusterResultsProps extends Omit<ResultGridProps, 'items'> {
    clusters: string[][];
    scope: SearchScope;
}

/** SmartSim's cluster browser: one cluster at a time with Previous / Next. */
export const ClusterResults = ({ clusters, scope, scrollContainerRef, onOpenResult }: ClusterResultsProps) => {
    const clusterIndex = useSimilarityStore(state => state.clusterIndex);
    const setClusterIndex = useSimilarityStore(state => state.setClusterIndex);
    const clearClusters = useSimilarityStore(state => state.clearClusters);
    const ids = React.useMemo(() => clusters[clusterIndex] ?? [], [clusters, clusterIndex]);
    const imagesQuery = useClusterImages(ids, scope);
    const items = React.useMemo<ResultItem[]>(
        () => (imagesQuery.data ?? []).map(image => ({ id: image.id, image })),
        [imagesQuery.data]
    );
    const count = clusters.length;

    return (
        <div className="px-3 pb-8 pt-4">
            <ResultHeader
                center={count > 0 ? (
                    <div className="flex items-center gap-4">
                        <button type="button" onClick={() => setClusterIndex(clusterIndex - 1)} disabled={clusterIndex === 0} className={NAV_BUTTON_CLASS}>
                            <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Previous
                        </button>
                        <span className="text-sm font-medium text-gray-500 dark:text-zinc-400">
                            Cluster {clusterIndex + 1} of {count}
                        </span>
                        <button type="button" onClick={() => setClusterIndex(clusterIndex + 1)} disabled={clusterIndex === count - 1} className={NAV_BUTTON_CLASS}>
                            Next <ChevronRight className="h-4 w-4" aria-hidden="true" />
                        </button>
                    </div>
                ) : (
                    <h2 className="text-center text-2xl font-bold text-gray-900 dark:text-white">No clusters found</h2>
                )}
                action={(
                    <button type="button" onClick={clearClusters} className={SECONDARY_BUTTON_CLASS}>
                        <X className="h-4 w-4" aria-hidden="true" /> Clear results
                    </button>
                )}
            />
            {count > 0 && (
                <h2 className="mt-4 text-center text-2xl font-bold text-gray-900 dark:text-white">
                    Cluster {clusterIndex + 1}/{count} ({imagesQuery.data?.length ?? ids.length} images)
                </h2>
            )}
            {imagesQuery.isError && (
                <p role="alert" className="mt-2 text-center text-sm text-red-600 dark:text-red-400">Could not load this cluster&apos;s images.</p>
            )}
            <ResultGrid items={items} scrollContainerRef={scrollContainerRef} onOpenResult={onOpenResult} />
        </div>
    );
};
