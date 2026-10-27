import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage, type ImageMetadata } from '../../../../../types';
import { MetadataInfoTab } from '../MetadataInfoTab';

const metadata = (overrides: Partial<ImageMetadata> = {}): ImageMetadata => ({
    tool: GeneratorTool.UNKNOWN,
    model: 'Unknown',
    seed: 1,
    steps: 20,
    cfg: 7,
    sampler: 'Euler',
    positivePrompt: 'Original prompt',
    negativePrompt: '',
    ...overrides,
});

const image = (current: ImageMetadata, original: ImageMetadata): AIImage => ({
    id: 'C:/library/image.png',
    url: 'asset://image.png',
    thumbnailUrl: 'asset://thumb.webp',
    filename: 'image.png',
    timestamp: 1,
    width: 100,
    height: 100,
    isFavorite: false,
    metadata: current,
    originalMetadata: original,
});

const renderTab = (value: AIImage) => render(<MetadataInfoTab
    image={value}
    onAIAnalysis={vi.fn()}
    onGenerateVariations={vi.fn()}
    isAnalyzing={false}
/>);

describe('MetadataInfoTab prompt revert control', () => {
});
