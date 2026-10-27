import { useState } from 'react';
import {
    Wand2, Copy, Check, ClipboardList,
    Sparkles, Eye, Shuffle, Puzzle, Code, Target, Link, Layers, Maximize2, ScanFace, type LucideIcon
} from 'lucide-react';
import { AIImage, GeneratorTool } from '../../../../types';
import { ResourcesSection } from './ResourcesSection';
import { MetadataRawInspector } from './MetadataRawInspector';
import { HighlightedPromptText } from './HighlightedPromptText';
import type { PromptHighlightSpec } from '../../utils/searchHighlights';
import { TooltipButton } from '../../../../components/ui/InfoTooltip';
import { formatInvokeImageCategory, isKnownInvokeImageAsset } from '../../../../utils/invokeImageSource';
import { InvokeReferenceLinks } from './InvokeReferenceLinks';
import { MetadataTextAreaField } from './MetadataTextAreaField';
import { MetadataParameterList } from './MetadataParameterList';
import { MetadataSectionHeader } from './MetadataSectionHeader';
import { getModelPresentation } from './modelPresentation';
import { MetadataGeneratorField } from './MetadataGeneratorField';
import { MetadataModelField } from './MetadataModelField';
import { RESOURCE_GROUPS, getResourceWeights } from '../../utils/resourceGroups';
import type { MetadataDisclosureController } from '../../hooks/useMetadataDisclosureState';

const RESOURCE_ICONS: Record<(typeof RESOURCE_GROUPS)[number]['key'], LucideIcon> = {
    loras: Puzzle, embeddings: Code, hypernetworks: Sparkles, controlNets: Target, ipAdapters: Link,
    vaes: Layers, upscalers: Maximize2, clipVisions: Eye, detectors: ScanFace,
};

interface MetadataInfoTabProps {
    image: AIImage;
    disclosure?: MetadataDisclosureController;
    onAIAnalysis: () => void;
    onGenerateVariations: () => void;
    isAnalyzing: boolean;
    onOpenAIResult?: () => void;
    searchHighlights?: PromptHighlightSpec;
    onOpenReferencedImage?: (imageId: string) => Promise<boolean>;
}

