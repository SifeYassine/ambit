import * as React from 'react';
import { AlertCircle, Download, Loader2, ScanSearch, Square, Trash2 } from 'lucide-react';
import { cancelSimilarityIndexing, cancelSimilarityModelDownload } from '../../../services/similarityService';
import { useSimilarityStore } from '../../../stores/similarityStore';
import { useSimilarityStatus } from '../hooks/useSimilarity';
import { useAutoIndexing, useSimilarityJobs } from '../hooks/useSimilarityJobs';
import {
    formatMegabytes,
    PRIMARY_BUTTON_CLASS,
    ProgressRow,
    SECONDARY_BUTTON_CLASS,
    SimilarityCard,
    STOP_BUTTON_CLASS,
} from './SimilarityCard';

/** Replaces SmartSim's folder upload: the library is the image set, indexed in place. */
export const LibraryIndexCard = () => {
    const { data: status, isLoading } = useSimilarityStatus();
    const isDownloading = useSimilarityStore(state => state.isDownloading);
    const downloadProgress = useSimilarityStore(state => state.downloadProgress);
    const isIndexing = useSimilarityStore(state => state.isIndexing);
    const indexProgress = useSimilarityStore(state => state.indexProgress);
    const lastIndexResult = useSimilarityStore(state => state.lastIndexResult);
    const jobError = useSimilarityStore(state => state.jobError);
    const { download, index, removeModel } = useSimilarityJobs();
    useAutoIndexing(index);

    let body: React.ReactNode;
    if (isLoading || !status) {
        body = (
            <p role="status" className="flex items-center gap-2 text-sm text-gray-500 dark:text-zinc-400">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Checking the similarity index…
            </p>
        );
    } else if (!status.modelInstalled) {
        body = (
            <div className="space-y-3">
                <p className="text-sm text-gray-600 dark:text-zinc-300">
                    A CLIP model (CLIP ViT-B/16, {formatMegabytes(status.modelSizeBytes)}) is needed to index images. It will be downloaded
                    from Hugging Face, with ONNX Runtime from GitHub, and saved locally.
                </p>
                {isDownloading ? (
                    <ProgressRow
                        progress={downloadProgress}
                        label={downloadProgress
                            ? `Downloading… ${formatMegabytes(downloadProgress.current)} of ${formatMegabytes(downloadProgress.total)}`
                            : 'Starting download…'}
                        action={(
                            <button type="button" onClick={() => void cancelSimilarityModelDownload()} className={STOP_BUTTON_CLASS}>
                                <Square className="h-3.5 w-3.5 fill-white text-white" aria-hidden="true" /> Cancel
                            </button>
                        )}
                    />
                ) : (
                    <button type="button" onClick={() => void download()} className={PRIMARY_BUTTON_CLASS}>
                        <Download className="h-4 w-4" aria-hidden="true" /> Download model
                    </button>
                )}
            </div>
        );
    } else if (isIndexing) {
        body = (
            <ProgressRow
                progress={indexProgress}
                label={indexProgress
                    ? `Indexing images… ${indexProgress.current.toLocaleString()} of ${indexProgress.total.toLocaleString()}`
                    : 'Loading the model…'}
                action={(
                    <button type="button" onClick={() => void cancelSimilarityIndexing()} className={STOP_BUTTON_CLASS}>
                        <Square className="h-3.5 w-3.5 fill-white text-white" aria-hidden="true" /> Stop
                    </button>
                )}
            />
        );
    } else {
        body = (
            <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-zinc-200">
                    <span className="rounded-full bg-gray-100 px-2.5 py-0.5 font-medium dark:bg-white/10">
                        {status.indexedCount.toLocaleString()} indexed
                    </span>
                    {status.pendingCount > 0 && (
                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                            {status.pendingCount.toLocaleString()} not indexed yet
                        </span>
                    )}
                    {lastIndexResult && lastIndexResult.failed > 0 && (
                        <span className="text-xs text-gray-500 dark:text-zinc-400">
                            {lastIndexResult.failed.toLocaleString()} could not be read
                        </span>
                    )}
                </div>
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={() => void index()}
                        disabled={status.pendingCount === 0}
                        className={PRIMARY_BUTTON_CLASS}
                    >
                        <ScanSearch className="h-4 w-4" aria-hidden="true" />
                        {status.pendingCount > 0 ? `Index ${status.pendingCount.toLocaleString()} images` : 'Library is indexed'}
                    </button>
                    <button type="button" onClick={() => void removeModel()} className={SECONDARY_BUTTON_CLASS} title="Frees disk space; the index is kept">
                        <Trash2 className="h-4 w-4" aria-hidden="true" /> Remove model
                    </button>
                </div>
            </div>
        );
    }

    return (
        <SimilarityCard icon={<ScanSearch className="h-5 w-5" aria-hidden="true" />} title="Library Index" fixed>
            {body}
            {jobError && (
                <p role="alert" className="mt-3 flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
                    <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" /> {jobError}
                </p>
            )}
        </SimilarityCard>
    );
};
