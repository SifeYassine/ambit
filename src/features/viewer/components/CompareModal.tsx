import * as React from 'react';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ZoomIn, ZoomOut, RotateCcw, ArrowRightLeft, Columns, Layers, PanelLeft, ChevronRight, Sidebar, SplitSquareHorizontal, Heart, GitCompare, Eye, EyeOff, Pin } from 'lucide-react';
import { AIImage } from '../../../types';
import { SmartImage } from '../../library/components/SmartImage';
import { getFilename } from '../../../utils/pathUtils';
import {
    CENTER_ANCHOR,
    Point,
    ViewportRect,
    getAnchorPoint,
    getZoomTransform
} from '../../../utils/zoomMath';
import { useSettingsStore } from '../../../stores/settingsStore';
import { TooltipButton } from '../../../components/ui/InfoTooltip';
import { buildTagSegments, diffPromptTags, hasTagChanges, PromptTagDiff, PromptTagEntry, PromptTagStatus } from '../utils/promptTags';
import { formatImageFileHash, ImageFileHashState, useImageFileHash } from '../hooks/useImageFileHash';

interface CompareModalProps {
    imageA: AIImage;
    imageB: AIImage;
    onClose: () => void;
    onToggleFavorite: (id: string) => void;
    onTogglePin?: (id: string, isPinned: boolean) => void;
}

type CompareMode = 'split' | 'slider' | 'overlay';
type DiffMode = 'diff' | 'raw';

const COMPARE_MIN_SCALE = 1;
const COMPARE_MAX_SCALE = 5;
const COMPARE_BUTTON_ZOOM_STEP = 0.5;
const DIAGONAL_OFFSET_PX = 28;
const DIAGONAL_DIVIDER_WIDTH_PX = 4;
const CANVAS_PADDING_PX = 24;
const SLIDER_HIT_TARGET_WIDTH_PX = 80;
const SLIDER_EDGE_TRAVEL_PX = DIAGONAL_OFFSET_PX + Math.ceil(DIAGONAL_DIVIDER_WIDTH_PX / 2) + 2;

// Rounded tag box; `box-decoration-clone` keeps the padding and rounding on every wrapped line.
const PILL_CLASS_NAME = 'rounded-md px-1.5 py-0.5 box-decoration-clone';

const TAG_STATUS_CLASS_NAMES: Record<PromptTagStatus, string> = {
    removed: `${PILL_CLASS_NAME} bg-red-500/50 text-white`,
    added: `${PILL_CLASS_NAME} bg-sage-500/50 text-white`,
    // Edited tags only color their changed characters (see `removed`/`added`).
    edited: '',
    reweighted: `${PILL_CLASS_NAME} bg-orange-500/40 text-orange-100`,
    moved: `${PILL_CLASS_NAME} bg-blue-500/40 text-blue-100`,
};

interface MediaFrame {
    left: number;
    top: number;
    width: number;
    height: number;
}

interface CanvasSize {
    width: number;
    height: number;
}

const getCompareViewportRect = (
    containerRect: DOMRect,
    clientX: number,
    mode: CompareMode
): ViewportRect => {
    if (mode !== 'split') {
        return containerRect;
    }

    const halfWidth = containerRect.width / 2;
    const isRightPane = clientX >= containerRect.left + halfWidth;

    return {
        left: isRightPane ? containerRect.left + halfWidth : containerRect.left,
        top: containerRect.top,
        width: halfWidth,
        height: containerRect.height
    };
};

const getFittedRect = (
    imageWidth: number,
    imageHeight: number,
    availableWidth: number,
    availableHeight: number
): MediaFrame => {
    if (imageWidth <= 0 || imageHeight <= 0 || availableWidth <= 0 || availableHeight <= 0) {
        return {
            left: CANVAS_PADDING_PX,
            top: CANVAS_PADDING_PX,
            width: Math.max(0, availableWidth),
            height: Math.max(0, availableHeight)
        };
    }

    const scale = Math.min(availableWidth / imageWidth, availableHeight / imageHeight);
    const width = imageWidth * scale;
    const height = imageHeight * scale;

    return {
        left: CANVAS_PADDING_PX + (availableWidth - width) / 2,
        top: CANVAS_PADDING_PX + (availableHeight - height) / 2,
        width,
        height
    };
};

const getUnionFrame = (frameA: MediaFrame, frameB: MediaFrame): MediaFrame => {
    const left = Math.min(frameA.left, frameB.left);
    const top = Math.min(frameA.top, frameB.top);
    const right = Math.max(frameA.left + frameA.width, frameB.left + frameB.width);
    const bottom = Math.max(frameA.top + frameA.height, frameB.top + frameB.height);

    return {
        left,
        top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top)
    };
};

