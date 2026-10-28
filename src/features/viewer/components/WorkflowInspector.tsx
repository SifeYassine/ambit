
import * as React from 'react';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Box, Workflow, Search, ChevronDown, ChevronRight, Copy, Check, Download, Activity, AlertTriangle, ArrowDownToLine, ArrowUpFromLine, MousePointerClick } from 'lucide-react';
import { AIImage, isVideoAsset } from '../../../types';
import { scanImageWorkflow } from '../../../services/metadataParser';
import { updateImageWorkflow, updateImageWorkflowHint } from '../../../services/db/imageRepo';
import { commands, type ComfyWorkflowGraphReport } from '../../../bindings';
import { TooltipButton } from '../../../components/ui/InfoTooltip';
import { MetadataSectionHeader } from './metadata/MetadataSectionHeader';
import {
    isWorkflowGraph,
    groupWorkflowNodes,
    indexWorkflowConnections,
    selectWorkflowGraphSource,
    selectWorkflowJsonForActions,
    workflowGraphSourceFromBackend,
    type WorkflowDisplayEdge,
    type WorkflowDisplayNode,
    type WorkflowInputs,
    type WorkflowNodeConnections
} from './workflowGraphUtils';
import { WorkflowCanvas } from './workflowCanvas/WorkflowCanvas';
import { WorkflowNodePreview } from './workflowCanvas/WorkflowNodePreview';
import {
    buildAutoLayoutDocument,
    parseWorkflowCanvasDocument
} from './workflowCanvas/workflowCanvasModel';

interface WorkflowInspectorProps {
    image: AIImage;
    onWorkflowLoaded?: (workflowJson: string) => void;
    /**
     * When provided, the workflow is drawn as a ComfyUI-style node graph inside this element
     * (the viewer's main stage) and the sidebar shows search results and a preview of the selected node.
     */
    graphStage?: HTMLElement | null;
}

const workflowNodeElementId = (nodeId: string | number) => `workflow-node-${String(nodeId)}`;

const WorkflowOutputAnchors: React.FC<{
    selectedOutputNodeIds: string[];
    rootSamplerNodeIds: string[];
    outputAmbiguous: boolean;
    nodeById: Map<string, WorkflowDisplayNode>;
    onFocusNode: (nodeId: string) => void;
}> = ({ selectedOutputNodeIds, rootSamplerNodeIds, outputAmbiguous, nodeById, onFocusNode }) => {
    if (selectedOutputNodeIds.length === 0) return null;

    const renderAnchor = (nodeId: string, kind: 'output' | 'root') => {
        const node = nodeById.get(nodeId);
        if (!node) return null;

        const isRoot = kind === 'root';
        const label = isRoot
            ? outputAmbiguous ? 'Root Candidate' : 'Root Sampler'
            : 'Selected Output';
        const Icon = isRoot ? Activity : ArrowDownToLine;

        return (
            <button
                key={`${kind}:${nodeId}`}
                type="button"
                onClick={() => onFocusNode(nodeId)}
                aria-label={`Open ${label.toLowerCase()} node ${node.title} (${nodeId})`}
                title={`Open ${label.toLowerCase()} node ${nodeId}`}
                className="flex w-full min-w-0 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-left text-[10px] transition-colors hover:border-sage-300 hover:bg-sage-50 dark:border-white/10 dark:bg-white/5 dark:hover:border-sage-700 dark:hover:bg-sage-900/20"
            >
                <Icon className={`h-3 w-3 shrink-0 ${isRoot ? 'text-harbor-600 dark:text-harbor-300' : 'text-sage-600 dark:text-sage-300'}`} />
                <span className="min-w-0">
                    <span className="block font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</span>
                    <span className="block max-w-44 truncate font-mono text-gray-700 dark:text-gray-200" title={`${node.title} / #${nodeId}`}>
                        {node.title} / #{nodeId}
                    </span>
                </span>
            </button>
        );
    };

    return (
        <section aria-label="Parser-selected workflow anchors" className="space-y-2 border-y border-gray-200 py-2 dark:border-white/10">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {selectedOutputNodeIds.map((nodeId) => renderAnchor(nodeId, 'output'))}
                {rootSamplerNodeIds.map((nodeId) => renderAnchor(nodeId, 'root'))}
            </div>
            {outputAmbiguous ? (
                <div className="flex items-start gap-1.5 text-[10px] text-ember-600 dark:text-ember-300">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    Multiple root samplers were found. Ambit does not treat any candidate as authoritative.
                </div>
            ) : rootSamplerNodeIds.length === 0 ? (
                <div className="text-[10px] text-gray-500 dark:text-gray-400">
                    No sampler root was found for the selected output.
                </div>
            ) : null}
        </section>
    );
};