export const MetadataInfoTab = ({
    image,
    disclosure,
    onAIAnalysis,
    onGenerateVariations,
    isAnalyzing,
    onOpenAIResult,
    searchHighlights,
    onOpenReferencedImage
}: MetadataInfoTabProps) => {
    // Feedback State
    const [copiedPrompt, setCopiedPrompt] = useState(false);
    const [copiedData, setCopiedData] = useState(false);
    const positivePrompt = image.metadata.positivePrompt || '';
    const negativePrompt = image.metadata.negativePrompt || '';

    const invokeImageName = image.invokeImageName?.trim() || undefined;
    const invokeImageCategory = formatInvokeImageCategory(image.invokeImageCategory);
    const invokeImageOrigin = image.invokeImageOrigin?.trim() || undefined;
    const hasInvokeSource = Boolean(invokeImageName || invokeImageCategory || invokeImageOrigin);
    const isInvokeImageAsset = isKnownInvokeImageAsset(image.invokeImageCategory);
    const modelPresentation = getModelPresentation(image.metadata);

    const handleCopyPrompt = () => {
        navigator.clipboard.writeText(positivePrompt);
        setCopiedPrompt(true);
        setTimeout(() => setCopiedPrompt(false), 2000);
    };

    const handleCopyGenData = () => {
        const md = image.metadata;

        let text = '';
        if (md.rawParameters && md.tool === GeneratorTool.AUTOMATIC1111) {
            text = md.rawParameters;
        } else {
            const params: string[] = [];
            params.push(`Steps: ${md.steps || 0}`);
            params.push(`Sampler: ${md.sampler || 'Euler a'}`);
            if (md.cfg) params.push(`CFG scale: ${md.cfg}`);
            if (md.seed !== undefined) params.push(`Seed: ${md.seed}`);
            params.push(`Size: ${image.width}x${image.height}`);
            if (md.modelHash) params.push(`Model hash: ${md.modelHash}`);
            if (md.model && md.model !== 'Unknown') params.push(`Model: ${md.model}`);

            const neg = negativePrompt ? `\nNegative prompt: ${negativePrompt}` : '';
            text = `${md.positivePrompt || ''}${neg}\n${params.join(', ')}`;
        }

        navigator.clipboard.writeText(text);
        setCopiedData(true);
        setTimeout(() => setCopiedData(false), 2000);
    };

    const invokeProvenance = (
        <>
            {hasInvokeSource ? (
                <section className="rounded-xl border border-gray-200 bg-white/50 p-4 dark:border-white/5 dark:bg-zinc-800/30" aria-labelledby="invoke-source-heading">
                    <MetadataSectionHeader title="Source" icon={Link} headingId="invoke-source-heading" className="mb-3" />
                    <dl className="space-y-2 text-xs">
                        <div className="flex items-start justify-between gap-4">
                            <dt className="text-gray-400">System</dt>
                            <dd className="text-right font-medium text-gray-700 dark:text-gray-200">InvokeAI</dd>
                        </div>
                        {invokeImageName ? (
                            <div className="flex items-start justify-between gap-4">
                                <dt className="text-gray-400">Image name</dt>
                                <dd className="min-w-0 break-all text-right font-mono text-gray-700 dark:text-gray-200">{invokeImageName}</dd>
                            </div>
                        ) : null}
                        {invokeImageCategory ? (
                            <div className="flex items-start justify-between gap-4">
                                <dt className="text-gray-400">Category</dt>
                                <dd className="min-w-0 break-words text-right font-medium text-gray-700 dark:text-gray-200">{invokeImageCategory}</dd>
                            </div>
                        ) : null}
                        {invokeImageOrigin ? (
                            <div className="flex items-start justify-between gap-4">
                                <dt className="text-gray-400">Origin</dt>
                                <dd className="min-w-0 break-words text-right font-medium text-gray-700 dark:text-gray-200">{invokeImageOrigin}</dd>
                            </div>
                        ) : null}
                    </dl>
                </section>
            ) : null}

            {onOpenReferencedImage ? (
                <InvokeReferenceLinks imageId={image.id} onOpenImage={onOpenReferencedImage} />
            ) : null}
        </>
    );

    return (
        <>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 animate-in fade-in slide-in-from-right-4 duration-300">
                <div className="space-y-6 flex-1">

                    <MetadataTextAreaField
                        kind="positivePrompt"
                        value={positivePrompt}
                        readContent={<HighlightedPromptText text={positivePrompt} terms={searchHighlights?.positivePrompt} />}
                        headerAction={<TooltipButton label="Copy Prompt" content="Copy Prompt" onClick={handleCopyPrompt} className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-zinc-500 dark:hover:bg-white/5 dark:hover:text-zinc-300">{copiedPrompt ? <Check className="h-3.5 w-3.5 text-sage-600 dark:text-sage-300" /> : <Copy className="h-3.5 w-3.5" />}</TooltipButton>}
                    />

                    <MetadataTextAreaField
                        kind="negativePrompt"
                        value={negativePrompt}
                        readContent={<HighlightedPromptText text={negativePrompt} terms={searchHighlights?.negativePrompt} />}
                    />

                    {isInvokeImageAsset ? invokeProvenance : null}

                    <MetadataGeneratorField value={image.metadata.tool} />

                    <MetadataModelField presentation={modelPresentation} />

                    <MetadataParameterList rows={[
                        { label: 'Seed', value: image.metadata.seed?.toString() ?? 'Unknown' },
                        { label: 'Steps', value: image.metadata.steps > 0 ? image.metadata.steps.toString() : 'Unknown' },
                        { label: 'CFG', value: image.metadata.cfg > 0 ? image.metadata.cfg.toString() : 'Unknown' },
                        { label: 'Sampler', value: image.metadata.sampler || 'Unknown' },
                        { label: 'VAE', value: image.metadata.vae || 'Unknown', optional: true },
                        { label: 'Clip Skip', value: image.metadata.clipSkip?.toString() || 'Unknown', optional: true },
                        { label: 'Denoising', value: image.metadata.denoisingStrength?.toString() || 'Unknown', optional: true },
                        { label: 'Hires Upscale', value: image.metadata.hiresUpscale?.toString() || 'Unknown', optional: true },
                        { label: 'Hires Steps', value: image.metadata.hiresSteps?.toString() || 'Unknown', optional: true },
                        { label: 'Hires Upscaler', value: image.metadata.hiresUpscaler || 'Unknown', optional: true },
                        { label: 'Model Hash', value: modelPresentation.isHashFallback ? 'Unknown' : (image.metadata.modelHash || 'Unknown'), optional: true },
                    ]} expanded={disclosure?.isExpanded('generationParameters')} onExpandedChange={expanded => disclosure?.setExpanded('generationParameters', expanded)} headerAction={
                    <TooltipButton label="Copy generation data" content="Copy prompts and generation settings in the best available source-compatible format." onClick={handleCopyGenData} className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-zinc-500 dark:hover:bg-white/5 dark:hover:text-zinc-300">
                        {copiedData ? <Check className="h-3.5 w-3.5 text-sage-600 dark:text-sage-300" /> : <ClipboardList className="h-3.5 w-3.5" />}
                        </TooltipButton>
                    } />

                    <ResourcesSection
                        groups={RESOURCE_GROUPS.map(group => ({
                            title: group.title,
                            items: image.metadata[group.key],
                            icon: RESOURCE_ICONS[group.key],
                            weights: getResourceWeights(image.metadata, group),
                        }))}
                        expanded={disclosure?.isExpanded('resources')}
                        onExpandedChange={expanded => disclosure?.setExpanded('resources', expanded)}
                    />

                    {!isInvokeImageAsset ? invokeProvenance : null}

                    {/* Raw Inspector */}
                    <MetadataRawInspector image={image} />
                </div>
            </div>

            {/* AI Tools Footer */}
            <div className="shrink-0 p-4 border-t border-gray-200 dark:border-white/5 bg-white dark:bg-zinc-900 z-10 shadow-[0_-10px_40px_rgba(0,0,0,0.1)]">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-amethyst-600 dark:text-amethyst-300" />
                        <h3 className="text-xs font-bold uppercase text-amethyst-600 dark:text-amethyst-300 tracking-wider">Creative Assistant</h3>
                    </div>
                    {onOpenAIResult && (
                        <button onClick={onOpenAIResult} className="flex items-center gap-1 text-xs text-amethyst-600 hover:text-amethyst-600 hover:underline dark:text-amethyst-300 dark:hover:text-amethyst-300">
                            View last result <Eye className="w-3 h-3" />
                        </button>
                    )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <button
                        onClick={onAIAnalysis} disabled={isAnalyzing}
                        className="p-4 bg-white/60 dark:bg-zinc-800/40 rounded-xl border border-gray-200 dark:border-white/5 hover:border-amethyst-300 dark:hover:border-amethyst-500/30 transition-all flex flex-col justify-between h-24 text-left group"
                    >
                        <span className="text-xs font-bold text-gray-700 dark:text-gray-300">Prompt Analysis</span>
                        <div className="flex items-center justify-between w-full">
                            <span className="text-[10px] text-gray-500 group-hover:text-amethyst-600 dark:text-zinc-400 dark:group-hover:text-amethyst-300">
                                {isAnalyzing ? "Analyzing..." : "Get insights"}
                            </span>
                            {isAnalyzing ? <div className="animate-spin rounded-full h-4 w-4 border-2 border-amethyst-600 border-t-transparent dark:border-amethyst-300" /> : <Wand2 className="w-4 h-4 text-amethyst-600 dark:text-amethyst-300" />}
                        </div>
                    </button>

                    <button
                        onClick={onGenerateVariations} disabled={isAnalyzing}
                        className="p-4 bg-white/60 dark:bg-zinc-800/40 rounded-xl border border-gray-200 dark:border-white/5 hover:border-amethyst-300 dark:hover:border-amethyst-500/30 transition-all flex flex-col justify-between h-24 text-left group"
                    >
                        <span className="text-xs font-bold text-gray-700 dark:text-gray-300">Variations</span>
                        <div className="flex items-center justify-between w-full">
                            <span className="text-[10px] text-gray-500 group-hover:text-amethyst-600 dark:text-zinc-400 dark:group-hover:text-amethyst-300">
                                {isAnalyzing ? "Creating..." : "Create twists"}
                            </span>
                            {isAnalyzing ? <div className="animate-spin rounded-full h-4 w-4 border-2 border-amethyst-600 border-t-transparent dark:border-amethyst-300" /> : <Shuffle className="w-4 h-4 text-amethyst-600 dark:text-amethyst-300" />}
                        </div>
                    </button>
                </div>
            </div>
        </>
    );
};