const framesAreEqual = (frameA: MediaFrame, frameB: MediaFrame) => (
    Math.abs(frameA.left - frameB.left) < 0.5 &&
    Math.abs(frameA.top - frameB.top) < 0.5 &&
    Math.abs(frameA.width - frameB.width) < 0.5 &&
    Math.abs(frameA.height - frameB.height) < 0.5
);

const getZoomedFrame = (
    frame: MediaFrame,
    canvasSize: CanvasSize,
    position: { x: number, y: number },
    scale: number
): MediaFrame => {
    if (canvasSize.width <= 0 || canvasSize.height <= 0) return frame;

    const originX = canvasSize.width / 2;
    const originY = canvasSize.height / 2;

    return {
        left: originX + position.x + (frame.left - originX) * scale,
        top: originY + position.y + (frame.top - originY) * scale,
        width: frame.width * scale,
        height: frame.height * scale
    };
};

const clampFrameToCanvas = (frame: MediaFrame, canvasSize: CanvasSize): MediaFrame => {
    if (canvasSize.width <= 0 || canvasSize.height <= 0) return frame;

    const left = Math.max(0, frame.left);
    const top = Math.max(0, frame.top);
    const right = Math.min(canvasSize.width, frame.left + frame.width);
    const bottom = Math.min(canvasSize.height, frame.top + frame.height);

    return {
        left,
        top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top)
    };
};

const ImageActions = ({
    img,
    side,
    onToggleFavorite,
    onTogglePin
}: {
    img: AIImage,
    side: 'left' | 'right',
    onToggleFavorite: (id: string) => void,
    onTogglePin?: (id: string, isPinned: boolean) => void
}) => (
    <div className={`absolute top-3 ${side === 'left' ? 'left-3' : 'right-3'} z-50 flex gap-2 pointer-events-auto`}>
        <TooltipButton
            label={img.isFavorite ? "Remove from Favorites" : "Add to Favorites"}
            content={img.isFavorite ? "Remove from Favorites" : "Add to Favorites"}
            aria-pressed={img.isFavorite}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleFavorite(img.id);
            }}
            className="p-2.5 bg-black/60 hover:bg-black/90 rounded-full transition-all group cursor-pointer border border-white/10 backdrop-blur-md"
        >
            <Heart className={`w-4 h-4 transition-transform group-hover:scale-110 ${img.isFavorite ? 'fill-red-500 text-red-500' : 'text-white'}`} />
        </TooltipButton>

        {onTogglePin && (
            <TooltipButton
                label={img.isPinned ? "Unpin" : "Pin to Top"}
                content={img.isPinned ? "Unpin" : "Pin to Top"}
                aria-pressed={Boolean(img.isPinned)}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onTogglePin(img.id, !img.isPinned);
                }}
                className="p-2.5 bg-black/60 hover:bg-black/90 rounded-full transition-all group cursor-pointer border border-white/10 backdrop-blur-md"
            >
                <Pin className={`w-4 h-4 transition-transform group-hover:scale-110 ${img.isPinned ? 'fill-sage-400 text-sage-400' : 'text-white'}`} />
            </TooltipButton>
        )}
    </div>
);