const WorkflowNode: React.FC<{
    id: string | number;
    title: string;
    type: string;
    inputs: WorkflowInputs;
    connections: WorkflowNodeConnections;
    nodeById: Map<string, WorkflowDisplayNode>;
    isSelectedOutput: boolean;
    isRootSampler: boolean;
    outputAmbiguous: boolean;
    isFocused: boolean;
    focusRequestId: number | null;
    defaultExpanded?: boolean;
    onFollowConnection: (nodeId: string) => void;
}> = ({ id, title, type, inputs, connections, nodeById, isSelectedOutput, isRootSampler, outputAmbiguous, isFocused, focusRequestId, defaultExpanded = false, onFollowConnection }) => {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);
    const hasInputs = Object.keys(inputs).length > 0;
    const hasConnections = connections.incoming.length > 0 || connections.outgoing.length > 0;
    const hasContent = hasInputs || hasConnections;

    React.useEffect(() => {
        if (isFocused && focusRequestId !== null && hasContent) setIsExpanded(true);
    }, [focusRequestId, hasContent, isFocused]);

    const renderConnection = (edge: WorkflowDisplayEdge, direction: 'incoming' | 'outgoing') => {
        const connectedNodeId = direction === 'incoming' ? edge.sourceNodeId : edge.targetNodeId;
        const connectedNode = nodeById.get(connectedNodeId);
        const connectedTitle = connectedNode?.title ?? `Node ${connectedNodeId}`;
        const sourceSlot = edge.sourceOutputSlot === null || edge.sourceOutputSlot === undefined
            ? 'output'
            : `output ${edge.sourceOutputSlot}`;
        const endpoint = `${sourceSlot} -> ${edge.targetInputName}`;
        const Icon = direction === 'incoming' ? ArrowDownToLine : ArrowUpFromLine;

        return (
            <button
                key={`${edge.sourceNodeId}:${edge.sourceOutputSlot ?? ''}:${edge.targetNodeId}:${edge.targetInputSlot ?? ''}:${edge.targetInputName}`}
                type="button"
                aria-label={`Open ${direction} connected node ${connectedTitle} (${connectedNodeId})`}
                title={`Open node ${connectedNodeId}`}
                onClick={() => onFollowConnection(connectedNodeId)}
                className="flex w-full items-start gap-2 rounded-md border border-gray-200 dark:border-white/10 bg-gray-50/70 dark:bg-white/5 px-2 py-1.5 text-left transition-colors hover:border-sage-300 hover:bg-sage-50 dark:hover:border-sage-700 dark:hover:bg-sage-900/20"
            >
                <Icon className="mt-0.5 h-3 w-3 shrink-0 text-sage-600 dark:text-sage-300" />
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-semibold text-gray-700 dark:text-gray-200">
                        {connectedTitle}
                    </span>
                    <span className="block truncate font-mono text-[9px] text-gray-400" title={`${endpoint} / node ${connectedNodeId}`}>
                        {endpoint} / #{connectedNodeId}
                    </span>
                </span>
            </button>
        );
    };

    return (
        <div
            id={workflowNodeElementId(id)}
            data-workflow-node-id={String(id)}
            tabIndex={-1}
            className={`bg-white dark:bg-slate-800/40 border rounded-xl text-sm overflow-hidden transition-all outline-none ${isFocused ? 'border-sage-500 ring-2 ring-sage-400/30' : 'border-gray-200 dark:border-white/5'}`}
        >
            <button
                type="button"
                aria-expanded={hasContent ? isExpanded : undefined}
                onClick={() => setIsExpanded(!isExpanded)}
                disabled={!hasContent}
                className={`w-full flex items-center gap-3 p-3 text-left transition-colors ${isExpanded ? 'bg-gray-50 dark:bg-white/5' : 'hover:bg-gray-50 dark:hover:bg-white/5'} ${!hasContent ? 'cursor-default opacity-80' : ''}`}
            >
                <Box className={`w-3.5 h-3.5 shrink-0 ${isExpanded ? 'text-sage-500' : 'text-gray-400'}`} />
                <div className="flex-1 min-w-0">
                    <div className="font-bold text-gray-800 dark:text-gray-200 truncate" title={title}>{title}</div>
                    <div className="flex min-w-0 items-center gap-1 text-[10px] text-gray-400 font-mono">
                        <span className="truncate">{type}</span>
                        <span
                            className="max-w-[45%] truncate text-gray-300 dark:text-gray-600"
                            title={`Node ${id}`}
                        >
                            #{id}
                        </span>
                    </div>
                    {(isSelectedOutput || isRootSampler) && (
                        <div className="mt-1 flex flex-wrap gap-1">
                            {isSelectedOutput && (
                                <span className="rounded border border-sage-300 bg-sage-50 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sage-600 dark:border-sage-700 dark:bg-sage-900/20 dark:text-sage-300">
                                    Selected Output
                                </span>
                            )}
                            {isRootSampler && (
                                <span className={`rounded border px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide ${outputAmbiguous ? 'border-ember-300 bg-ember-50 text-ember-600 dark:border-ember-700 dark:bg-ember-900/20 dark:text-ember-300' : 'border-harbor-300 bg-harbor-50 text-harbor-600 dark:border-harbor-700 dark:bg-harbor-900/20 dark:text-harbor-300'}`}>
                                    {outputAmbiguous ? 'Root Candidate' : 'Root Sampler'}
                                </span>
                            )}
                        </div>
                    )}
                </div>
                {hasContent && (
                    <div className="text-gray-400">
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </div>
                )}
            </button>

            {isExpanded && hasContent && (
                <div className="p-3 pt-0 border-t border-gray-100 dark:border-white/5 space-y-3 mt-2">
                    {hasInputs && (
                        <div className="space-y-1">
                            {Object.entries(inputs).map(([key, val]) => {
                                if (typeof val === 'object' && val !== null && !Array.isArray(val)) return null; // Skip complex objects/connections
                                if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'string' && val[0].length > 50) {
                                    if (val.length === 2 && typeof val[1] === 'number') return null;
                                }

                                return (
                                    <div key={key} className="flex justify-between items-start gap-2 text-xs group py-1 border-b border-gray-100/50 dark:border-white/5 last:border-0">
                                        <span className="text-gray-500 dark:text-gray-400 truncate shrink-0 max-w-[40%] select-none">{key}:</span>
                                        <span className="text-gray-700 dark:text-gray-300 font-mono break-all text-right line-clamp-4 hover:line-clamp-none transition-all cursor-text select-text" title={String(val)}>
                                            {String(val)}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {connections.incoming.length > 0 && (
                        <section aria-label={`Incoming connections for node ${id}`}>
                            <div className="mb-1.5 text-[9px] font-bold uppercase tracking-wide text-gray-400">Incoming</div>
                            <div className="space-y-1">
                                {connections.incoming.map((edge) => renderConnection(edge, 'incoming'))}
                            </div>
                        </section>
                    )}

                    {connections.outgoing.length > 0 && (
                        <section aria-label={`Outgoing connections for node ${id}`}>
                            <div className="mb-1.5 text-[9px] font-bold uppercase tracking-wide text-gray-400">Outgoing</div>
                            <div className="space-y-1">
                                {connections.outgoing.map((edge) => renderConnection(edge, 'outgoing'))}
                            </div>
                        </section>
                    )}
                </div>
            )}
        </div>
    );
};

const WorkflowNodeSection: React.FC<{
    path: string[];
    nodes: ReturnType<typeof groupWorkflowNodes>[number]['nodes'];
    connectionIndex: Map<string, WorkflowNodeConnections>;
    nodeById: Map<string, WorkflowDisplayNode>;
    selectedOutputNodeIdSet: Set<string>;
    rootSamplerNodeIdSet: Set<string>;
    outputAmbiguous: boolean;
    focusedNodeId: string | null;
    focusRequestId: number | null;
    onFollowConnection: (nodeId: string) => void;
}> = ({ path, nodes, connectionIndex, nodeById, selectedOutputNodeIdSet, rootSamplerNodeIdSet, outputAmbiguous, focusedNodeId, focusRequestId, onFollowConnection }) => {
    const nodeList = (
        <div className="space-y-2">
            {nodes.map((node) => (
                <WorkflowNode
                    key={String(node.id)}
                    id={node.id}
                    title={node.title}
                    type={node.type}
                    inputs={node.inputs}
                    connections={connectionIndex.get(String(node.id)) ?? { incoming: [], outgoing: [] }}
                    nodeById={nodeById}
                    isSelectedOutput={selectedOutputNodeIdSet.has(String(node.id))}
                    isRootSampler={rootSamplerNodeIdSet.has(String(node.id))}
                    outputAmbiguous={outputAmbiguous}
                    isFocused={focusedNodeId === String(node.id)}
                    focusRequestId={focusedNodeId === String(node.id) ? focusRequestId : null}
                    onFollowConnection={onFollowConnection}
                />
            ))}
        </div>
    );

    if (path.length === 0) return nodeList;

    return (
        <section
            className="border-l-2 border-sage-200 dark:border-sage-800/70 pl-3"
            style={{ marginLeft: Math.min(path.length - 1, 3) * 12 }}
        >
            <div className="mb-2 flex min-w-0 items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-sage-600 dark:text-sage-300">
                <Workflow className="h-3 w-3 shrink-0" />
                <span className="truncate" title={`Subgraph ${path.join(' / ')}`}>
                    Subgraph {path.join(' / ')}
                </span>
            </div>
            {nodeList}
        </section>
    );
};

export const WorkflowInspector: React.FC<WorkflowInspectorProps> = ({ image, onWorkflowLoaded, graphStage }) => {
    const isCanvasMode = graphStage !== undefined;
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [localWorkflow, setLocalWorkflow] = useState<string | undefined>(image.metadata.workflowJson);
    const [backendWorkflowGraph, setBackendWorkflowGraph] = useState<{
        chunks: Record<string, string>;
        report: ComfyWorkflowGraphReport;
    } | null>(null);
    const [focusedConnection, setFocusedConnection] = useState<{
        nodeId: string;
        requestId: number;
    } | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const hasAttempted = React.useRef<string | null>(null);
    const originalWorkflow = image.originalChunks?.workflow;
    const originalPrompt = image.originalChunks?.prompt;
    const originalChunks = useMemo(() => ({
        ...(originalWorkflow ? { workflow: originalWorkflow } : {}),
        ...(originalPrompt ? { prompt: originalPrompt } : {})
    }), [originalWorkflow, originalPrompt]);
    const workflowJsonForActions = selectWorkflowJsonForActions({
        localWorkflowJson: localWorkflow,
        workflowJson: image.metadata.workflowJson,
        originalChunks
    });
    const fallbackWorkflowGraphSource = useMemo(() => selectWorkflowGraphSource({
        tool: image.metadata.tool,
        localWorkflowJson: localWorkflow,
        workflowJson: image.metadata.workflowJson,
        originalChunks
    }), [image.metadata.tool, image.metadata.workflowJson, localWorkflow, originalChunks]);
    const backendGraphSource = useMemo(
        () => workflowGraphSourceFromBackend(
            backendWorkflowGraph?.chunks === originalChunks ? backendWorkflowGraph.report : null,
            originalChunks
        ),
        [backendWorkflowGraph, originalChunks]
    );
    const workflowGraphSource = backendGraphSource ?? fallbackWorkflowGraphSource;
    const workflowNodes = workflowGraphSource?.nodes ?? [];
    const workflowEdges = workflowGraphSource?.edges ?? [];
    const nodeById = useMemo(
        () => new Map(workflowNodes.map((node) => [String(node.id), node])),
        [workflowNodes]
    );
    const connectionIndex = useMemo(
        () => indexWorkflowConnections(workflowNodes, workflowEdges),
        [workflowEdges, workflowNodes]
    );
    const selectedOutputNodeIds = workflowGraphSource?.selectedOutputNodeIds ?? [];
    const rootSamplerNodeIds = workflowGraphSource?.rootSamplerNodeIds ?? [];
    const outputAmbiguous = workflowGraphSource?.outputAmbiguous ?? false;
    const visibleSelectedOutputNodeIds = useMemo(
        () => selectedOutputNodeIds.filter((nodeId) => nodeById.has(nodeId)),
        [nodeById, selectedOutputNodeIds]
    );
    const visibleRootSamplerNodeIds = useMemo(
        () => rootSamplerNodeIds.filter((nodeId) => nodeById.has(nodeId)),
        [nodeById, rootSamplerNodeIds]
    );
    const selectedOutputNodeIdSet = useMemo(
        () => new Set(visibleSelectedOutputNodeIds),
        [visibleSelectedOutputNodeIds]
    );
    const rootSamplerNodeIdSet = useMemo(
        () => new Set(visibleRootSamplerNodeIds),
        [visibleRootSamplerNodeIds]
    );
    const handleFollowConnection = React.useCallback((nodeId: string) => {
        setSearchQuery('');
        setSelectedNodeId(nodeId);
        setFocusedConnection((current) => ({
            nodeId,
            requestId: (current?.requestId ?? 0) + 1
        }));
    }, []);

    const handleCanvasSelectNode = React.useCallback((nodeId: string | null) => {
        setSelectedNodeId(nodeId);
        if (nodeId) setSearchQuery('');
    }, []);

    React.useEffect(() => {
        setFocusedConnection(null);
    }, [image.id, workflowGraphSource?.json, workflowGraphSource?.normalizedByBackend, workflowGraphSource?.source]);

    React.useEffect(() => {
        if (image.metadata.tool !== 'ComfyUI' || Object.keys(originalChunks).length === 0) {
            setBackendWorkflowGraph(null);
            return;
        }

        let cancelled = false;
        setBackendWorkflowGraph(null);

        commands.inspectComfyuiWorkflowGraph(originalChunks)
            .then((result) => {
                if (cancelled) return;
                setBackendWorkflowGraph(result.status === 'ok'
                    ? { chunks: originalChunks, report: result.data }
                    : null);
            })
            .catch(() => {
                if (!cancelled) setBackendWorkflowGraph(null);
            });

        return () => {
            cancelled = true;
        };
    }, [image.metadata.tool, originalChunks]);

    // Lazy Load Workflow if missing
    React.useEffect(() => {
        // Only attempt if:
        // 1. Data is missing
        // 2. We are not already loading
        // 3. We haven't already attempted this specific image in this session
        if (!isVideoAsset(image) && !workflowJsonForActions && !isLoading && hasAttempted.current !== image.id) {
            // If we have a hint that there is definitely NO workflow, skip and mark as attempted
            if (image.metadata.hasWorkflowHint === false) {
                hasAttempted.current = image.id;
                return;
            }

            const loadWorkflow = async () => {
                setIsLoading(true);
                hasAttempted.current = image.id;
                try {
                    console.log('[Workflow] Lazy loading for:', image.filename);
                    const result = await scanImageWorkflow(image.id);

                    const isValidWorkflow = result && isWorkflowGraph(result);

                    console.log('[Workflow] Scan result:', isValidWorkflow ? 'Found VALID workflow' : 'No valid graph found', result?.substring(0, 100));

                    if (isValidWorkflow) {
                        setLocalWorkflow(result);
                        await updateImageWorkflow(image.id, result!); // result is checked in isValidWorkflow
                        onWorkflowLoaded?.(result!);
                    } else {
                        // No workflow found - persist this so we hide the tab next time
                        console.log('[Workflow] No workflow found (or invalid graph), setting hasWorkflowHint=false for:', image.id);
                        await updateImageWorkflowHint(image.id, false);
                    }
                } catch (e) {
                    console.error('[Workflow] Failed lazy loading', e);
                } finally {
                    setIsLoading(false);
                }
            };
            loadWorkflow();
        }
    }, [image.id, image.metadata.workflowJson, localWorkflow, isLoading, workflowJsonForActions]);

    // Sync local state if prop changes OR if image changes
    React.useEffect(() => {
        setLocalWorkflow(image.metadata.workflowJson);
    }, [image.id, image.metadata.workflowJson]);

    const handleCopy = () => {
        navigator.clipboard.writeText(workflowJsonForActions!);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleDownload = async () => {
        const wf = workflowJsonForActions!;

        try {
            // Generate a sensible filename: name_workflow.json
            const baseName = image.filename.replace(/\.[^/.]+$/, "");
            const defaultPath = `${baseName}_workflow.json`;

            const { save } = await import('@tauri-apps/plugin-dialog');
            const filePath = await save({
                filters: [{ name: 'JSON', extensions: ['json'] }],
                defaultPath
            });

            if (filePath) {
                const { writeTextFile } = await import('@tauri-apps/plugin-fs');
                await writeTextFile(filePath, wf);
                console.log('[Workflow] Saved to', filePath);
            }
        } catch (e) {
            console.error('Failed to download workflow', e);
        }
    };

    const filteredNodes = useMemo(() => {
        if (!searchQuery) return workflowNodes;
        const lowerQ = searchQuery.toLowerCase();
        return workflowNodes.filter(node =>
            node.title.toLowerCase().includes(lowerQ) ||
            node.type.toLowerCase().includes(lowerQ) ||
            String(node.id).toLowerCase().includes(lowerQ) ||
            node.subgraphPath?.some(segment => segment.toLowerCase().includes(lowerQ))
        );
    }, [searchQuery, workflowNodes]);
    const filteredNodeGroups = useMemo(() => groupWorkflowNodes(filteredNodes), [filteredNodes]);

    const preservedWorkflowJson = localWorkflow || image.metadata.workflowJson || originalWorkflow;
    // Parse the saved layout independently so the backend report arriving later does not rebuild it.
    // Clear the graph selection only for a different image or workflow. The backend graph report
    // arrives after the graph is first drawn and must not drop a node the user already clicked.
    React.useEffect(() => {
        setSelectedNodeId(null);
    }, [image.id, preservedWorkflowJson]);
    const savedLayoutDocument = useMemo(
        () => isCanvasMode ? parseWorkflowCanvasDocument(preservedWorkflowJson, originalPrompt) : null,
        [isCanvasMode, originalPrompt, preservedWorkflowJson]
    );
    const canvasDocument = useMemo(() => {
        if (!isCanvasMode) return null;
        return savedLayoutDocument ?? buildAutoLayoutDocument(workflowNodes, workflowEdges);
    }, [isCanvasMode, savedLayoutDocument, workflowEdges, workflowNodes]);
    const canvasHighlightedNodeIds = useMemo(() => {
        if (!isCanvasMode) return null;
        return searchQuery ? new Set(filteredNodes.map((node) => String(node.id))) : null;
    }, [filteredNodes, isCanvasMode, searchQuery]);

    React.useEffect(() => {
        if (!focusedConnection || searchQuery) return;

        const element = document.getElementById(workflowNodeElementId(focusedConnection.nodeId));
        if (!element) return;

        element.focus({ preventScroll: true });
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, [filteredNodes, focusedConnection, searchQuery]);

    return (
        <div className="flex flex-col h-full overflow-hidden animate-in fade-in slide-in-from-right-4 duration-300">

            {/* Header & Search */}
            <div className="p-6 pb-2 shrink-0 space-y-4">
                <MetadataSectionHeader
                    title="Node Graph"
                    icon={Workflow}
                    trailing={<>
                        <div className="shrink-0 rounded-full bg-gray-100 px-2 py-1 font-mono text-[10px] text-gray-400 dark:bg-white/5">
                            {workflowNodes.length}
                        </div>
                        {workflowJsonForActions ? (
                        <div className="flex shrink-0 items-center gap-1">
                            <TooltipButton
                                onClick={handleCopy}
                                label={copied ? 'Copied workflow JSON' : 'Copy workflow JSON'}
                                content={copied ? 'Copied workflow JSON' : 'Copy workflow JSON'}
                                title="Copy to clipboard"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-sage-200 bg-sage-50 text-sage-600 transition-colors hover:bg-sage-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500/50 dark:border-sage-800 dark:bg-sage-900/20 dark:text-sage-300 dark:hover:bg-sage-900/40"
                            >
                                {copied ? <Check aria-hidden="true" className="h-4 w-4" /> : <Copy aria-hidden="true" className="h-4 w-4" />}
                            </TooltipButton>
                            <TooltipButton
                                onClick={handleDownload}
                                label="Download workflow JSON"
                                content="Download workflow JSON"
                                title="Download JSON file"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-zinc-600 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500/50 dark:border-zinc-800 dark:bg-zinc-900/20 dark:text-zinc-400 dark:hover:bg-zinc-900/40"
                            >
                                <Download aria-hidden="true" className="h-4 w-4" />
                            </TooltipButton>
                            <span role="status" aria-live="polite" className="sr-only">
                                {copied ? 'Copied workflow JSON' : ''}
                            </span>
                        </div>
                        ) : null}
                    </>}
                />

                {workflowNodes.length > 0 && (
                    <div className="relative group">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 group-focus-within:text-sage-500 transition-colors" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search nodes (e.g. 'ControlNet', 'Seed')..."
                            className="w-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-white/10 rounded-xl py-2 pl-9 pr-3 text-xs focus:border-sage-500 focus:ring-1 focus:ring-sage-500/20 outline-none transition-all text-gray-700 dark:text-gray-200"
                        />
                    </div>
                )}

                {/* The canvas shows these nodes in place; the node list still needs the shortcuts. */}
                {!isCanvasMode && (
                    <WorkflowOutputAnchors
                        selectedOutputNodeIds={visibleSelectedOutputNodeIds}
                        rootSamplerNodeIds={visibleRootSamplerNodeIds}
                        outputAmbiguous={outputAmbiguous}
                        nodeById={nodeById}
                        onFocusNode={handleFollowConnection}
                    />
                )}

            </div>

            {/* Node List */}
            <div className="flex-1 overflow-y-auto custom-scrollbar px-6 pb-6">
                {isCanvasMode && canvasDocument ? (
                    searchQuery ? (
                        <section aria-label="Matching workflow nodes" className="space-y-1">
                            {filteredNodes.length > 0 ? filteredNodes.map((node) => (
                                <button
                                    key={String(node.id)}
                                    type="button"
                                    onClick={() => handleFollowConnection(String(node.id))}
                                    aria-label={`Show node ${node.title} (${node.id}) in the graph`}
                                    className="flex w-full min-w-0 items-center gap-2 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-left transition-colors hover:border-sage-300 hover:bg-sage-50 dark:border-white/10 dark:bg-white/5 dark:hover:border-sage-700 dark:hover:bg-sage-900/20"
                                >
                                    <Box className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-xs font-semibold text-gray-800 dark:text-gray-200">{node.title}</span>
                                        <span className="block truncate font-mono text-[10px] text-gray-400">{node.type} / #{node.id}</span>
                                    </span>
                                </button>
                            )) : (
                                <p className="py-6 text-center text-xs text-gray-400">No matching nodes found.</p>
                            )}
                        </section>
                    ) : selectedNodeId ? (
                        <WorkflowNodePreview key={selectedNodeId} workflowDocument={canvasDocument} nodeId={selectedNodeId} />
                    ) : (
                        <div className="mt-2 flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center dark:border-white/5">
                            <MousePointerClick className="h-6 w-6 text-gray-300 dark:text-gray-600" />
                            <p className="text-xs text-gray-400 text-balance">
                                Click a node in the graph to preview it here. Drag to pan, scroll to zoom
                                {canvasDocument.subgraphs.size > 0 ? ', and double-click a subgraph to open it.' : '.'}
                            </p>
                        </div>
                    )
                ) : filteredNodes.length > 0 ? (
                    <div className="space-y-4">
                        {filteredNodeGroups.map((group) => (
                            <WorkflowNodeSection
                                key={group.path.length === 0 ? 'workflow-root' : `subgraph:${group.key}`}
                                path={group.path}
                                nodes={group.nodes}
                                connectionIndex={connectionIndex}
                                nodeById={nodeById}
                                selectedOutputNodeIdSet={selectedOutputNodeIdSet}
                                rootSamplerNodeIdSet={rootSamplerNodeIdSet}
                                outputAmbiguous={outputAmbiguous}
                                focusedNodeId={focusedConnection?.nodeId ?? null}
                                focusRequestId={focusedConnection?.requestId ?? null}
                                onFollowConnection={handleFollowConnection}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="py-12 text-center border border-dashed border-gray-200 dark:border-white/5 rounded-xl mt-2">
                        {workflowNodes.length === 0 ? (
                            <>
                                <div className="max-w-md mx-auto px-4">
                                    <Workflow className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2 opacity-50" />
                                    <p className="text-xs text-gray-400 mb-4 text-balance">
                                        {isLoading ? "Reading workflow data from file headers..." :
                                            !workflowJsonForActions
                                                ? (image.metadata.hasWorkflowHint === false
                                                    ? "This image was generated without a recorded workflow."
                                                    : "No workflow data was found for this image in the database or file headers.")
                                                : image.metadata.tool === 'InvokeAI'
                                                    ? "This InvokeAI workflow has a complex session structure that isn't fully visualizable yet, but you can still copy or download the JSON."
                                                    : "This image contains raw workflow data that doesn't follow the standard node graph structure, but you can still copy or download the JSON."
                                        }
                                    </p>
                                    {workflowJsonForActions && (
                                        <div className="p-3 bg-gray-50 dark:bg-white/5 rounded-lg border border-gray-100 dark:border-white/5 text-left overflow-hidden">
                                            <div className="text-[10px] text-gray-400 font-mono uppercase mb-2">JSON Preview</div>
                                            <pre className="text-[10px] text-gray-500 dark:text-gray-400 line-clamp-6 font-mono break-all whitespace-pre-wrap">
                                                {workflowJsonForActions.substring(0, 1000)}...
                                            </pre>
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : (
                            <p className="text-xs text-gray-400">No matching nodes found.</p>
                        )}
                    </div>
                )}
            </div>

            {graphStage ? createPortal(
                canvasDocument ? (
                    <WorkflowCanvas
                        workflowDocument={canvasDocument}
                        selectedNodeId={selectedNodeId}
                        focusRequest={focusedConnection}
                        highlightedNodeIds={canvasHighlightedNodeIds}
                        onSelectNode={handleCanvasSelectNode}
                    />
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-[#1e1e1e] p-8">
                        <div className="max-w-sm text-center">
                            <Workflow className="mx-auto mb-3 h-10 w-10 text-gray-600" />
                            <p className="text-sm text-gray-400 text-balance">
                                {isLoading
                                    ? 'Reading workflow data from file headers...'
                                    : workflowJsonForActions
                                        ? 'This workflow data cannot be drawn as a node graph. Copy or download the JSON from the sidebar.'
                                        : 'No workflow data was found for this image.'}
                            </p>
                        </div>
                    </div>
                ),
                graphStage
            ) : null}
        </div>
    );
};
