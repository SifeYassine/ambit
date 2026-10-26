import * as React from 'react';
import { getEffectiveSourceKind, type AIImage, type GeneratorTool } from '../../../types';
import { getImageViewerTabs, type ViewerTabId } from '../hooks/viewerTabAvailability';
import type { PromptHighlightSpec } from '../utils/searchHighlights';
import { MetadataInfoTab } from './metadata/MetadataInfoTab';
import { PhotoDetailsTab } from './metadata/PhotoDetailsTab';
import { ViewerSidebarShell } from './ViewerSidebarShell';
import { WorkflowInspector } from './WorkflowInspector';
import type { MetadataDisclosureController } from '../hooks/useMetadataDisclosureState';

type ImageViewerTab = ViewerTabId;

interface MetadataSidebarProps {
    image: AIImage;
    activeTab: ImageViewerTab;
    setActiveTab: (tab: ImageViewerTab) => void;
    availableTags: string[];
    modelOptions?: readonly string[];
    disclosure?: MetadataDisclosureController;
    promptValue: string;
    setPromptValue: React.Dispatch<React.SetStateAction<string>>;
    negativePromptValue: string;
    setNegativePromptValue: React.Dispatch<React.SetStateAction<string>>;
    onUpdatePrompt?: (imageId: string, prompt: string) => void;
    onUpdateNegativePrompt?: (imageId: string, negativePrompt: string) => void;
    onUpdateModel?: (imageId: string, newModel: string) => void;
    onUpdateTool?: (id: string, tool: GeneratorTool) => void;
    onSearch: (term: string) => void;
    onClose: () => void;
    onRecoverMetadata?: () => void;
    onRevertMetadata?: (id: string) => void;
    onAIAnalysis: () => void;
    onGenerateVariations: () => void;
    isAnalyzing: boolean;
    onOpenAIResult?: () => void;
    isLoading?: boolean;
    searchHighlights?: PromptHighlightSpec;
    onOpenReferencedImage?: (imageId: string) => Promise<boolean>;
    /** Viewer stage that replaces the image while the Workflow tab is active. */
    workflowStage?: HTMLElement | null;
}

export const MetadataSidebar: React.FC<MetadataSidebarProps> = ({
    image,
    activeTab,
    setActiveTab,
    availableTags,
    modelOptions,
    disclosure,
    promptValue,
    setPromptValue,
    negativePromptValue,
    setNegativePromptValue,
    onUpdatePrompt,
    onUpdateNegativePrompt,
    onUpdateModel,
    onUpdateTool,
    onSearch,
    onClose,
    onRecoverMetadata,
    onRevertMetadata,
    onAIAnalysis,
    onGenerateVariations,
    isAnalyzing,
    onOpenAIResult,
    isLoading,
    searchHighlights,
    onOpenReferencedImage,
    workflowStage,
}) => {
    const isGenerated = getEffectiveSourceKind(image) === 'generated';
    const tabs = getImageViewerTabs(image);
    const effectiveActiveTab = tabs.some(tab => tab.id === activeTab)
        ? activeTab
        : 'metadata';

    return <ViewerSidebarShell
        tabs={tabs}
        activeTab={effectiveActiveTab}
        onTabChange={setActiveTab}
        ariaLabel="Image viewer sections"
    >
        {!isGenerated && effectiveActiveTab === 'metadata' ? <PhotoDetailsTab key={image.id} image={image} isLoading={isLoading} /> : null}

        {isGenerated && effectiveActiveTab === 'metadata' ? (
            <MetadataInfoTab
                image={image}
                promptValue={promptValue}
                setPromptValue={setPromptValue}
                negativePromptValue={negativePromptValue}
                setNegativePromptValue={setNegativePromptValue}
                availableTags={availableTags}
                modelOptions={modelOptions}
                disclosure={disclosure}
                onUpdatePrompt={onUpdatePrompt}
                onUpdateNegativePrompt={onUpdateNegativePrompt}
                onSearch={onSearch}
                onClose={onClose}
                onRecoverMetadata={onRecoverMetadata}
                onRevertMetadata={onRevertMetadata}
                onUpdateModel={onUpdateModel}
                onUpdateTool={onUpdateTool}
                onAIAnalysis={onAIAnalysis}
                onGenerateVariations={onGenerateVariations}
                isAnalyzing={isAnalyzing}
                onOpenAIResult={onOpenAIResult}
                isLoading={isLoading}
                searchHighlights={searchHighlights}
                onOpenReferencedImage={onOpenReferencedImage}
            />
        ) : null}

        {isGenerated && effectiveActiveTab === 'workflow' ? <WorkflowInspector key={image.id} image={image} graphStage={workflowStage} /> : null}
    </ViewerSidebarShell>;
};
