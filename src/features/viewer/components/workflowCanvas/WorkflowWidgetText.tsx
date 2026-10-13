import * as React from 'react';
import { WIDGET_HEIGHT, type WorkflowCanvasNode } from './workflowCanvasModel';
import {
    COLORS,
    FONT_FAMILY,
    MONO_FAMILY,
    MULTILINE_LINE_HEIGHT,
    widgetBounds,
    type WorkflowViewport
} from './workflowCanvasRenderer';

interface WorkflowWidgetTextProps {
    nodes: readonly WorkflowCanvasNode[];
    viewport: WorkflowViewport;
    /** Opacity per node so muted or dimmed nodes match their canvas drawing. */
    opacityFor: (node: WorkflowCanvasNode) => number;
    onWidgetPointerDown: (nodeId: string) => void;
}

const fieldStyle: React.CSSProperties = {
    background: 'transparent',
    border: 'none',
    outline: 'none',
    margin: 0,
    color: COLORS.widgetValue,
    userSelect: 'text',
    cursor: 'text'
};

const NodeWidgetText = React.memo<{
    node: WorkflowCanvasNode;
    opacity: number;
    onPointerDown: (nodeId: string) => void;
}>(({ node, opacity, onPointerDown }) => {
    const fields: React.ReactNode[] = [];
    for (let index = 0; index < node.widgets.length; index += 1) {
        const bounds = widgetBounds(node, index);
        if (!bounds) break;
        const widget = node.widgets[index];
        const box: React.CSSProperties = {
            position: 'absolute',
            left: bounds.minX,
            top: bounds.minY,
            width: bounds.maxX - bounds.minX,
            height: bounds.maxY - bounds.minY,
            boxSizing: 'border-box',
            pointerEvents: 'auto'
        };
        const label = widget.name || 'value';

        if (widget.multiline) {
            fields.push(
                <textarea
                    key={index}
                    readOnly
                    spellCheck={false}
                    aria-label={label}
                    value={widget.value}
                    style={{
                        ...box,
                        ...fieldStyle,
                        background: COLORS.widgetBg,
                        borderRadius: 4,
                        padding: '5px 7px',
                        font: `12px/${MULTILINE_LINE_HEIGHT}px ${MONO_FAMILY}`,
                        resize: 'none',
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'anywhere',
                        overflowY: 'auto'
                    }}
                />
            );
            continue;
        }

        fields.push(
            <div
                key={index}
                style={{
                    ...box,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '0 10px',
                    background: COLORS.widgetBg,
                    border: `1px solid ${COLORS.widgetOutline}`,
                    borderRadius: WIDGET_HEIGHT / 2,
                    font: `12px ${FONT_FAMILY}`
                }}
            >
                {widget.name && (
                    <span style={{ color: COLORS.widgetLabel, flexShrink: 0, maxWidth: '50%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'none' }}>
                        {widget.name}
                    </span>
                )}
                <input
                    readOnly
                    spellCheck={false}
                    aria-label={label}
                    value={widget.value}
                    style={{ ...fieldStyle, flex: 1, minWidth: 0, padding: 0, font: 'inherit', textAlign: 'right', textOverflow: 'ellipsis' }}
                />
            </div>
        );
    }

    return (
        <div data-node-id={node.id} style={{ opacity }} onPointerDown={() => onPointerDown(node.id)}>
            {fields}
        </div>
    );
});
NodeWidgetText.displayName = 'NodeWidgetText';

/**
 * Widget values as real read-only text fields laid over the canvas, so they can be selected and
 * copied with the usual mouse and keyboard gestures (ComfyUI renders its text widgets the same way).
 */
export const WorkflowWidgetText: React.FC<WorkflowWidgetTextProps> = ({ nodes, viewport, opacityFor, onWidgetPointerDown }) => (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
            className="absolute left-0 top-0"
            style={{
                transform: `translate(${viewport.offsetX}px, ${viewport.offsetY}px) scale(${viewport.scale})`,
                transformOrigin: '0 0'
            }}
        >
            {nodes.map((node) => (
                <NodeWidgetText key={node.id} node={node} opacity={opacityFor(node)} onPointerDown={onWidgetPointerDown} />
            ))}
        </div>
    </div>
);