// Extracted Component to prevent re-renders
const ImageContainer = ({
    img,
    position,
    scale,
    isDraggingCanvas,
    imagePaddingClassName = 'p-6',
    objectPosition = 'center'
}: {
    img: AIImage,
    position: { x: number, y: number },
    scale: number,
    isDraggingCanvas: boolean,
    imagePaddingClassName?: string,
    objectPosition?: React.CSSProperties['objectPosition']
}) => (
    <div className="relative w-full h-full flex items-center justify-center bg-zinc-950">
        {/* Image Transform */}
        <div
            className={`w-full h-full flex items-center justify-center ${imagePaddingClassName} box-border`}
            style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`, transition: isDraggingCanvas ? 'none' : 'transform 0.1s ease-out' }}
        >
            <SmartImage
                src={img.url}
                alt={img.filename}
                className="w-full h-full"
                imgClassName="w-full h-full object-contain shadow-2xl"
                draggable={false}
                objectFit="contain"
                style={{ objectFit: 'contain', objectPosition }}
            />
        </div>
    </div>
);

export const CompareModal: React.FC<CompareModalProps> = ({
    imageA,
    imageB,
    onClose,
    onToggleFavorite,
    onTogglePin
}) => {
    const privacyExposureBlocked = useSettingsStore(state => (
        state.privacyEnabled && state.privacyMaskIndexStatus !== 'ready'
    ));
    // View State
    const [mode, setMode] = useState<CompareMode>('split');
    const [scale, setScale] = useState(1);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [sliderPos, setSliderPos] = useState(50);
    const [diffMode, setDiffMode] = useState<DiffMode>('diff');
    const [isOverlayHover, setIsOverlayHover] = useState(false);
    const [mediaFrame, setMediaFrame] = useState<MediaFrame>({
        left: CANVAS_PADDING_PX,
        top: CANVAS_PADDING_PX,
        width: 0,
        height: 0
    });
    const [canvasSize, setCanvasSize] = useState<CanvasSize>({
        width: 0,
        height: 0
    });

    // Diffs are only recomputed when a prompt or the view changes, not on every
    // pan/zoom/slider re-render.
    const positivePromptA = imageA.metadata.positivePrompt;
    const positivePromptB = imageB.metadata.positivePrompt;
    const negativePromptA = imageA.metadata.negativePrompt;
    const negativePromptB = imageB.metadata.negativePrompt;
    const positiveTagDiff = useMemo(
        () => (diffMode === 'diff' && positivePromptA !== positivePromptB ? diffPromptTags(positivePromptA, positivePromptB) : null),
        [diffMode, positivePromptA, positivePromptB],
    );
    const negativeTagDiff = useMemo(
        () => (diffMode === 'diff' && negativePromptA !== negativePromptB ? diffPromptTags(negativePromptA, negativePromptB) : null),
        [diffMode, negativePromptA, negativePromptB],
    );

    const fileHashA = useImageFileHash(imageA);
    const fileHashB = useImageFileHash(imageB);

    useEffect(() => {
        if (privacyExposureBlocked) onClose();
    }, [onClose, privacyExposureBlocked]);

    const [panelWidth, setPanelWidth] = useState(400); // Widened for diff view
    const [isPanelOpen, setIsPanelOpen] = useState(true);

    // Interaction Refs
    const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
    const [isDraggingSlider, setIsDraggingSlider] = useState(false);

    const dragStartRef = useRef({ x: 0, y: 0 });
    const sliderRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const activeMediaFrame = clampFrameToCanvas(
        getZoomedFrame(mediaFrame, canvasSize, position, scale),
        canvasSize
    );
    const activeMediaFrameRef = useRef(activeMediaFrame);

    useEffect(() => {
        const previousFocus = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        closeButtonRef.current?.focus();

        return () => {
            if (previousFocus?.isConnected) previousFocus.focus();
        };
    }, []);

    useEffect(() => {
        activeMediaFrameRef.current = activeMediaFrame;
    }, [activeMediaFrame]);

    useEffect(() => {
        const container = containerRef.current;
        if (privacyExposureBlocked || !container) return;

        const updateMediaFrame = () => {
            const rect = container.getBoundingClientRect();
            const nextCanvasSize = {
                width: rect.width,
                height: rect.height
            };
            const availableWidth = Math.max(0, rect.width - CANVAS_PADDING_PX * 2);
            const availableHeight = Math.max(0, rect.height - CANVAS_PADDING_PX * 2);
            const nextFrame = getUnionFrame(
                getFittedRect(imageA.width, imageA.height, availableWidth, availableHeight),
                getFittedRect(imageB.width, imageB.height, availableWidth, availableHeight)
            );

            setCanvasSize(prev => (
                Math.abs(prev.width - nextCanvasSize.width) < 0.5 &&
                Math.abs(prev.height - nextCanvasSize.height) < 0.5
            ) ? prev : nextCanvasSize);
            setMediaFrame(prev => framesAreEqual(prev, nextFrame) ? prev : nextFrame);
        };

        updateMediaFrame();

        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', updateMediaFrame);
            return () => window.removeEventListener('resize', updateMediaFrame);
        }

        const observer = new ResizeObserver(updateMediaFrame);
        observer.observe(container);
        return () => observer.disconnect();
    }, [imageA.width, imageA.height, imageB.width, imageB.height, privacyExposureBlocked]);

    useEffect(() => {
        if (mode !== 'overlay') setIsOverlayHover(false);
    }, [mode]);

    // --- Zoom/Pan Handlers ---
    const resetZoom = useCallback(() => {
        setScale(COMPARE_MIN_SCALE);
        setPosition(CENTER_ANCHOR);
    }, []);

    const applyZoom = useCallback((targetScale: number, anchor: Point = CENTER_ANCHOR) => {
        const nextView = getZoomTransform({
            currentPosition: position,
            currentScale: scale,
            targetScale,
            minScale: COMPARE_MIN_SCALE,
            maxScale: COMPARE_MAX_SCALE,
            anchor
        });

        setScale(nextView.scale);
        setPosition(nextView.position);
    }, [position, scale]);

    const getAnchorForEvent = useCallback((e: React.MouseEvent | React.WheelEvent): Point => {
        const containerRect = containerRef.current!.getBoundingClientRect();
        const viewportRect = getCompareViewportRect(containerRect, e.clientX, mode);

        return getAnchorPoint({ x: e.clientX, y: e.clientY }, viewportRect);
    }, [mode]);

    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        e.stopPropagation();
        applyZoom(scale + e.deltaY * -0.001, getAnchorForEvent(e));
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        if (scale > COMPARE_MIN_SCALE && !isDraggingSlider) {
            e.preventDefault();
            setIsDraggingCanvas(true);
            dragStartRef.current = { x: e.clientX - position.x, y: e.clientY - position.y };
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isDraggingCanvas && scale > COMPARE_MIN_SCALE) {
            e.preventDefault();
            setPosition({
                x: e.clientX - dragStartRef.current.x,
                y: e.clientY - dragStartRef.current.y
            });
        }

        if (isDraggingSlider && containerRef.current) {
            e.preventDefault();
            const rect = containerRef.current.getBoundingClientRect();
            const frame = activeMediaFrameRef.current;
            const travelLeft = frame.width > 0 ? frame.left - SLIDER_EDGE_TRAVEL_PX : 0;
            const travelWidth = frame.width > 0 ? frame.width + SLIDER_EDGE_TRAVEL_PX * 2 : rect.width;
            const x = Math.max(travelLeft, Math.min(e.clientX - rect.left, travelLeft + travelWidth));
            setSliderPos(travelWidth > 0 ? ((x - travelLeft) / travelWidth) * 100 : 50);
        }

        if (mode === 'overlay' && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            const frame = activeMediaFrameRef.current;
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const isInsideFrame = (
                frame.width > 0 &&
                frame.height > 0 &&
                x >= frame.left &&
                x <= frame.left + frame.width &&
                y >= frame.top &&
                y <= frame.top + frame.height
            );
            setIsOverlayHover(isInsideFrame);
        }
    };

    const handleMouseUp = () => {
        setIsDraggingCanvas(false);
        setIsDraggingSlider(false);
    };

    const handleDoubleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (scale > COMPARE_MIN_SCALE) {
            resetZoom();
        } else {
            applyZoom(2, getAnchorForEvent(e));
        }
    };

    // --- Resize Logic ---
    const startPanelResize = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startW = panelWidth;

        const doResize = (moveEvent: MouseEvent) => {
            const newW = Math.min(800, Math.max(300, startW + (startX - moveEvent.clientX)));
            setPanelWidth(newW);
        };
        const stopResize = () => {
            window.removeEventListener('mousemove', doResize);
            window.removeEventListener('mouseup', stopResize);
        };
        window.addEventListener('mousemove', doResize);
        window.addEventListener('mouseup', stopResize);
    };

    const handleSliderMouseDown = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsDraggingSlider(true);
    };

    // Key above, one rounded value box per image; differing values switch both boxes to ember.
    const valueBoxClassName = (isDiff: boolean) => `rounded-md border px-2 py-1.5 ${isDiff
        ? 'border-ember-500/40 bg-ember-500/10 text-ember-300 font-medium'
        : 'border-white/10 bg-zinc-900 text-gray-300'}`;

    const DiffRow = ({ label, valA, valB }: { label: string, valA: string | number, valB: string | number }) => {
        const isDiff = valA !== valB;
        return (
            <div className={`grid grid-cols-1 gap-1 py-3 border-b border-white/5 text-sm hover:bg-white/5 transition-colors ${isDiff ? 'bg-ember-900/10' : ''}`}>
                <div className="text-[10px] text-gray-500 font-bold uppercase tracking-wider px-4 mb-1">{label}</div>
                <div className="grid grid-cols-2 gap-4 px-4">
                    <div className={`truncate ${isDiff ? 'text-ember-300 font-medium' : 'text-gray-400'}`} title={String(valA)}>{valA}</div>
                    <div className={`truncate ${isDiff ? 'text-ember-300 font-medium' : 'text-gray-400'}`} title={String(valB)}>{valB}</div>
                </div>
            </div>
        );
    };

    // Hashes are too long to truncate like DiffRow values, so they wrap in full.
    const HashRow = ({ hashA, hashB }: { hashA: ImageFileHashState, hashB: ImageFileHashState }) => {
        const isDiff = hashA.status === 'ready' && hashB.status === 'ready' && hashA.hash !== hashB.hash;
        const valueClassName = `break-all font-mono text-xs ${valueBoxClassName(isDiff)}`;
        return (
            <div className="px-4 py-2 text-sm">
                <div className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1.5">SHA-256</div>
                <div className="grid grid-cols-2 gap-2">
                    <div className={valueClassName}>{formatImageFileHash(hashA)}</div>
                    <div className={valueClassName}>{formatImageFileHash(hashB)}</div>
                </div>
            </div>
        );
    };

    // --- Diffing Logic ---
    // Tag-level diff (added/removed/moved/re-weighted tags) with character-level
    // highlights inside tags that were edited.
    const renderTagSegments = (prompt: string, entries: PromptTagEntry[], editedClass: string) =>
        buildTagSegments(prompt, entries).map(({ text, status, move, parts }, i) => {
            if (parts !== null) {
                return (
                    <span key={i}>
                        {parts.map((part, j) => (
                            <span key={j} className={part.type === 'equal' ? undefined : editedClass}>{part.text}</span>
                        ))}
                    </span>
                );
            }
            return (
                <span key={i} className={status === null ? undefined : TAG_STATUS_CLASS_NAMES[status]}>
                    {move === 'up' ? '↑ ' : move === 'down' ? '↓ ' : ''}
                    {text}
                </span>
            );
        });

    // Diff boxes get extra line height so wrapped highlight pills don't touch.
    const renderPromptBox = (title: string, content: React.ReactNode, lineHeightClass: 'leading-relaxed' | 'leading-[2]') => (
        <div className="space-y-1">
            <div className="text-[10px] uppercase text-gray-500 font-bold">{title}</div>
            <div className={`p-3 bg-zinc-900/50 rounded-lg border border-white/5 text-xs text-gray-400 font-mono whitespace-pre-wrap break-words ${lineHeightClass}`}>
                {content}
            </div>
        </div>
    );

    const renderPromptNotice = (message: string) => (
        <div className="text-sm text-gray-600 italic text-center py-4 bg-zinc-900/30 rounded-lg">{message}</div>
    );

    const renderPromptSection = (
        title: string,
        promptA: string,
        promptB: string,
        tagDiff: PromptTagDiff | null,
    ) => {
        let body: React.ReactNode;
        if (promptA === promptB) {
            body = renderPromptNotice(promptA ? 'Prompts are identical' : 'No prompt on either image');
        } else if (tagDiff !== null && !hasTagChanges(tagDiff)) {
            body = renderPromptNotice('Same tags, only formatting differs');
        } else {
            body = (
                <div className="space-y-4">
                    {tagDiff !== null ? (
                        <>
                            {renderPromptBox('Original (Image A)', renderTagSegments(promptA, tagDiff.original, TAG_STATUS_CLASS_NAMES.removed), 'leading-[2]')}
                            {renderPromptBox('New (Image B)', renderTagSegments(promptB, tagDiff.modified, TAG_STATUS_CLASS_NAMES.added), 'leading-[2]')}
                        </>
                    ) : (
                        <>
                            {renderPromptBox('Original (Image A)', promptA, 'leading-relaxed')}
                            {renderPromptBox('New (Image B)', promptB, 'leading-relaxed')}
                        </>
                    )}
                </div>
            );
        }
        return (
            <div className="space-y-2">
                <div className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">{title}</div>
                {body}
            </div>
        );
    };

    const commonImageProps = { position, scale, isDraggingCanvas };
    const sliderTravelLeft = activeMediaFrame.left - SLIDER_EDGE_TRAVEL_PX;
    const sliderTravelWidth = activeMediaFrame.width + SLIDER_EDGE_TRAVEL_PX * 2;
    const sliderTravelX = sliderTravelLeft + (sliderTravelWidth * sliderPos) / 100;
    const sliderVisualX = Math.max(activeMediaFrame.left, Math.min(sliderTravelX, activeMediaFrame.left + activeMediaFrame.width));
    const activeMediaFrameStyle: React.CSSProperties = {
        left: activeMediaFrame.left,
        top: activeMediaFrame.top,
        width: activeMediaFrame.width,
        height: activeMediaFrame.height
    };
    const sliderHandleStyle: React.CSSProperties = {
        left: sliderVisualX,
        top: activeMediaFrame.top,
        height: activeMediaFrame.height,
        width: SLIDER_HIT_TARGET_WIDTH_PX
    };
    const sliderDividerTrackStyle: React.CSSProperties = {
        left: sliderTravelX - activeMediaFrame.left,
        width: SLIDER_HIT_TARGET_WIDTH_PX
    };
    const overlayHintStyle: React.CSSProperties = {
        left: activeMediaFrame.left + activeMediaFrame.width / 2,
        top: Math.max(activeMediaFrame.top + 12, activeMediaFrame.top + activeMediaFrame.height - 48),
        transform: 'translateX(-50%)'
    };
    const sliderClipPath = `polygon(${activeMediaFrame.left}px ${activeMediaFrame.top}px, ${sliderTravelX + DIAGONAL_OFFSET_PX}px ${activeMediaFrame.top}px, ${sliderTravelX - DIAGONAL_OFFSET_PX}px ${activeMediaFrame.top + activeMediaFrame.height}px, ${activeMediaFrame.left}px ${activeMediaFrame.top + activeMediaFrame.height}px)`;
    const sliderDividerClipPath = `polygon(calc(50% + ${DIAGONAL_OFFSET_PX}px - ${DIAGONAL_DIVIDER_WIDTH_PX / 2}px) 0, calc(50% + ${DIAGONAL_OFFSET_PX}px + ${DIAGONAL_DIVIDER_WIDTH_PX / 2}px) 0, calc(50% - ${DIAGONAL_OFFSET_PX}px + ${DIAGONAL_DIVIDER_WIDTH_PX / 2}px) 100%, calc(50% - ${DIAGONAL_OFFSET_PX}px - ${DIAGONAL_DIVIDER_WIDTH_PX / 2}px) 100%)`;

    if (privacyExposureBlocked) return null;

    return (
        <div
            className="fixed inset-0 z-[70] bg-black flex flex-col animate-in fade-in duration-200"
            onMouseUp={handleMouseUp}
            onMouseLeave={() => {
                handleMouseUp();
                setIsOverlayHover(false);
            }}
            onMouseMove={handleMouseMove}
            onClick={onClose}
        >

            {/* Darkened Header - Standardized to zinc-950/black */}
            <div
                className="h-14 border-b border-white/10 flex items-center justify-between px-6 bg-zinc-950 flex-shrink-0 z-50"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2 text-gray-200 font-bold">
                        <ArrowRightLeft className="w-5 h-5 text-sage-500" />
                        Comparison
                    </div>

                    <div className="flex bg-black rounded-lg p-0.5 border border-white/10">
                        <button type="button" aria-pressed={mode === 'split'} onClick={() => setMode('split')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${mode === 'split' ? 'bg-white/10 text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'}`} title="Side by Side">Split</button>
                        <button type="button" aria-pressed={mode === 'slider'} onClick={() => setMode('slider')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${mode === 'slider' ? 'bg-white/10 text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'}`} title="Slider Swipe">Swipe</button>
                        <button type="button" aria-pressed={mode === 'overlay'} onClick={() => setMode('overlay')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${mode === 'overlay' ? 'bg-white/10 text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'}`} title="Hover Overlay">Overlay</button>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 bg-black rounded-full px-3 py-1 border border-white/10">
                        <TooltipButton label="Zoom Out" content="Zoom Out" onClick={() => applyZoom(scale - COMPARE_BUTTON_ZOOM_STEP)} className="p-1 hover:text-white text-gray-500"><ZoomOut className="w-4 h-4" /></TooltipButton>
                        <span className="text-xs font-mono text-gray-400 w-12 text-center">{Math.round(scale * 100)}%</span>
                        <TooltipButton label="Zoom In" content="Zoom In" onClick={() => applyZoom(scale + COMPARE_BUTTON_ZOOM_STEP)} className="p-1 hover:text-white text-gray-500"><ZoomIn className="w-4 h-4" /></TooltipButton>
                        <div className="w-px h-3 bg-white/10 mx-1" />
                        <TooltipButton label="Reset Zoom" content="Reset Zoom" onClick={resetZoom} className="p-1 hover:text-white text-gray-500"><RotateCcw className="w-4 h-4" /></TooltipButton>
                    </div>

                    <div className="h-6 w-px bg-white/10" />

                    <TooltipButton
                        label={isPanelOpen ? "Hide Diff Sidebar" : "Show Diff Sidebar"}
                        content={isPanelOpen ? "Hide Diff Sidebar" : "Show Diff Sidebar"}
                        aria-pressed={isPanelOpen}
                        onClick={() => setIsPanelOpen(!isPanelOpen)}
                        className={`p-2 rounded-lg transition-colors ${isPanelOpen ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-white'}`}
                    >
                        <Sidebar className="w-5 h-5" />
                    </TooltipButton>

                    <button ref={closeButtonRef} type="button" aria-label="Close Comparison" onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg text-gray-500 hover:text-white transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden">

                {/* Main Canvas Area */}
                <div
                    ref={containerRef}
                    className="flex-1 flex overflow-hidden relative bg-[#050505] select-none"
                    onWheel={handleWheel}
                    onMouseDown={handleMouseDown}
                    onDoubleClick={handleDoubleClick}
                    onClick={e => e.stopPropagation()}
                >

                    {/* SPLIT */}
                    {mode === 'split' && (
                        <div className="absolute inset-0 p-6 flex gap-4 overflow-hidden">
                            <div className="flex-1 overflow-hidden relative">
                                <ImageContainer img={imageA} imagePaddingClassName="p-0" objectPosition="right center" {...commonImageProps} />
                                <ImageActions img={imageA} side="left" onToggleFavorite={onToggleFavorite} onTogglePin={onTogglePin} />
                            </div>
                            <div className="flex-1 overflow-hidden relative">
                                <ImageContainer img={imageB} imagePaddingClassName="p-0" objectPosition="left center" {...commonImageProps} />
                                <ImageActions img={imageB} side="right" onToggleFavorite={onToggleFavorite} onTogglePin={onTogglePin} />
                            </div>
                        </div>
                    )}

                    {/* SLIDER */}
                    {mode === 'slider' && (
                        <div className="w-full h-full relative overflow-hidden flex items-center justify-center">
                            <div className="absolute inset-0 flex items-center justify-center">
                                <ImageContainer img={imageB} {...commonImageProps} />
                            </div>
                            <div
                                className="absolute inset-0 flex items-center justify-center bg-[#050505] shadow-[2px_0_20px_rgba(0,0,0,0.8)]"
                                style={{ clipPath: sliderClipPath }}
                            >
                                <ImageContainer img={imageA} {...commonImageProps} />
                            </div>
                            <div className="absolute z-50 pointer-events-none" style={activeMediaFrameStyle}>
                                <ImageActions img={imageA} side="left" onToggleFavorite={onToggleFavorite} onTogglePin={onTogglePin} />
                                <ImageActions img={imageB} side="right" onToggleFavorite={onToggleFavorite} onTogglePin={onTogglePin} />
                            </div>
                            <div className="absolute z-40 overflow-hidden pointer-events-none" style={activeMediaFrameStyle}>
                                <div
                                    className="absolute top-0 h-full -translate-x-1/2"
                                    style={sliderDividerTrackStyle}
                                >
                                    <div
                                        className="absolute inset-0 bg-sage-500 shadow-[0_0_18px_rgba(115,140,85,0.45),2px_0_20px_rgba(0,0,0,0.8)]"
                                        style={{ clipPath: sliderDividerClipPath }}
                                    />
                                </div>
                            </div>
                            <div
                                ref={sliderRef}
                                className="absolute -translate-x-1/2 cursor-ew-resize z-40 flex items-center justify-center group"
                                style={sliderHandleStyle}
                                onMouseDown={handleSliderMouseDown}
                            >
                                <div className="w-8 h-8 rounded-full bg-sage-500 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform rotate-[4deg]">
                                    <ArrowRightLeft className="w-4 h-4 text-white" />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* OVERLAY */}
                    {mode === 'overlay' && (
                        <div className="w-full h-full relative overflow-hidden flex items-center justify-center">
                            <div className="absolute inset-0 flex items-center justify-center">
                                <ImageContainer img={imageA} {...commonImageProps} />
                            </div>
                            <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 ease-out ${isOverlayHover ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
                                <ImageContainer img={imageB} {...commonImageProps} />
                            </div>
                            <div className="absolute z-50 pointer-events-none" style={activeMediaFrameStyle}>
                                <ImageActions img={imageA} side="left" onToggleFavorite={onToggleFavorite} onTogglePin={onTogglePin} />
                                <ImageActions img={imageB} side="right" onToggleFavorite={onToggleFavorite} onTogglePin={onTogglePin} />
                            </div>
                            <div
                                className="absolute z-40 bg-black/80 text-white px-4 py-2 rounded-full text-xs pointer-events-none border border-white/10 backdrop-blur-md"
                                style={overlayHintStyle}
                            >
                                Hover to reveal comparison
                            </div>
                        </div>
                    )}

                </div>

                {/* Right Sidebar - With Animation */}
                <div
                    style={{ width: isPanelOpen ? `${panelWidth}px` : '0px' }}
                    aria-hidden={!isPanelOpen}
                    inert={isPanelOpen ? undefined : true}
                    className={`bg-[#0a0a0a] border-l border-white/10 flex flex-col flex-shrink-0 relative shadow-2xl z-20 transition-all duration-500 ease-spring overflow-hidden ${isPanelOpen ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-20'}`}
                    onClick={e => e.stopPropagation()}
                >
                    <div
                        className="absolute left-0 top-0 bottom-0 w-1 hover:w-1.5 bg-transparent hover:bg-sage-500 cursor-ew-resize transition-all z-20"
                        onMouseDown={startPanelResize}
                    />

                    <div className="p-4 border-b border-white/10 flex items-center justify-between bg-zinc-950 min-w-[300px]">
                        <h3 className="font-bold text-gray-200 text-sm flex items-center gap-2 uppercase tracking-wide">
                            <GitCompare className="w-4 h-4 text-sage-500" />
                            Differences
                        </h3>
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar min-w-[300px]">
                        <div className="grid grid-cols-2 gap-4 px-4 py-4 bg-zinc-900/20 border-b border-white/10 text-xs font-mono text-gray-500">
                            <div className="truncate text-center" title={imageA.filename}>{getFilename(imageA.filename)}</div>
                            <div className="truncate text-center" title={imageB.filename}>{getFilename(imageB.filename)}</div>
                        </div>

                        <div className="p-4 border-b border-white/10">
                            <div className="flex items-center justify-between mb-3">
                                <div className="text-xs text-gray-500 font-bold uppercase tracking-wider">Prompts</div>
                                <div className="flex items-center gap-2">
                                    {diffMode === 'diff' && (
                                        <div className="flex flex-wrap justify-end gap-1 text-[10px] mr-2">
                                            <span className="text-red-400 bg-red-900/20 px-1.5 py-0.5 rounded">Removed</span>
                                            <span className="text-sage-300 bg-sage-900/20 px-1.5 py-0.5 rounded">Added</span>
                                            <span className="text-orange-300 bg-orange-900/20 px-1.5 py-0.5 rounded">Weight</span>
                                            <span className="text-blue-300 bg-blue-900/20 px-1.5 py-0.5 rounded">↑↓ Moved</span>
                                        </div>
                                    )}
                                    <div className="flex bg-black rounded-lg p-0.5 border border-white/10">
                                        <TooltipButton label="Show Diff View" content="Show Diff View" aria-pressed={diffMode === 'diff'} onClick={() => setDiffMode('diff')} className={`p-1 rounded ${diffMode === 'diff' ? 'bg-white/10 text-white' : 'text-gray-500'}`}><Eye className="w-3 h-3" /></TooltipButton>
                                        <TooltipButton label="Show Raw View" content="Show Raw View" aria-pressed={diffMode === 'raw'} onClick={() => setDiffMode('raw')} className={`p-1 rounded ${diffMode === 'raw' ? 'bg-white/10 text-white' : 'text-gray-500'}`}><EyeOff className="w-3 h-3" /></TooltipButton>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-6">
                                {renderPromptSection('Positive prompt', positivePromptA, positivePromptB, positiveTagDiff)}
                                {renderPromptSection('Negative prompt', negativePromptA, negativePromptB, negativeTagDiff)}
                            </div>
                        </div>

                        <DiffRow label="Model" valA={imageA.metadata.model} valB={imageB.metadata.model} />
                        <DiffRow label="Seed" valA={imageA.metadata.seed ?? 'Unknown'} valB={imageB.metadata.seed ?? 'Unknown'} />
                        <DiffRow label="Steps" valA={imageA.metadata.steps} valB={imageB.metadata.steps} />
                        <DiffRow label="CFG" valA={imageA.metadata.cfg} valB={imageB.metadata.cfg} />
                        <DiffRow label="Size" valA={`${imageA.width}x${imageA.height}`} valB={`${imageB.width}x${imageB.height}`} />
                        <HashRow hashA={fileHashA} hashB={fileHashB} />
                    </div>
                </div>

            </div>
        </div>
    );
};
