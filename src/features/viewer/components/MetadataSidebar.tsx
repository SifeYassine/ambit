import * as React from 'react';
import { getEffectiveSourceKind, type AIImage } from '../../../types';
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
    disclosure?: MetadataDisclosureController;
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
    disclosure,
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
                disclosure={disclosure}
                onAIAnalysis={onAIAnalysis}
                onGenerateVariations={onGenerateVariations}
                isAnalyzing={isAnalyzing}
                onOpenAIResult={onOpenAIResult}
                searchHighlights={searchHighlights}
                onOpenReferencedImage={onOpenReferencedImage}
            />
        ) : null}

        {isGenerated && effectiveActiveTab === 'workflow' ? <WorkflowInspector key={image.id} image={image} graphStage={workflowStage} /> : null}
    </ViewerSidebarShell>;
};
